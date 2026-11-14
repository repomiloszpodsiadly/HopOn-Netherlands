import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, distinctUntilChanged, filter, forkJoin, map, of, Subject, switchMap, tap } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { PlacesApiService } from '../../core/api/places-api.service';
import { PlansApiService, UnexpectedPlanResponseError } from '../../core/api/plans-api.service';
import { CITY_IDS, CityId, PlaceDto } from '../../core/models/catalog.models';
import { PLAN_NAME_MAX_LENGTH, PLAN_DESCRIPTION_MAX_LENGTH, PlanResponse, PlanUpsertRequest } from '../../core/models/plan.models';
import { ConfirmDialogComponent } from '../shared/confirm-dialog';
import { MainNavigationComponent } from '../shared/main-navigation';
import { PointerLightDirective } from '../shared/pointer-light';
import { focusMapRegion } from '../shared/focus-map-region';
import { PlanDetailsNavigationGuard } from './plan-details.guard';
import { ActivePlanStore } from '../../core/services/active-plan.store';

type PlanLoadResult = Readonly<{
  id: string;
  plan: PlanResponse | null;
  error: unknown | null;
}>;

type CatalogResult = Readonly<{
  cityId: CityId;
  places: readonly PlaceDto[] | null;
  error: string | null;
}>;

type CityCatalogResult = Readonly<{
  cityId: CityId;
  places: readonly PlaceDto[] | null;
  error: string | null;
}>;

type PlaceRow = Readonly<{ id: string; place: PlaceDto | null }>;

const CITY_NAMES: Readonly<Record<CityId, string>> = {
  amsterdam: 'Amsterdam',
  rotterdam: 'Rotterdam',
  utrecht: 'Utrecht',
};

