import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, map, Subject, switchMap } from 'rxjs';
import { loadAllCityPlaces } from '../../core/api/all-city-places';
import { apiErrorMessage } from '../../core/api/api-error';
import { PlacesApiService } from '../../core/api/places-api.service';
import { PlansApiService, UnexpectedPlanResponseError } from '../../core/api/plans-api.service';
import { CITY_IDS, CITY_LABELS, CityId, PlaceDto, isCityId } from '../../core/models/catalog.models';
import { MAX_PLAN_PLACES, PLAN_NAME_MAX_LENGTH, PLAN_DESCRIPTION_MAX_LENGTH, PlanResponse, PlanUpsertRequest, isAllocatedPlanName } from '../../core/models/plan.models';
import { DraftPlan } from '../../core/models/draft-plan.models';
import { DraftPlanStore } from '../../core/services/draft-plan.store';
import { ActivePlanStore } from '../../core/services/active-plan.store';
import { PlanAutosaveService } from '../../core/services/plan-autosave.service';
import { MainNavigationComponent } from '../shared/main-navigation';
import { PointerLightDirective } from '../shared/pointer-light';
import { PlanCreateNavigationGuard } from './plan-create.guard';

type CatalogResult = Readonly<{
  cityId: CityId;
  places: readonly PlaceDto[] | null;
  error: string | null;
}>;

