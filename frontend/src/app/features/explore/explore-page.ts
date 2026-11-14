import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  Injector,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  finalize,
  map,
  merge,
  type Observable,
  of,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { CitiesApiService } from '../../core/api/cities-api.service';
import { DiscoverApiService } from '../../core/api/discover-api.service';
import { HealthApiService, UnexpectedHealthResponseError } from '../../core/api/health-api.service';
import { PlacesApiService } from '../../core/api/places-api.service';
import { PlansApiService, UnexpectedPlanResponseError } from '../../core/api/plans-api.service';
import { StopsApiService } from '../../core/api/stops-api.service';
import { DraftPlanStore } from '../../core/services/draft-plan.store';
import { ActivePlanStore } from '../../core/services/active-plan.store';
import { PlanAutosaveService } from '../../core/services/plan-autosave.service';
import {
  CityDto,
  CityId,
  CITY_IDS,
  DiscoverDto,
  DiscoverTheme,
  MobilityHubDto,
  PlaceCategory,
  PlaceDto,
  isCityId,
} from '../../core/models/catalog.models';
import { PlanResponse, PlanUpsertRequest } from '../../core/models/plan.models';
import { MainNavigationComponent } from '../shared/main-navigation';
import { CategoryIconComponent } from '../shared/category-icon';
import { PointerLightDirective } from '../shared/pointer-light';
import { MapViewportComponent } from './map-viewport';
import { NearbyHub, nearbyHubsForPlace } from './nearby-hubs';
import { AddPlaceEvent, PlaceDetailComponent } from './place-detail';
import { getFeaturedPlaceImage } from './place-image-attribution';
import { PlaceResultsListComponent, type PlaceResultsView } from './place-results-list';

type ApiState = 'checking' | 'online' | 'offline' | 'unexpected';

type CityResourceStatus = 'loading' | 'success' | 'empty' | 'error';

type CityResourceState<T> = Readonly<{
  status: CityResourceStatus;
  data: readonly T[] | null;
  error: string | null;
}>;

type PlaceLoadResult = Readonly<{
  cityId: CityId;
  data: readonly PlaceDto[] | null;
  error: string | null;
}>;

type HubLoadResult = Readonly<{
  cityId: CityId;
  data: readonly MobilityHubDto[] | null;
  error: string | null;
}>;

type DiscoverRequest = Readonly<{ theme: DiscoverTheme; requestId: number }>;

type DiscoverCityGroup = Readonly<{
  cityId: CityId;
  status: 'loading' | 'success' | 'empty' | 'error';
  description: string | null;
  placeIds: readonly string[];
  error: string | null;
}>;

type DiscoverCityOutcome = Readonly<{
  request: DiscoverRequest;
  cityId: CityId;
  response: DiscoverDto | null;
  error: string | null;
}>;

type SavedPlanContextResult = Readonly<{
  id: string;
  plan: PlanResponse | null;
  error: string | null;
}>;

type SavedPlanFeedback = Readonly<{
  message: string;
  role: 'status' | 'alert';
}>;

type SavedPlanAddResult = Readonly<{
  plan: PlanResponse;
  addedCount: number;
}>;

function initialCityResourceStates<T>(): Record<CityId, CityResourceState<T>> {
  return Object.fromEntries(CITY_IDS.map((cityId) => [cityId, {
    status: 'loading',
    data: null,
    error: null,
  }])) as Record<CityId, CityResourceState<T>>;
}

const DEFAULT_CITY: CityId = 'amsterdam';
const INITIAL_PLACE_LIMIT = 40;
const PLACE_BATCH_SIZE = 40;

const CITY_LABELS: Readonly<Record<CityId, string>> = {
  amsterdam: 'Amsterdam',
  rotterdam: 'Rotterdam',
  utrecht: 'Utrecht',
};

export function resolveCityId(value: string | null): CityId {
  return isCityId(value) ? value : DEFAULT_CITY;
}