@Component({
  selector: 'app-plan-details-page',
  imports: [RouterLink, ConfirmDialogComponent, MainNavigationComponent, PointerLightDirective],
  templateUrl: './plan-details-page.html',
  styleUrls: ['./plans-page.css', './plan-details-page.css', './plan-stops-table.css', './plan-workspace.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanDetailsPage implements PlanDetailsNavigationGuard {
  private readonly activePlanStore = inject(ActivePlanStore);
  private readonly document = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly placesApi = inject(PlacesApiService);
  private readonly plansApi = inject(PlansApiService);
  private readonly catalogRequests = new Subject<CityId>();
  private leaveResolver: ((allow: boolean) => void) | null = null;
  private leavePromise: Promise<boolean> | null = null;
  private allowNavigationAfterDelete = false;
  private beforeUnloadAttached = false;
  private readonly deletionConfirmed = signal(false);
  private readonly handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
    event.returnValue = '';
  };

  @ViewChild('deleteDialog') private readonly deleteDialog!: ConfirmDialogComponent;
  @ViewChild('discardDialog') private readonly discardDialog!: ConfirmDialogComponent;

  readonly routePlanId = signal<string | null>(null);
  readonly plan = signal<PlanResponse | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly missing = signal(false);
  readonly name = signal('');
  readonly description = signal('');
  readonly descriptionMaxLength = PLAN_DESCRIPTION_MAX_LENGTH;
  readonly nameMaxLength = PLAN_NAME_MAX_LENGTH;
  readonly placeIds = signal<readonly string[]>([]);
  readonly places = signal<readonly PlaceDto[]>([]);
  readonly catalogCityId = signal<CityId | null>(null);
  readonly catalogLoading = signal(false);
  readonly catalogError = signal<string | null>(null);
  readonly selectedPlaceId = signal('');
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly saveNotice = signal<string | null>(null);
  readonly deleting = signal(false);
  readonly deleteMessage = signal<string | null>(null);
  readonly navigationMessage = signal<string | null>(null);

  readonly dirty = computed(() => {
    const saved = this.plan();
    return saved !== null
      && (this.name() !== saved.name || this.description() !== saved.description || !sameIds(this.placeIds(), saved.placeIds));
  });
  readonly placeRows = computed<readonly PlaceRow[]>(() => {
    const saved = this.plan();
    if (saved === null) {
      return [];
    }
    const placesById = new Map(this.places().map((place) => [place.id, place]));
    return this.placeIds().map((id) => ({ id, place: placesById.get(id) ?? null }));
  });
  readonly availablePlaces = computed(() => {
    const saved = this.plan();
    if (saved === null || this.catalogCityId() !== saved.cityId || this.placeIds().length >= 12) {
      return [];
    }
    const selected = new Set(this.placeIds());
    return this.places().filter((place) => !selected.has(place.id));
  });
  readonly validationMessages = computed(() => this.validateEdits());
  readonly formValidationMessages = computed(() => this.validateEdits(false));
  readonly canSave = computed(() => this.dirty()
    && !this.saving()
    && !this.deleting()
    && !this.missing()
    && this.validationMessages().length === 0);
  readonly canExploreMap = computed(() => this.plan() !== null
    && !this.saving()
    && !this.deleting()
    && !this.missing());

  constructor() {
    effect(() => {
      const shouldWarn = !this.deletionConfirmed()
        && (this.dirty() || this.saving() || this.deleting());
      this.syncBeforeUnloadListener(shouldWarn);
    });
    this.destroyRef.onDestroy(() => this.syncBeforeUnloadListener(false));

    this.catalogRequests
      .pipe(
        switchMap((cityId) => {
          this.catalogLoading.set(true);
          this.catalogError.set(null);
          this.catalogCityId.set(null);
          this.places.set([]);
          return forkJoin(CITY_IDS.map((catalogCityId) => this.placesApi.getPlaces(catalogCityId).pipe(
            map((places) => ({ cityId: catalogCityId, places, error: null }) satisfies CityCatalogResult),
            catchError((error: unknown) => of({
              cityId: catalogCityId,
              places: null,
              error: apiErrorMessage(error, `Could not load ${CITY_NAMES[catalogCityId]} places`),
            } satisfies CityCatalogResult)),
          ))).pipe(
            map((catalogs) => {
              const unavailableCities = catalogs
                .filter((catalog) => catalog.error !== null)
                .map((catalog) => CITY_NAMES[catalog.cityId]);
              return {
                cityId,
                places: catalogs.flatMap((catalog) => catalog.places ?? []),
                error: unavailableCities.length === 0
                  ? null
                  : `Place details could not be loaded for ${unavailableCities.join(', ')}.`,
              } satisfies CatalogResult;
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.catalogLoading.set(false);
        if (result.places === null) {
          this.catalogError.set(result.error ?? 'Place details could not be loaded.');
          return;
        }
        this.catalogCityId.set(result.cityId);
        this.places.set(result.places.filter((place) => CITY_IDS.includes(place.cityId)));
        this.catalogError.set(result.error);
      });

    this.route.paramMap
      .pipe(
        map((params) => params.get('id')),
        filter((id): id is string => id !== null),
        distinctUntilChanged(),
        tap((id) => this.beginLoad(id)),
        switchMap((id) => this.plansApi.getPlan(id).pipe(
          map((plan) => ({ id, plan, error: null }) satisfies PlanLoadResult),
          catchError((error: unknown) => of({ id, plan: null, error } satisfies PlanLoadResult)),
        )),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.acceptLoadedPlan(result));
  }

  cityName(cityId: CityId): string {
    return CITY_NAMES[cityId];
  }

  formatDate(value: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      return value;
    }
    return new Intl.DateTimeFormat('en-NL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(timestamp);
  }

  onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.saveError.set(null);
    this.saveNotice.set(null);
  }

  onPlaceSelected(event: Event): void {
    this.selectedPlaceId.set((event.target as HTMLSelectElement).value);
  }

  onDescriptionInput(event: Event): void {
    if (this.saving() || this.deleting() || this.missing()) {
      return;
    }
    this.description.set((event.target as HTMLTextAreaElement).value);
    this.markEditsChanged();
  }

  addSelectedPlace(): void {
    const selected = this.selectedPlaceId();
    if (!this.availablePlaces().some((place) => place.id === selected)) {
      return;
    }
    this.placeIds.update((ids) => [...ids, selected]);
    this.selectedPlaceId.set('');
    this.markEditsChanged();
  }

  movePlace(placeId: string, direction: 'up' | 'down'): void {
    if (this.saving() || this.deleting()) {
      return;
    }
    const ids = [...this.placeIds()];
    const index = ids.indexOf(placeId);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= ids.length) {
      return;
    }
    [ids[index], ids[target]] = [ids[target], ids[index]];
    this.placeIds.set(ids);
    this.markEditsChanged();
  }

  removePlace(placeId: string): void {
    if (this.saving() || this.deleting() || !this.placeIds().includes(placeId)) {
      return;
    }
    this.placeIds.update((ids) => ids.filter((id) => id !== placeId));
    this.markEditsChanged();
  }

  retryCatalog(): void {
    const cityId = this.plan()?.cityId;
    if (cityId !== undefined) {
      this.catalogRequests.next(cityId);
    }
  }

  exploreMap(): void {
    const saved = this.plan();
    if (saved === null || !this.canExploreMap()) {
      return;
    }
    void this.router.navigate(['/'], {
      queryParams: { plan: saved.id },
      fragment: 'map-region',
    }).then((navigated) => {
      if (navigated) {
        focusMapRegion(this.document);
      }
    });
  }

  save(): void {
    const saved = this.plan();
    if (saved === null || !this.canSave()) {
      return;
    }
    const request: PlanUpsertRequest = {
      name: this.name(),
      description: this.description().trim(),
      cityId: saved.cityId,
      placeIds: [...this.placeIds()],
    };
    this.saving.set(true);
    this.saveError.set(null);
    this.saveNotice.set(null);
    this.plansApi.updatePlan(saved.id, request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.acceptUpdatedPlan(response, request),
        error: (error: unknown) => this.handleSaveError(error),
      });
  }

  openDeleteDialog(): void {
    if (this.deleting() || this.saving() || this.missing()) {
      return;
    }
    this.deleteMessage.set(null);
    this.deleteDialog.open();
  }

  confirmDelete(): void {
    const saved = this.plan();
    if (saved === null || this.deleting()) {
      return;
    }
    this.deleting.set(true);
    this.deleteMessage.set(null);
    this.plansApi.deletePlan(saved.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.activePlanStore.clear(saved.id);
          this.deletionConfirmed.set(true);
          this.deleting.set(false);
          this.allowNavigationAfterDelete = true;
          this.deleteDialog.close();
          void this.router.navigate(['/plans']);
        },
        error: (error: unknown) => {
          this.deleting.set(false);
          if (isHttpStatus(error, 404)) {
            this.activePlanStore.clear(saved.id);
            this.missing.set(true);
            this.deleteDialog.close();
            this.saveError.set('This plan was already removed. Your edits remain on this page until you leave.');
            return;
          }
          this.deleteMessage.set(apiErrorMessage(error, 'This plan could not be deleted'));
        },
      });
  }

  confirmNavigationAway(): boolean | Promise<boolean> {
    if (this.allowNavigationAfterDelete) {
      return true;
    }
    if (this.saving() || this.deleting()) {
      this.navigationMessage.set('Wait for the current save or delete request to finish before leaving.');
      return false;
    }
    if (!this.dirty()) {
      return true;
    }
    if (this.leavePromise !== null) {
      return this.leavePromise;
    }
    this.navigationMessage.set(null);
    this.leavePromise = new Promise<boolean>((resolve) => {
      this.leaveResolver = resolve;
      this.discardDialog.open();
    });
    return this.leavePromise;
  }

  confirmDiscardEdits(): void {
    this.resolveNavigation(true);
  }

  keepEditing(): void {
    this.resolveNavigation(false);
  }

  private beginLoad(id: string): void {
    this.allowNavigationAfterDelete = false;
    this.deletionConfirmed.set(false);
    this.routePlanId.set(id);
    this.loading.set(true);
    this.loadError.set(null);
    this.missing.set(false);
    this.plan.set(null);
    this.name.set('');
    this.description.set('');
    this.placeIds.set([]);
    this.places.set([]);
    this.catalogCityId.set(null);
    this.catalogError.set(null);
    this.catalogLoading.set(false);
    this.saveError.set(null);
    this.saveNotice.set(null);
    this.navigationMessage.set(null);
  }

  private acceptLoadedPlan(result: PlanLoadResult): void {
    if (result.id !== this.routePlanId()) {
      return;
    }
    this.loading.set(false);
    if (result.error !== null || result.plan === null) {
      if (isHttpStatus(result.error, 404)) {
        this.missing.set(true);
      } else {
        this.loadError.set(apiErrorMessage(result.error, 'This saved plan could not be loaded'));
      }
      return;
    }
    this.plan.set(result.plan);
    this.name.set(result.plan.name);
    this.description.set(result.plan.description);
    this.placeIds.set([...result.plan.placeIds]);
    this.catalogRequests.next(result.plan.cityId);
  }

  private acceptUpdatedPlan(response: PlanResponse, request: PlanUpsertRequest): void {
    const matchesRequest = response.name === request.name.trim()
      && response.description === request.description
      && response.cityId === request.cityId
      && sameIds(response.placeIds, request.placeIds);
    if (!matchesRequest) {
      this.handleSaveError(new UnexpectedPlanResponseError());
      return;
    }
    this.plan.set(response);
    this.name.set(response.name);
    this.description.set(response.description);
    this.placeIds.set([...response.placeIds]);
    this.saving.set(false);
    this.saveError.set(null);
    this.saveNotice.set('Your changes are saved.');
  }

  private handleSaveError(error: unknown): void {
    this.saving.set(false);
    if (isHttpStatus(error, 404)) {
      this.missing.set(true);
      this.saveError.set('This plan no longer exists. Your edits are still here on this page.');
      return;
    }
    this.saveError.set(apiErrorMessage(error, 'Your changes could not be saved. Your edits are still here.'));
  }

  private markEditsChanged(): void {
    this.saveError.set(null);
    this.saveNotice.set(null);
  }

  private validateEdits(includeNameLimit = true): readonly string[] {
    if (this.plan() === null) {
      return [];
    }
    const errors: string[] = [];
    const trimmedName = this.name().trim();
    if (trimmedName.length === 0) {
      errors.push('Add a name for this plan.');
    } else if (trimmedName.length > PLAN_NAME_MAX_LENGTH && includeNameLimit) {
      errors.push('Plan names can be at most 30 characters.');
    }
    if (this.placeIds().length > 12) {
      errors.push('A saved plan can contain up to 12 places.');
    }
    if (this.description().length > PLAN_DESCRIPTION_MAX_LENGTH) {
      errors.push('Plan descriptions can be at most 500 characters.');
    }
    if (new Set(this.placeIds()).size !== this.placeIds().length) {
      errors.push('A place can only appear once in a plan.');
    }
    return errors;
  }

  private resolveNavigation(allow: boolean): void {
    const resolve = this.leaveResolver;
    if (resolve === null) {
      return;
    }
    this.leaveResolver = null;
    this.leavePromise = null;
    this.discardDialog.close();
    resolve(allow);
  }

  private syncBeforeUnloadListener(shouldListen: boolean): void {
    if (typeof window === 'undefined' || shouldListen === this.beforeUnloadAttached) {
      return;
    }
    if (shouldListen) {
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    } else {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }
    this.beforeUnloadAttached = shouldListen;
  }
}

function sameIds(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((id, index) => id === second[index]);
}

function isHttpStatus(error: unknown, status: number): boolean {
  return error instanceof HttpErrorResponse && error.status === status;
}