@Component({
  selector: 'app-plan-create-page',
  imports: [RouterLink, MainNavigationComponent, PointerLightDirective],
  templateUrl: './plan-create-page.html',
  styleUrls: ['./plans-page.css', './plan-create-page.css', './plan-stops-table.css', './plan-workspace.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanCreatePage implements PlanCreateNavigationGuard {
  readonly autosave = inject(PlanAutosaveService);
  private readonly activePlanStore = inject(ActivePlanStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly placesApi = inject(PlacesApiService);
  private readonly plansApi = inject(PlansApiService);
  private readonly catalogRequests = new Subject<CityId>();
  private initialized = false;

  readonly draftStore = inject(DraftPlanStore);
  readonly descriptionMaxLength = PLAN_DESCRIPTION_MAX_LENGTH;
  readonly nameMaxLength = PLAN_NAME_MAX_LENGTH;
  readonly cityIds = CITY_IDS;
  readonly requestedCityId = signal<CityId>('amsterdam');
  readonly catalogCityId = signal<CityId | null>(null);
  readonly places = signal<readonly PlaceDto[]>([]);
  readonly catalogLoading = signal(true);
  readonly catalogError = signal<string | null>(null);
  private readonly manualSaving = signal(false);
  readonly saving = computed(() => this.manualSaving() || this.autosave.pending());
  readonly createError = signal<string | null>(null);
  readonly createSuccess = signal<string | null>(null);
  readonly savedPlanId = signal<string | null>(null);
  readonly navigationMessage = signal<string | null>(null);
  readonly unknownOutcome = signal(false);

  readonly draftPlaceRows = computed(() => {
    const draft = this.draftStore.draft();
    if (draft === null) {
      return [];
    }
    const placesById = new Map(this.places().map((place) => [place.id, place]));
    return draft.placeIds.map((id) => ({ id, place: placesById.get(id) ?? null }));
  });
  readonly validationMessages = computed(() => this.validateCurrentDraft());
  readonly formValidationMessages = computed(() => this.validateCurrentDraft(false));
  readonly canSave = computed(
    () => !this.saving()
      && !this.draftStore.isValidating()
      && !this.catalogLoading()
      && this.validationMessages().length === 0,
  );

  constructor() {
    this.activePlanStore.clear();
    effect(() => {
      const saved = this.autosave.lastSaved();
      if (saved && !this.draftStore.draft() && this.activePlanStore.selectedId() === saved.id) {
        void this.router.navigate(['/plans', saved.id]);
      }
    });
    this.catalogRequests
      .pipe(
        switchMap((cityId) => {
          this.catalogLoading.set(true);
          this.catalogError.set(null);
          this.catalogCityId.set(null);
          this.places.set([]);
          return loadAllCityPlaces(this.placesApi).pipe(
            map((catalog) => ({ ...catalog, cityId }) satisfies CatalogResult),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.acceptCatalogResult(result));

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => this.handleRouteCity(params.get('city')));
  }

  cityName(cityId: CityId): string {
    return CITY_LABELS[cityId];
  }

  onNameInput(event: Event): void {
    if (this.saving()) {
      return;
    }
    this.draftStore.renameDraft((event.target as HTMLInputElement).value);
  }

  onDescriptionInput(event: Event): void {
    if (!this.saving()) {
      this.draftStore.updateDescription((event.target as HTMLTextAreaElement).value);
    }
  }

  onCitySelected(event: Event): void {
    if (this.saving()) {
      return;
    }
    const cityId = (event.target as HTMLSelectElement).value;
    if (!isCityId(cityId)) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { city: cityId },
      queryParamsHandling: 'merge',
    });
  }

  movePlace(placeId: string, direction: 'up' | 'down'): void {
    if (this.saving()) {
      return;
    }
    this.draftStore.movePlace(placeId, direction);
  }

  removePlace(placeId: string): void {
    if (this.saving()) {
      return;
    }
    this.draftStore.removePlace(placeId);
  }

  retryCatalog(): void {
    if (this.saving()) {
      return;
    }
    if (this.draftStore.pendingCityId() !== null) {
      this.draftStore.beginValidation();
    }
    this.loadCatalog(this.requestedCityId());
  }

  save(): void {
    if (this.saving() || !this.canSave()) {
      return;
    }
    const draft = this.draftStore.draft();
    if (draft === null) {
      return;
    }

    if (draft.autosaveId) {
      this.autosave.save();
      return;
    }

    const request: PlanUpsertRequest = Object.freeze({
      name: draft.name.trim(),
      description: draft.description.trim(),
      cityId: draft.cityId,
      placeIds: Object.freeze([...draft.placeIds]),
    });
    this.createError.set(null);
    this.createSuccess.set(null);
    this.savedPlanId.set(null);
    this.navigationMessage.set(null);
    this.unknownOutcome.set(false);
    this.manualSaving.set(true);

    this.plansApi
      .createPlan(request)
      .pipe(
        finalize(() => {
          this.manualSaving.set(false);
          this.navigationMessage.set(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => this.acceptCreatedPlan(response, request, draft),
        error: (error: unknown) => this.showCreateError(error),
      });
  }

  confirmNavigationAway(): boolean {
    if (!this.saving()) {
      return true;
    }
    this.navigationMessage.set('Saving in progress. Please wait for confirmation.');
    return false;
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.saving()) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  }

  private handleRouteCity(value: string | null): void {
    if (this.saving()) {
      this.navigationMessage.set('Saving in progress. Please wait for confirmation.');
      return;
    }
    const draftCityId = this.draftStore.pendingCityId() ?? this.draftStore.draft()?.cityId;
    const routeCityId = isCityId(value)
      ? value
      : value === null
        ? draftCityId ?? 'amsterdam'
        : 'amsterdam';
    this.requestedCityId.set(routeCityId);
    if (value !== null && !isCityId(value)) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { city: routeCityId },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      return;
    }

    const pendingCityId = this.draftStore.pendingCityId();
    const existing = this.draftStore.draft();
    if (!this.initialized) {
      this.initialized = true;
      if (pendingCityId === null && existing === null) {
        this.draftStore.initializeDraft(routeCityId);
      } else if (pendingCityId === null && existing !== null && existing.cityId !== routeCityId) {
        this.draftStore.requestCityChange(routeCityId);
      }
      this.loadCatalog(routeCityId);
      return;
    }

    if (pendingCityId === null && existing === null) {
      this.draftStore.initializeDraft(routeCityId);
    } else if (pendingCityId === null && existing?.cityId !== routeCityId) {
      this.draftStore.requestCityChange(routeCityId);
    }
    this.loadCatalog(routeCityId);
  }

  private acceptCatalogResult(result: CatalogResult): void {
    this.catalogLoading.set(false);
    this.catalogCityId.set(result.cityId);
    if (result.places === null) {
      this.catalogError.set(result.error ?? 'Could not load this city catalog.');
      if (this.draftStore.pendingCityId() !== null) {
        this.draftStore.failValidation(this.catalogError()!);
      }
      return;
    }

    const catalogPlaces = result.places.filter((place) => CITY_IDS.includes(place.cityId));
    this.places.set(catalogPlaces);
    this.catalogError.set(result.error);
    const pendingCityId = this.draftStore.pendingCityId();
    if (pendingCityId !== null) {
      if (result.error !== null) {
        this.draftStore.failValidation(result.error);
      } else {
        this.draftStore.validatePendingDraft(pendingCityId, catalogPlaces);
      }
      const draft = this.draftStore.draft();
      const requestedCity = this.requestedCityId();
      if (draft !== null && draft.cityId !== requestedCity) {
        this.draftStore.requestCityChange(requestedCity);
      }
    }
  }

  private loadCatalog(cityId: CityId): void {
    this.catalogRequests.next(cityId);
  }

  private validateCurrentDraft(includeNameLimit = true): readonly string[] {
    const draft = this.draftStore.draft();
    if (draft === null || this.draftStore.isValidating()) {
      return [];
    }
    const errors: string[] = [];
    const name = draft.name.trim();
    if (name.length === 0) {
      errors.push('Add a name for this plan.');
    } else if (name.length > PLAN_NAME_MAX_LENGTH && includeNameLimit) {
      errors.push('Plan names can be at most 30 characters.');
    }
    if (draft.placeIds.length > MAX_PLAN_PLACES) {
      errors.push('Choose up to 12 places before saving.');
    }
    if (draft.description.length > PLAN_DESCRIPTION_MAX_LENGTH) {
      errors.push('Plan descriptions can be at most 500 characters.');
    }
    if (this.catalogCityId() !== draft.cityId || this.catalogLoading()) {
      errors.push('Load the selected city catalog before saving.');
    } else {
      const placeIds = new Set(this.places().map((place) => place.id));
      if (draft.placeIds.some((placeId) => !placeIds.has(placeId))) {
        errors.push(this.catalogError() === null
          ? 'Remove places that are no longer in the supported catalogs.'
          : 'Retry loading places to verify every stop in this plan.');
      }
    }
    return errors;
  }

  private acceptCreatedPlan(response: PlanResponse, request: PlanUpsertRequest, submittedDraft: DraftPlan): void {
    const matchesRequest = isAllocatedPlanName(request.name, response.name)
      && response.description === request.description
      && response.cityId === request.cityId
      && response.placeIds.length === request.placeIds.length
      && response.placeIds.every((id, index) => id === request.placeIds[index]);
    if (!matchesRequest) {
      this.showCreateError(new UnexpectedPlanResponseError());
      return;
    }

    this.manualSaving.set(false);
    if (!this.draftStore.clearAfterSuccessfulSave(submittedDraft)) {
      this.createSuccess.set(
        'The submitted plan was saved. A newer unsaved tab draft remains and was not included in that save.',
      );
      this.savedPlanId.set(response.id);
      return;
    }
    this.activePlanStore.select(response.id);
    void this.router.navigate(['/plans', response.id]);
  }

  private showCreateError(error: unknown): void {
    const unknown = error instanceof UnexpectedPlanResponseError
      || (error instanceof HttpErrorResponse
        && (error.status === 0 || error.status >= 500 || (error.status >= 200 && error.status < 300)));
    this.unknownOutcome.set(unknown);
    const detail = apiErrorMessage(error, 'Could not save this plan');
    this.createError.set(unknown
      ? `${detail} The server may have created the plan. Check Saved Plans before trying again.`
      : detail);
  }
}