@Component({
  selector: 'app-explore-page',
  imports: [MapViewportComponent, PlaceDetailComponent, PlaceResultsListComponent, MainNavigationComponent, CategoryIconComponent, PointerLightDirective, RouterLink],
  templateUrl: './explore-page.html',
  styleUrls: ['./explore-page.css', './explore-atmosphere.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorePage {
  readonly autosave = inject(PlanAutosaveService);
  private readonly activePlanStore = inject(ActivePlanStore);
  private readonly healthApi = inject(HealthApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly citiesApi = inject(CitiesApiService);
  private readonly placesApi = inject(PlacesApiService);
  private readonly stopsApi = inject(StopsApiService);
  private readonly discoverApi = inject(DiscoverApiService);
  private readonly plansApi = inject(PlansApiService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly retryCities$ = new Subject<void>();
  private readonly retryPlaces$ = new Subject<void>();
  private readonly retryHubs$ = new Subject<void>();
  private readonly discoverRequest$ = new Subject<DiscoverRequest | null>();
  private healthCheckPending = false;
  private discoverRequestId = 0;
  private readonly pendingDiscoverOutcomes = new Map<CityId, DiscoverCityOutcome>();
  private detailFocusReturn: HTMLElement | null = null;

  readonly cityIds = CITY_IDS;
  readonly categoryOptions: readonly Readonly<{ label: string; value: PlaceCategory | null }>[] = [
    { label: 'All', value: null },
    { label: 'Architecture', value: 'ARCHITECTURE' },
    { label: 'Museums', value: 'MUSEUMS' },
    { label: 'Culture', value: 'CULTURE' },
    { label: 'Parks & nature', value: 'PARKS_NATURE' },
    { label: 'Landmarks', value: 'LANDMARKS' },
  ];
  readonly categoryLabels: Readonly<Record<PlaceCategory, string>> = {
    ARCHITECTURE: 'Architecture',
    MUSEUMS: 'Museums',
    CULTURE: 'Culture',
    PARKS_NATURE: 'Parks & nature',
    LANDMARKS: 'Landmarks',
  };
  readonly discoverThemes: readonly Readonly<{ value: DiscoverTheme; label: string }>[] = [
    { value: 'architecture', label: 'Architecture Hunt' },
    { value: 'culture', label: 'Culture Day' },
    { value: 'green', label: 'Green Escape' },
  ];

  readonly apiState = signal<ApiState>('checking');
  readonly apiStatusText = signal('Checking local API');
  readonly cities = signal<readonly CityDto[]>([]);
  readonly citiesLoading = signal(true);
  readonly citiesError = signal<string | null>(null);
  readonly placeCityStates = signal(initialCityResourceStates<PlaceDto>());
  readonly places = computed(() => CITY_IDS.flatMap((cityId) =>
    this.placeCityStates()[cityId].data ?? [],
  ));
  readonly placesLoading = computed(() => {
    const states = CITY_IDS.map((cityId) => this.placeCityStates()[cityId]);
    const hasPlaces = states.some((state) => (state.data?.length ?? 0) > 0);
    return !hasPlaces && states.some((state) => state.status === 'loading');
  });
  readonly placesError = computed(() => {
    const states = CITY_IDS.map((cityId) => ({ cityId, ...this.placeCityStates()[cityId] }));
    const hasPlaces = states.some((state) => (state.data?.length ?? 0) > 0);
    const stillLoading = states.some((state) => state.status === 'loading');
    if (hasPlaces || stillLoading) {
      return null;
    }
    const failed = states.filter((state) => state.status === 'error');
    return failed.length === 0
      ? null
      : `Places could not be loaded for ${failed.map((state) => CITY_LABELS[state.cityId]).join(', ')}.`;
  });
  readonly placesWarning = computed(() => {
    const states = CITY_IDS.map((cityId) => ({ cityId, ...this.placeCityStates()[cityId] }));
    const failed = states.filter((state) => state.status === 'error');
    const hasAvailableCatalog = states.some((state) => state.data !== null);
    return failed.length > 0 && hasAvailableCatalog
      ? `Some places are unavailable: ${failed.map((state) => CITY_LABELS[state.cityId]).join(', ')} could not load.`
      : null;
  });
  readonly hasPlaceCatalogNotices = computed(() =>
    CITY_IDS.some((cityId) => this.placeCityStates()[cityId].status !== 'success'),
  );
  readonly hubCityStates = signal(initialCityResourceStates<MobilityHubDto>());
  readonly hubs = computed(() => CITY_IDS.flatMap((cityId) =>
    this.hubCityStates()[cityId].data ?? [],
  ));
  readonly selectedHubState = computed(() => {
    const place = this.selectedPlace();
    return place === null ? null : this.hubCityStates()[place.cityId];
  });
  readonly hubsLoading = computed(() => {
    const state = this.selectedHubState();
    return state !== null && state.status === 'loading' && state.data === null;
  });
  readonly hubsError = computed(() => {
    const state = this.selectedHubState();
    return state?.status === 'error' ? state.error : null;
  });
  readonly searchQuery = signal('');
  readonly activeCategory = signal<PlaceCategory | null>(null);
  readonly selectedPlaceId = signal<string | null>(null);
  readonly visiblePlaceLimit = signal(INITIAL_PLACE_LIMIT);
  readonly activeDiscoverTheme = signal<DiscoverTheme | null>(null);
  readonly discoverState = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  readonly discoverGroups = signal<readonly DiscoverCityGroup[]>([]);
  readonly discoverWarning = signal<string | null>(null);
  readonly discoverError = signal<string | null>(null);
  readonly discoverPlaceIds = signal<readonly string[]>([]);
  readonly draftFeedback = signal('');
  readonly savedPlanContextId = signal<string | null>(null);
  readonly savedPlanContext = signal<PlanResponse | null>(null);
  readonly savedPlanContextLoading = signal(false);
  readonly savedPlanContextError = signal<string | null>(null);
  readonly savedPlanAddPending = signal(false);
  readonly savedPlanFeedback = signal<SavedPlanFeedback | null>(null);
  readonly draftStore = inject(DraftPlanStore);
  @ViewChild(PlaceDetailComponent) private placeDetail?: PlaceDetailComponent;
  @ViewChild(MapViewportComponent) private mapViewport?: MapViewportComponent;

  readonly draftEditorCityId = computed(
    () => this.draftStore.draft()?.cityId ?? this.draftStore.pendingCityId() ?? DEFAULT_CITY,
  );
  readonly selectedPlace = computed(() => {
    const selectedId = this.selectedPlaceId();
    return selectedId === null
      ? null
      : this.places().find((place) => place.id === selectedId) ?? null;
  });
  readonly nearbyHubs = computed<readonly NearbyHub[]>(() => {
    const place = this.selectedPlace();
    return place === null
      ? []
      : nearbyHubsForPlace(place, this.hubCityStates()[place.cityId].data ?? []);
  });
  readonly filteredPlaces = computed(() => {
    const query = normalizeSearch(this.searchQuery().trim());
    const category = this.activeCategory();
    return this.places().filter(
      (place) =>
        (category === null || place.category === category) &&
        (query.length === 0 || normalizeSearch(place.name).includes(query)),
    );
  });
  readonly featuredPlace = computed(() => {
    const attributions = new Map(
      CITY_IDS.map((cityId) => [cityId, getFeaturedPlaceImage(cityId)]),
    );
    return this.places().filter((place) => {
      const attribution = attributions.get(place.cityId);
      return attribution !== null
        && attribution !== undefined
        && place.id === attribution.placeId
        && place.imagePath === attribution.imagePath
        && place.imageAttributionId === attribution.id;
    });
  });
  readonly visiblePlaces = computed(() => {
    const filtered = this.filteredPlaces();
    const featuredIds = new Set(this.featuredPlace().map((place) => place.id));
    const ordered = [...filtered].sort(
      (left, right) => Number(featuredIds.has(right.id)) - Number(featuredIds.has(left.id)),
    );
    const visible = ordered.slice(0, this.visiblePlaceLimit());
    const selectedId = this.selectedPlaceId();
    if (selectedId === null || visible.some((place) => place.id === selectedId)) {
      return visible;
    }
    const selectedPlace = filtered.find((place) => place.id === selectedId);
    return selectedPlace ? [selectedPlace, ...visible] : visible;
  });
  readonly resultCount = computed(() => this.filteredPlaces().length);
  readonly resultCountLabel = computed(() => {
    const count = this.resultCount();
    return `${count} ${count === 1 ? 'place' : 'places'}`;
  });
  readonly hasMorePlaces = computed(() => this.visiblePlaceLimit() < this.resultCount());
  readonly hasActiveFilters = computed(
    () => this.searchQuery().trim().length > 0 || this.activeCategory() !== null,
  );
  readonly placeResultsView = computed<PlaceResultsView>(() => ({
    cityName: 'Amsterdam, Rotterdam and Utrecht',
    loading: this.placesLoading(),
    error: this.placesError(),
    count: this.resultCount(),
    activeFilters: this.hasActiveFilters(),
    places: this.visiblePlaces(),
    selectedPlaceId: this.selectedPlaceId(),
    discoverPlaceIds: this.discoverPlaceIds(),
    categoryLabels: this.categoryLabels,
    hasMore: this.hasMorePlaces(),
    remainingCount: this.resultCount() - this.visiblePlaceLimit(),
  }));

  constructor() {
    this.normalizeLegacyCityUrl();
    this.watchSavedPlanContext();
    this.checkHealth();
    this.loadCities();
    this.watchDiscoverRequests();
    this.loadPlacesForAllCities();
    this.loadHubsForAllCities();
  }

  private watchSavedPlanContext(): void {
    combineLatest([this.route.queryParamMap, toObservable(this.activePlanStore.selectedId)])
      .pipe(
        map(([params, activeId]) => params.get('plan')?.trim() || activeId),
        distinctUntilChanged(),
        tap((id) => {
          this.savedPlanContextId.set(id);
          this.savedPlanContext.set(null);
          this.savedPlanContextError.set(null);
          this.savedPlanFeedback.set(null);
          this.savedPlanContextLoading.set(id !== null);
        }),
        switchMap((id) => id === null
          ? of(null)
          : (this.autosave.lastSaved()?.id === id ? of(this.autosave.lastSaved()!) : this.plansApi.getPlan(id)).pipe(
            map((plan) => ({ id, plan, error: null }) satisfies SavedPlanContextResult),
            catchError((error: unknown) => {
              if (error instanceof HttpErrorResponse && error.status === 404) {
                this.activePlanStore.clear(id);
                if (!this.route.snapshot.queryParamMap.has('plan')) {
                  this.savedPlanContextId.set(null);
                  this.savedPlanContextLoading.set(false);
                  return of(null);
                }
              }
              return of({
                id,
                plan: null,
                error: apiErrorMessage(error, 'This saved plan could not be loaded'),
              } satisfies SavedPlanContextResult);
            }),
          )),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result === null || result.id !== this.savedPlanContextId()) {
          return;
        }
        this.savedPlanContextLoading.set(false);
        if (result.error !== null || result.plan === null) {
          this.savedPlanContextError.set(result.error ?? 'This saved plan could not be loaded.');
          return;
        }
        this.savedPlanContext.set(result.plan);
        this.activePlanStore.select(result.plan.id);
      });
  }

  private normalizeLegacyCityUrl(): void {
    if (!this.route.snapshot.queryParamMap.has('city')) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { city: null },
      queryParamsHandling: 'merge',
      fragment: this.route.snapshot.fragment ?? undefined,
      replaceUrl: true,
    });
  }

  retryHealthCheck(): void {
    if (this.healthCheckPending) {
      return;
    }
    this.apiState.set('checking');
    this.apiStatusText.set('Checking local API');
    this.checkHealth();
  }

  retryCities(): void {
    this.retryCities$.next();
  }

  retryPlaces(): void {
    this.retryPlaces$.next();
  }

  retryHubs(): void {
    this.retryHubs$.next();
  }

  retryDraftValidation(): void {
    if (this.draftStore.pendingCityId() === null) {
      return;
    }
    this.draftStore.beginValidation();
    this.retryPlaces();
  }

  onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
    this.visiblePlaceLimit.set(INITIAL_PLACE_LIMIT);
    this.clearSelectionIfFilteredOut();
  }

  selectCategory(category: PlaceCategory | null): void {
    this.activeCategory.set(category);
    this.visiblePlaceLimit.set(INITIAL_PLACE_LIMIT);
    this.clearSelectionIfFilteredOut();
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.activeCategory.set(null);
    this.visiblePlaceLimit.set(INITIAL_PLACE_LIMIT);
  }

  showMorePlaces(): void {
    this.visiblePlaceLimit.update((limit) => limit + PLACE_BATCH_SIZE);
  }

  selectPlace(placeId: string, trigger?: EventTarget | null): void {
    if (!this.filteredPlaces().some((place) => place.id === placeId)) {
      return;
    }
    this.detailFocusReturn = asHtmlElement(trigger);
    this.selectedPlaceId.set(placeId);
    this.focusAfterRender(() => this.placeDetail?.focusHeading());
  }

  selectDiscoverPlace(placeId: string, trigger?: EventTarget | null): void {
    this.searchQuery.set('');
    this.activeCategory.set(null);
    this.visiblePlaceLimit.set(INITIAL_PLACE_LIMIT);
    this.selectPlace(placeId, trigger);
  }

  closePlaceDetails(): void {
    if (this.selectedPlaceId() === null) {
      return;
    }
    this.selectedPlaceId.set(null);
    this.focusAfterRender(() => {
      if (this.detailFocusReturn?.isConnected) {
        this.detailFocusReturn.focus();
      } else {
        this.mapViewport?.focusMap();
      }
      this.detailFocusReturn = null;
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (this.selectedPlaceId() !== null) {
      event.preventDefault();
      this.closePlaceDetails();
    }
  }

  hasPlaceInDraft(placeId: string): boolean {
    if (this.savedPlanContextId() !== null) {
      return this.savedPlanContext()?.placeIds.includes(placeId) ?? false;
    }
    return this.draftStore.draft()?.placeIds.includes(placeId) ?? false;
  }

  planIsFullForPlace(): boolean {
    if (this.savedPlanContextId() !== null) {
      const plan = this.savedPlanContext();
      return plan !== null && plan.placeIds.length >= 12;
    }
    return (this.draftStore.draft()?.placeIds.length ?? 0) >= 12;
  }

  planMapAddDisabled(): boolean {
    return this.autosave.pending() || (this.savedPlanContextId() === null && this.autosave.capacityReached()) || this.savedPlanAddPending()
      || (this.savedPlanContextId() !== null
        && (this.savedPlanContextLoading() || this.savedPlanContext() === null));
  }

  chooseDiscoverTheme(theme: DiscoverTheme): void {
    if (this.activeDiscoverTheme() === theme) {
      this.activeDiscoverTheme.set(null);
      this.discoverRequest$.next(null);
      return;
    }

    this.searchQuery.set('');
    this.activeCategory.set(null);
    this.visiblePlaceLimit.set(INITIAL_PLACE_LIMIT);
    this.activeDiscoverTheme.set(theme);
    this.requestDiscoverTheme(theme);
  }

  retryDiscover(): void {
    const theme = this.activeDiscoverTheme();
    if (theme !== null) {
      this.requestDiscoverTheme(theme);
    }
  }

  private requestDiscoverTheme(theme: DiscoverTheme): void {
    const request = { theme, requestId: ++this.discoverRequestId } satisfies DiscoverRequest;
    this.pendingDiscoverOutcomes.clear();
    this.discoverState.set('loading');
    this.discoverGroups.set(CITY_IDS.map((cityId) => ({
      cityId,
      status: 'loading',
      description: null,
      placeIds: [],
      error: null,
    })));
    this.discoverWarning.set(null);
    this.discoverError.set(null);
    this.discoverPlaceIds.set([]);
    this.discoverRequest$.next(request);
  }

  addPlaceToPlan(placeId: string): void {
    this.requestDraftAdd([placeId]);
  }

  addDetailPlaceToPlan(event: AddPlaceEvent): void {
    this.addPlaceToPlan(event.placeId);
  }

  cityName(cityId: CityId): string {
    return this.cities().find((city) => city.id === cityId)?.name ?? CITY_LABELS[cityId];
  }

  discoverPlacesById(placeId: string): PlaceDto | null {
    return this.places().find((place) => place.id === placeId) ?? null;
  }

  addDiscoverSelection(cityId: CityId): void {
    const placeIds = this.discoverGroups().find((group) => group.cityId === cityId)?.placeIds ?? [];
    this.requestDraftAdd(placeIds);
  }

  private requestDraftAdd(placeIds: readonly string[]): void {
    if (this.planMapAddDisabled()) return;
    const uniqueIds = [...new Set(placeIds)];
    const requestedPlaces = uniqueIds
      .map((placeId) => this.places().find((place) => place.id === placeId))
      .filter((place): place is PlaceDto => place !== undefined);
    if (requestedPlaces.length !== uniqueIds.length) {
      if (this.savedPlanContextId() !== null) {
        this.savedPlanFeedback.set({ message: 'Some selected places are not available in the loaded catalog. Nothing was changed.', role: 'alert' });
      } else {
        this.draftFeedback.set('Some selected places are not available in the loaded catalog. Nothing was changed.');
      }
      return;
    }
    if (requestedPlaces.length === 0) {
      const message = 'There are no verified places to add.';
      if (this.savedPlanContextId() !== null) {
        this.savedPlanFeedback.set({ message, role: 'alert' });
      } else {
        this.draftFeedback.set(message);
      }
      return;
    }
    if (this.savedPlanContextId() !== null) {
      this.requestSavedPlanAdd(requestedPlaces);
      return;
    }
    const result = this.draftStore.addPlaces(
      requestedPlaces.map((place) => place.id),
      this.places(),
    );
    switch (result.status) {
      case 'limit-reached':
        this.draftFeedback.set('This plan has a 12-place limit. Remove a place before adding another. Nothing was changed.');
        break;
      case 'added':
        this.draftFeedback.set(
          `Added ${result.addedCount} place${result.addedCount === 1 ? '' : 's'} to the tab draft${result.alreadyPresentCount > 0 ? `; ${result.alreadyPresentCount} already there` : ''}.`,
        );
        this.autosave.save();
        break;
      case 'already-added':
        this.draftFeedback.set('Already in plan.');
        break;
      case 'validation-pending':
        this.draftFeedback.set('Checking the places in your existing tab draft.');
        break;
      case 'no-verified-places':
        this.draftFeedback.set('There are no verified places to add.');
        break;
    }
  }

  private requestSavedPlanAdd(requestedPlaces: readonly PlaceDto[]): void {
    const plan = this.savedPlanContext();
    if (plan === null || this.savedPlanAddPending()) {
      return;
    }
    this.savedPlanAddPending.set(true);
    this.savedPlanFeedback.set(null);
    this.plansApi.getPlan(plan.id)
      .pipe(
        switchMap((current) => {
          if (this.savedPlanContextId() !== plan.id) {
            return of(null);
          }
          const addedIds = requestedPlaces
            .map((place) => place.id)
            .filter((placeId) => !current.placeIds.includes(placeId));
          if (addedIds.length === 0) {
            this.savedPlanContext.set(current);
            this.savedPlanFeedback.set({ message: 'Those places are already in this plan.', role: 'status' });
            return of(null);
          }
          if (current.placeIds.length + addedIds.length > 12) {
            this.savedPlanContext.set(current);
            this.savedPlanFeedback.set({
              message: 'This plan has a 12-place limit. Remove a place before adding another. Nothing was changed.',
              role: 'alert',
            });
            return of(null);
          }
          const request: PlanUpsertRequest = {
            name: current.name,
            description: current.description,
            cityId: current.cityId,
            placeIds: [...current.placeIds, ...addedIds],
          };
          return this.plansApi.updatePlan(current.id, request).pipe(
            map((updated) => {
              if (!planMatchesRequest(updated, request)) {
                throw new UnexpectedPlanResponseError();
              }
              return { plan: updated, addedCount: addedIds.length } satisfies SavedPlanAddResult;
            }),
          );
        }),
        catchError((error: unknown) => {
          if (this.savedPlanContextId() === plan.id) {
            const message = apiErrorMessage(error, 'The place could not be added to this plan. Your existing plan is unchanged.');
            this.savedPlanFeedback.set({ message, role: 'alert' });
            if (error instanceof HttpErrorResponse && error.status === 404) {
              this.activePlanStore.clear(plan.id);
              this.savedPlanContext.set(null);
              this.savedPlanContextError.set('This saved plan is no longer available.');
            }
          }
          return of(null);
        }),
        finalize(() => this.savedPlanAddPending.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result === null || this.savedPlanContextId() !== result.plan.id) {
          return;
        }
        this.savedPlanContext.set(result.plan);
        this.savedPlanFeedback.set({
          message: `Added ${result.addedCount} place${result.addedCount === 1 ? '' : 's'} to ${result.plan.name}.`,
          role: 'status',
        });
      });
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }

  private clearSelectionIfFilteredOut(): void {
    const selectedId = this.selectedPlaceId();
    if (selectedId !== null && !this.filteredPlaces().some((place) => place.id === selectedId)) {
      this.selectedPlaceId.set(null);
      this.detailFocusReturn = null;
    }
  }

  private loadCities(): void {
    this.retryCities$
      .pipe(
        startWith(undefined),
        switchMap(() => {
          this.citiesLoading.set(true);
          this.citiesError.set(null);
          return this.citiesApi.getCities().pipe(
            map((cities) => ({ cities, error: null }) as const),
            catchError((error: unknown) =>
              of({
                cities: null,
                error: apiErrorMessage(error, 'Could not load cities'),
              } as const),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.citiesLoading.set(false);
        if (result.error) {
          this.cities.set([]);
          this.citiesError.set(result.error);
          return;
        }
        this.cities.set(result.cities ?? []);
      });
  }

  private loadPlacesForAllCities(): void {
    this.retryPlaces$
      .pipe(
        startWith(undefined),
        switchMap(() => {
          this.placeCityStates.update((states) => Object.fromEntries(CITY_IDS.map((cityId) => [cityId, {
            status: 'loading',
            data: states[cityId].data,
            error: null,
          }])) as Record<CityId, CityResourceState<PlaceDto>>);
          return merge(...CITY_IDS.map((cityId) =>
            this.placesApi.getPlaces(cityId).pipe(
              map((places) => ({
                cityId,
                data: places.filter((place) => place.cityId === cityId),
                error: null,
              }) satisfies PlaceLoadResult),
              catchError((error: unknown) =>
                of({
                  cityId,
                  data: null,
                  error: apiErrorMessage(error, `Could not load ${CITY_LABELS[cityId]}`),
                } satisfies PlaceLoadResult),
              ),
            ),
          ));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        const previous = this.placeCityStates()[result.cityId];
        const next: CityResourceState<PlaceDto> = result.error !== null
          ? { status: 'error', data: previous.data, error: result.error }
          : {
              status: result.data?.length ? 'success' : 'empty',
              data: result.data ?? [],
              error: null,
            };
        this.placeCityStates.update((states) => ({ ...states, [result.cityId]: next }));
        this.resolvePendingDiscoverForCity(result.cityId);
        this.validatePendingDraftWhenCatalogsReady();
      });
  }

  private validatePendingDraftWhenCatalogsReady(): void {
    const pendingCityId = this.draftStore.pendingCityId();
    if (pendingCityId === null) {
      return;
    }

    const states = this.placeCityStates();
    if (CITY_IDS.some((cityId) => states[cityId].status === 'loading')) {
      return;
    }

    const unavailableCities = CITY_IDS.filter((cityId) => states[cityId].status === 'error');
    if (unavailableCities.length > 0) {
      this.draftStore.failValidation(
        `Could not verify places from ${unavailableCities.map((cityId) => CITY_LABELS[cityId]).join(', ')}. Retry to restore this tab draft.`,
      );
      return;
    }

    this.draftStore.validatePendingDraft(pendingCityId, this.places());
  }

  private loadHubsForAllCities(): void {
    this.retryHubs$
      .pipe(
        startWith(undefined),
        switchMap(() => {
          this.hubCityStates.update((states) => Object.fromEntries(CITY_IDS.map((cityId) => [cityId, {
            status: 'loading',
            data: states[cityId].data,
            error: null,
          }])) as Record<CityId, CityResourceState<MobilityHubDto>>);
          return merge(...CITY_IDS.map((cityId) =>
            this.stopsApi.getStops(cityId).pipe(
              map((hubs) => ({
                cityId,
                data: hubs.filter((hub) => hub.cityId === cityId),
                error: null,
              }) satisfies HubLoadResult),
              catchError((error: unknown) =>
                of({
                  cityId,
                  data: null,
                  error: apiErrorMessage(error, `Could not load ${CITY_LABELS[cityId]} nearby hubs`),
                } satisfies HubLoadResult),
              ),
            ),
          ));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        const previous = this.hubCityStates()[result.cityId];
        const next: CityResourceState<MobilityHubDto> = result.error !== null
          ? { status: 'error', data: previous.data, error: result.error }
          : {
              status: result.data?.length ? 'success' : 'empty',
              data: result.data ?? [],
              error: null,
            };
        this.hubCityStates.update((states) => ({ ...states, [result.cityId]: next }));
      });
  }

  private watchDiscoverRequests(): void {
    this.discoverRequest$
      .pipe(
        switchMap((request): Observable<DiscoverCityOutcome | null> => {
          if (request === null) {
            return of(null);
          }
          return merge(...CITY_IDS.map((cityId) =>
            this.discoverApi.discover(cityId, request.theme).pipe(
              map((response) => ({ request, cityId, response, error: null }) satisfies DiscoverCityOutcome),
              catchError((error: unknown) =>
                of({
                  request,
                  cityId,
                  response: null,
                  error: apiErrorMessage(error, `Could not load ${CITY_LABELS[cityId]} picks`),
                } satisfies DiscoverCityOutcome),
              ),
            ),
          ));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((outcome) => {
        if (outcome === null) {
          this.pendingDiscoverOutcomes.clear();
          this.discoverState.set('idle');
          this.discoverGroups.set([]);
          this.discoverWarning.set(null);
          this.discoverError.set(null);
          this.discoverPlaceIds.set([]);
          return;
        }
        this.acceptDiscoverOutcome(outcome);
      });
  }

  private acceptDiscoverOutcome(outcome: DiscoverCityOutcome): void {
    const { request, cityId } = outcome;
    if (request.requestId !== this.discoverRequestId || request.theme !== this.activeDiscoverTheme()) {
      return;
    }

    const cityState = this.placeCityStates()[cityId];
    if (outcome.error === null && cityState.data === null && cityState.status === 'loading') {
      this.pendingDiscoverOutcomes.set(cityId, outcome);
      return;
    }

    this.setDiscoverCityGroup(this.createDiscoverCityGroup(outcome, cityState));
  }

  private resolvePendingDiscoverForCity(cityId: CityId): void {
    const outcome = this.pendingDiscoverOutcomes.get(cityId);
    if (outcome === undefined) {
      return;
    }
    if (
      outcome.request.requestId !== this.discoverRequestId
      || outcome.request.theme !== this.activeDiscoverTheme()
    ) {
      this.pendingDiscoverOutcomes.delete(cityId);
      return;
    }
    const cityState = this.placeCityStates()[cityId];
    if (cityState.status === 'loading' && cityState.data === null) {
      return;
    }
    this.pendingDiscoverOutcomes.delete(cityId);
    this.setDiscoverCityGroup(this.createDiscoverCityGroup(outcome, cityState));
  }

  private createDiscoverCityGroup(
    outcome: DiscoverCityOutcome,
    cityState: CityResourceState<PlaceDto>,
  ): DiscoverCityGroup {
    const { cityId, request, response } = outcome;
    if (outcome.error !== null || response === null) {
      return {
        cityId,
        status: 'error',
        description: null,
        placeIds: [],
        error: outcome.error ?? `Could not load ${CITY_LABELS[cityId]} picks.`,
      };
    }
    if (cityState.data === null) {
      return {
        cityId,
        status: 'error',
        description: null,
        placeIds: [],
        error: `Could not verify ${CITY_LABELS[cityId]} picks because its place catalog is unavailable.`,
      };
    }
    if (response.cityId !== cityId || response.theme !== request.theme) {
      return {
        cityId,
        status: 'error',
        description: null,
        placeIds: [],
        error: 'The discovery reply did not match this city and theme.',
      };
    }

    const cityPlaceIds = new Set(cityState.data.map((place) => place.id));
    const placeIds = [...new Set(Array.isArray(response.placeIds) ? response.placeIds : [])]
      .filter((placeId): placeId is string => typeof placeId === 'string')
      .filter((placeId) => cityPlaceIds.has(placeId))
      .slice(0, 5);
    const hasUnverifiedPicks = (response.placeIds?.length ?? 0) > 0 && placeIds.length === 0;
    return {
      cityId,
      status: hasUnverifiedPicks ? 'error' : placeIds.length > 0 ? 'success' : 'empty',
      description: hasUnverifiedPicks ? null : response.description,
      placeIds: hasUnverifiedPicks ? [] : placeIds,
      error: hasUnverifiedPicks ? `Could not verify the ${CITY_LABELS[cityId]} picks against its place catalog.` : null,
    };
  }

  private setDiscoverCityGroup(group: DiscoverCityGroup): void {
    const groups = this.discoverGroups().map((current) => current.cityId === group.cityId ? group : current);
    this.discoverGroups.set(groups);
    this.discoverPlaceIds.set(groups.flatMap((cityGroup) => cityGroup.placeIds));

    const failedGroups = groups.filter((cityGroup) => cityGroup.status === 'error');
    const resolvedGroups = groups.filter((cityGroup) => cityGroup.status === 'success' || cityGroup.status === 'empty');
    const stillLoading = groups.some((cityGroup) => cityGroup.status === 'loading');
    this.discoverWarning.set(failedGroups.length > 0
      ? `Could not load or verify picks for ${failedGroups.map((cityGroup) => CITY_LABELS[cityGroup.cityId]).join(', ')}.`
      : null);
    this.discoverError.set(!stillLoading && resolvedGroups.length === 0
      ? failedGroups.map((cityGroup) => cityGroup.error).filter((error): error is string => error !== null).join(' ')
      : null);
    this.discoverState.set(stillLoading ? 'loading' : resolvedGroups.length > 0 ? 'loaded' : 'error');
  }

  private checkHealth(): void {
    if (this.healthCheckPending) {
      return;
    }

    this.healthCheckPending = true;
    this.healthApi
      .getHealth()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => (this.healthCheckPending = false)),
      )
      .subscribe({
        next: () => {
          this.apiState.set('online');
          this.apiStatusText.set('Local API connected');
        },
        error: (error: unknown) => {
          const failure = describeHealthFailure(error);
          this.apiState.set(failure.state);
          this.apiStatusText.set(failure.message);
        },
      });
  }
}

function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function asHtmlElement(value: EventTarget | null | undefined): HTMLElement | null {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement ? value : null;
}

function planMatchesRequest(plan: PlanResponse, request: PlanUpsertRequest): boolean {
  return plan.name === request.name.trim()
    && plan.description === request.description
    && plan.cityId === request.cityId
    && plan.placeIds.length === request.placeIds.length
    && plan.placeIds.every((placeId, index) => placeId === request.placeIds[index]);
}

function describeHealthFailure(error: unknown): {
  state: 'offline' | 'unexpected';
  message: string;
} {
  if (
    error instanceof UnexpectedHealthResponseError ||
    (error instanceof HttpErrorResponse && error.status >= 200 && error.status < 300)
  ) {
    return {
      state: 'unexpected',
      message: 'API responded unexpectedly',
    };
  }

  if (error instanceof HttpErrorResponse) {
    return {
      state: 'offline',
      message: error.status === 0 ? 'Could not reach API' : `API returned HTTP ${error.status}`,
    };
  }

  return {
    state: 'unexpected',
    message: 'Health check failed unexpectedly',
  };
}
