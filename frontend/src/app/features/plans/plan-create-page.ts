import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, map, of, Subject, switchMap } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { PlacesApiService } from '../../core/api/places-api.service';
import { PlansApiService, UnexpectedPlanResponseError } from '../../core/api/plans-api.service';
import { CITY_IDS, CityId, PlaceDto, isCityId } from '../../core/models/catalog.models';
import { PlanResponse, PlanUpsertRequest } from '../../core/models/plan.models';
import { DraftPlan } from '../../core/models/draft-plan.models';
import { DraftPlanStore } from '../../core/services/draft-plan.store';
import { MainNavigationComponent } from '../shared/main-navigation';
import { PlanCreateNavigationGuard } from './plan-create.guard';

type CatalogResult = Readonly<{
  cityId: CityId;
  places: readonly PlaceDto[] | null;
  error: string | null;
}>;

const CITY_NAMES: Readonly<Record<CityId, string>> = {
  amsterdam: 'Amsterdam',
  rotterdam: 'Rotterdam',
  utrecht: 'Utrecht',
};

@Component({
  selector: 'app-plan-create-page',
  imports: [RouterLink, MainNavigationComponent],
  templateUrl: './plan-create-page.html',
  styleUrls: ['./plans-page.css', './plan-create-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanCreatePage implements PlanCreateNavigationGuard {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly placesApi = inject(PlacesApiService);
  private readonly plansApi = inject(PlansApiService);
  private readonly catalogRequests = new Subject<CityId>();
  private initialized = false;

  readonly draftStore = inject(DraftPlanStore);
  readonly cityIds = CITY_IDS;
  readonly requestedCityId = signal<CityId>('amsterdam');
  readonly catalogCityId = signal<CityId | null>(null);
  readonly places = signal<readonly PlaceDto[]>([]);
  readonly catalogLoading = signal(true);
  readonly catalogError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly createError = signal<string | null>(null);
  readonly createSuccess = signal<string | null>(null);
  readonly savedPlanId = signal<string | null>(null);
  readonly navigationMessage = signal<string | null>(null);
  readonly unknownOutcome = signal(false);

  readonly currentCityId = computed(
    () => this.draftStore.draft()?.cityId ?? this.draftStore.pendingCityId() ?? this.requestedCityId(),
  );
  readonly draftPlaceRows = computed(() => {
    const draft = this.draftStore.draft();
    if (draft === null) {
      return [];
    }
    const placesById = new Map(this.places().map((place) => [place.id, place]));
    return draft.placeIds.map((id) => ({ id, place: placesById.get(id) ?? null }));
  });
  readonly validationMessages = computed(() => this.validateCurrentDraft());
  readonly canSave = computed(
    () => !this.saving()
      && !this.draftStore.isValidating()
      && this.draftStore.cityConflict() === null
      && !this.catalogLoading()
      && this.catalogError() === null
      && this.validationMessages().length === 0,
  );

  constructor() {
    this.catalogRequests
      .pipe(
        switchMap((cityId) => {
          this.catalogLoading.set(true);
          this.catalogError.set(null);
          this.catalogCityId.set(null);
          this.places.set([]);
          return this.placesApi.getPlaces(cityId).pipe(
            map((places) => ({ cityId, places, error: null }) satisfies CatalogResult),
            catchError((error: unknown) => of({
              cityId,
              places: null,
              error: apiErrorMessage(error, 'Could not load this city catalog'),
            } satisfies CatalogResult)),
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
    return CITY_NAMES[cityId];
  }

  onNameInput(event: Event): void {
    if (this.saving()) {
      return;
    }
    this.draftStore.renameDraft((event.target as HTMLInputElement).value);
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

  keepExistingDraft(): void {
    if (this.saving()) {
      return;
    }
    this.draftStore.keepExistingDraft();
    const cityId = this.draftStore.draft()?.cityId;
    if (cityId !== undefined) {
      this.navigateToCity(cityId);
    }
  }

  replaceDraftWithRequestedCity(): void {
    if (this.saving()) {
      return;
    }
    const conflict = this.draftStore.cityConflict();
    if (conflict === null || !this.draftStore.startDraftForRequestedCity()) {
      return;
    }
    this.requestedCityId.set(conflict.cityId);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { city: conflict.cityId },
      queryParamsHandling: 'merge',
    });
    this.loadCatalog(conflict.cityId);
  }

  retryCatalog(): void {
    if (this.saving()) {
      return;
    }
    const cityId = this.draftStore.pendingCityId() ?? this.currentCityId();
    if (this.draftStore.pendingCityId() !== null) {
      this.draftStore.beginValidation();
    }
    this.loadCatalog(cityId);
  }

  save(): void {
    if (this.saving() || !this.canSave()) {
      return;
    }
    const draft = this.draftStore.draft();
    if (draft === null) {
      return;
    }

    Object.freeze(draft.placeIds);
    Object.freeze(draft);
    const request: PlanUpsertRequest = Object.freeze({
      name: draft.name.trim(),
      cityId: draft.cityId,
      placeIds: Object.freeze([...draft.placeIds]),
    });
    this.createError.set(null);
    this.createSuccess.set(null);
    this.savedPlanId.set(null);
    this.navigationMessage.set(null);
    this.unknownOutcome.set(false);
    this.saving.set(true);

    this.plansApi
      .createPlan(request)
      .pipe(
        finalize(() => {
          this.saving.set(false);
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
      const draftCityId = pendingCityId ?? existing?.cityId ?? routeCityId;
      if (pendingCityId === null && existing === null) {
        this.draftStore.initializeDraft(routeCityId, this.cityName(routeCityId));
      } else if (
        pendingCityId === null
        && existing !== null
        && existing.cityId !== routeCityId
        && this.draftStore.cityConflict() === null
      ) {
        this.draftStore.requestCityChange(routeCityId, this.cityName(routeCityId));
      }
      this.loadCatalog(draftCityId);
      return;
    }

    const activeCityId = pendingCityId ?? existing?.cityId ?? null;
    if (activeCityId !== null && activeCityId !== routeCityId) {
      if (this.draftStore.cityConflict()?.cityId !== routeCityId) {
        this.draftStore.requestCityChange(routeCityId, this.cityName(routeCityId));
      }
      return;
    }
    if (activeCityId === null) {
      this.draftStore.initializeDraft(routeCityId, this.cityName(routeCityId));
    }
    this.loadCatalog(routeCityId);
  }

  private acceptCatalogResult(result: CatalogResult): void {
    this.catalogLoading.set(false);
    if (result.error !== null || result.places === null) {
      this.catalogError.set(result.error ?? 'Could not load this city catalog.');
      if (this.draftStore.pendingCityId() === result.cityId) {
        this.draftStore.failValidation(this.catalogError()!);
      }
      return;
    }

    const cityPlaces = result.places.filter((place) => place.cityId === result.cityId);
    this.catalogCityId.set(result.cityId);
    this.places.set(cityPlaces);
    if (this.draftStore.pendingCityId() === result.cityId) {
      this.draftStore.validatePendingDraft(result.cityId, cityPlaces);
      const draft = this.draftStore.draft();
      const requestedCity = this.requestedCityId();
      if (
        draft !== null
        && draft.cityId !== requestedCity
        && this.draftStore.cityConflict() === null
      ) {
        this.draftStore.requestCityChange(requestedCity, this.cityName(requestedCity));
      }
    }
  }

  private loadCatalog(cityId: CityId): void {
    this.catalogRequests.next(cityId);
  }

  private navigateToCity(cityId: CityId): void {
    this.requestedCityId.set(cityId);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { city: cityId },
      queryParamsHandling: 'merge',
    });
  }

  private validateCurrentDraft(): readonly string[] {
    const draft = this.draftStore.draft();
    if (draft === null || this.draftStore.isValidating()) {
      return [];
    }
    const errors: string[] = [];
    const name = draft.name.trim();
    if (name.length === 0) {
      errors.push('Add a name for this plan.');
    } else if (name.length > 80) {
      errors.push('Plan names can be at most 80 characters.');
    }
    if (draft.placeIds.length < 1 || draft.placeIds.length > 12) {
      errors.push('Choose between 1 and 12 places before saving.');
    }
    if (this.catalogCityId() !== draft.cityId || this.catalogError() !== null) {
      errors.push('Load the selected city catalog before saving.');
    } else {
      const placeIds = new Set(this.places().map((place) => place.id));
      if (draft.placeIds.some((placeId) => !placeIds.has(placeId))) {
        errors.push('Remove places that are no longer in this city catalog.');
      }
    }
    return errors;
  }

  private acceptCreatedPlan(response: PlanResponse, request: PlanUpsertRequest, submittedDraft: DraftPlan): void {
    const matchesRequest = response.name === request.name
      && response.cityId === request.cityId
      && response.placeIds.length === request.placeIds.length
      && response.placeIds.every((id, index) => id === request.placeIds[index]);
    if (!matchesRequest) {
      this.showCreateError(new UnexpectedPlanResponseError());
      return;
    }

    this.saving.set(false);
    if (!this.draftStore.clearAfterSuccessfulSave(submittedDraft)) {
      this.createSuccess.set(
        'The submitted plan was saved. A newer unsaved tab draft remains and was not included in that save.',
      );
      this.savedPlanId.set(response.id);
      return;
    }
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
