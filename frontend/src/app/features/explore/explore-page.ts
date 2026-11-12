import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  catchError,
  finalize,
  forkJoin,
  map,
  type Observable,
  of,
  startWith,
  Subject,
  switchMap,
} from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { CitiesApiService } from '../../core/api/cities-api.service';
import { DiscoverApiService } from '../../core/api/discover-api.service';
import { HealthApiService, UnexpectedHealthResponseError } from '../../core/api/health-api.service';
import { PlacesApiService } from '../../core/api/places-api.service';
import { StopsApiService } from '../../core/api/stops-api.service';
import { DraftPlanStore } from '../../core/services/draft-plan.store';
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
import { MainNavigationComponent } from '../shared/main-navigation';
import { MapViewportComponent } from './map-viewport';
import { NearbyHub, nearbyHubsForPlace } from './nearby-hubs';
import { AddPlaceEvent, PlaceDetailComponent } from './place-detail';
import { getFeaturedPlaceImage } from './place-image-attribution';
import { PlaceResultsListComponent, type PlaceResultsView } from './place-results-list';

type ApiState = 'checking' | 'online' | 'offline' | 'unexpected';

type PlaceLoadState =
  | Readonly<{ cityId: CityId; places: readonly PlaceDto[]; error: null }>
  | Readonly<{ cityId: CityId; places: null; error: string }>;

type HubLoadState =
  | Readonly<{ cityId: CityId; hubs: readonly MobilityHubDto[]; error: null }>
  | Readonly<{ cityId: CityId; hubs: null; error: string }>;

type DiscoverRequest = Readonly<{ theme: DiscoverTheme }>;

type DiscoverCityGroup = Readonly<{
  cityId: CityId;
  description: string | null;
  placeIds: readonly string[];
  error: string | null;
}>;

type DiscoverCityOutcome = Readonly<{
  cityId: CityId;
  response: DiscoverDto | null;
  error: string | null;
}>;

type DiscoverResult =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'success'; request: DiscoverRequest; groups: readonly DiscoverCityGroup[] }>
  | Readonly<{ status: 'error'; request: DiscoverRequest; error: string }>;

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
  imports: [MapViewportComponent, PlaceDetailComponent, PlaceResultsListComponent, MainNavigationComponent, RouterLink],
  templateUrl: './explore-page.html',
  styleUrl: './explore-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorePage {
  private readonly healthApi = inject(HealthApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly citiesApi = inject(CitiesApiService);
  private readonly placesApi = inject(PlacesApiService);
  private readonly stopsApi = inject(StopsApiService);
  private readonly discoverApi = inject(DiscoverApiService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly retryCities$ = new Subject<void>();
  private readonly retryPlaces$ = new Subject<void>();
  private readonly retryHubs$ = new Subject<void>();
  private readonly discoverRequest$ = new Subject<DiscoverRequest | null>();
  private healthCheckPending = false;
  private validatingDraftCityId: CityId | null = null;
  private detailFocusReturn: HTMLElement | null = null;
  private draftFocusReturn: HTMLElement | null = null;

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
  readonly places = signal<readonly PlaceDto[]>([]);
  readonly placesLoading = signal(true);
  readonly placesError = signal<string | null>(null);
  readonly hubs = signal<readonly MobilityHubDto[]>([]);
  readonly hubsLoading = signal(true);
  readonly hubsError = signal<string | null>(null);
  readonly placesWarning = signal<string | null>(null);
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
  readonly draftStore = inject(DraftPlanStore);
  @ViewChild('placeResults') private placeResultsElement?: ElementRef<HTMLElement>;
  @ViewChild(PlaceDetailComponent) private placeDetail?: PlaceDetailComponent;
  @ViewChild('draftConflictHeading') private draftConflictHeadingElement?: ElementRef<HTMLElement>;
  @ViewChild(MapViewportComponent) private mapViewport?: MapViewportComponent;

  readonly draftEditorCityId = computed(
    () => this.draftStore.draft()?.cityId ?? this.draftStore.pendingCityId() ?? DEFAULT_CITY,
  );
  readonly draftCityName = computed(
    () => this.cities().find((city) => city.id === this.draftEditorCityId())?.name
      ?? CITY_LABELS[this.draftEditorCityId()],
  );
  readonly selectedPlace = computed(() => {
    const selectedId = this.selectedPlaceId();
    return selectedId === null
      ? null
      : this.places().find((place) => place.id === selectedId) ?? null;
  });
  readonly nearbyHubs = computed<readonly NearbyHub[]>(() => {
    const place = this.selectedPlace();
    return place === null ? [] : nearbyHubsForPlace(place, this.hubs());
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
    this.checkHealth();
    this.loadCities();
    this.watchDiscoverRequests();
    this.loadPlacesForAllCities();
    this.loadHubsForAllCities();
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
    const pendingCityId = this.draftStore.pendingCityId();
    if (pendingCityId === null) {
      return;
    }
    this.draftStore.beginValidation();
    const loadedPlaces = this.places().filter((place) => place.cityId === pendingCityId);
    if (loadedPlaces.length > 0) {
      this.draftStore.validatePendingDraft(pendingCityId, loadedPlaces);
      return;
    }
    this.validatingDraftCityId = null;
    this.validateStoredDraftForCity(pendingCityId);
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

  browsePlaces(): void {
    const results = this.placeResultsElement?.nativeElement;
    results?.focus();
    const prefersReducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    results?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
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
    const draft = this.draftStore.draft();
    const place = this.places().find((candidate) => candidate.id === placeId);
    return place !== undefined
      && draft?.cityId === place.cityId
      && draft.placeIds.includes(placeId);
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
    this.discoverState.set('loading');
    this.discoverGroups.set([]);
    this.discoverWarning.set(null);
    this.discoverError.set(null);
    this.discoverPlaceIds.set([]);
    this.discoverRequest$.next({ theme });
  }

  addPlaceToPlan(placeId: string, trigger?: EventTarget | null): void {
    this.requestDraftAdd([placeId], trigger);
  }

  addDetailPlaceToPlan(event: AddPlaceEvent): void {
    this.addPlaceToPlan(event.placeId, event.trigger);
  }

  cityName(cityId: CityId): string {
    return this.cities().find((city) => city.id === cityId)?.name ?? CITY_LABELS[cityId];
  }

  discoverPlacesById(placeId: string): PlaceDto | null {
    return this.places().find((place) => place.id === placeId) ?? null;
  }

  addDiscoverSelection(cityId: CityId, trigger?: EventTarget | null): void {
    const placeIds = this.discoverGroups().find((group) => group.cityId === cityId)?.placeIds ?? [];
    this.requestDraftAdd(placeIds, trigger);
  }

  keepExistingDraft(): void {
    this.draftStore.keepExistingDraft();
    this.restoreDraftFocus();
  }

  startDraftForCurrentCity(): void {
    const conflict = this.draftStore.cityConflict();
    if (conflict === null) {
      this.draftStore.keepExistingDraft();
      this.draftFeedback.set('The selected city changed. Add the place again to start a draft there.');
      this.restoreDraftFocus();
      return;
    }
    this.draftStore.startDraftForRequestedCity();
    this.draftFeedback.set(`Started a new ${conflict.cityName} tab draft.`);
    this.restoreDraftFocus();
  }

  private requestDraftAdd(placeIds: readonly string[], trigger?: EventTarget | null): void {
    const requestedPlaces = [...new Set(placeIds)]
      .map((placeId) => this.places().find((place) => place.id === placeId))
      .filter((place): place is PlaceDto => place !== undefined);
    const requestedCities = new Set(requestedPlaces.map((place) => place.cityId));
    if (requestedCities.size > 1) {
      this.draftFeedback.set('A saved plan can include places from one city. Add each city’s picks to a separate plan.');
      return;
    }
    const requestedCityId = requestedPlaces[0]?.cityId;
    if (requestedCityId === undefined) {
      this.draftFeedback.set('There are no verified places to add.');
      return;
    }
    const cityName = this.cityName(requestedCityId);
    const result = this.draftStore.addPlaces(
      requestedCityId,
      cityName,
      requestedPlaces.map((place) => place.id),
      this.places().filter((place) => place.cityId === requestedCityId),
    );
    if (result.status === 'city-conflict') {
      this.draftFocusReturn = asHtmlElement(trigger);
      this.draftFeedback.set('');
      this.focusAfterRender(() => this.draftConflictHeadingElement?.nativeElement.focus());
      return;
    }
    switch (result.status) {
      case 'added':
        this.draftFeedback.set(
          `Added ${result.addedCount} place${result.addedCount === 1 ? '' : 's'} to the tab draft${result.alreadyPresentCount > 0 ? `; ${result.alreadyPresentCount} already there` : ''}.`,
        );
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

  private restoreDraftFocus(): void {
    this.focusAfterRender(() => {
      if (this.draftFocusReturn?.isConnected) {
        this.draftFocusReturn.focus();
      }
      this.draftFocusReturn = null;
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
          this.placesLoading.set(true);
          this.placesError.set(null);
          this.placesWarning.set(null);
          return forkJoin(
            CITY_IDS.map((cityId) =>
              this.placesApi.getPlaces(cityId).pipe(
                map((places) => ({ cityId, places, error: null }) satisfies PlaceLoadState),
                catchError((error: unknown) =>
                  of({
                    cityId,
                    places: null,
                    error: apiErrorMessage(error, `Could not load ${CITY_LABELS[cityId]}`),
                  } satisfies PlaceLoadState),
                ),
              ),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        const successful = results.filter((result) => result.error === null);
        const failed = results.filter((result) => result.error !== null);
        const loadedPlaces = successful.flatMap((result) => result.places ?? []);
        this.places.set(loadedPlaces);
        this.placesLoading.set(false);
        this.placesError.set(
          successful.length === 0 && failed.length > 0
            ? failed.map((result) => result.error).join(' ')
            : null,
        );
        this.placesWarning.set(
          failed.length > 0 && successful.length > 0
            ? `Some places are unavailable: ${failed.map((result) => CITY_LABELS[result.cityId]).join(', ')} could not load.`
            : null,
        );

        const pendingCityId = this.draftStore.pendingCityId();
        if (pendingCityId !== null) {
          const cityResult = results.find((result) => result.cityId === pendingCityId);
          if (cityResult?.error !== null && cityResult?.error !== undefined) {
            this.draftStore.failValidation(cityResult.error);
          } else if (cityResult?.places !== null && cityResult?.places !== undefined) {
            this.draftStore.validatePendingDraft(pendingCityId, cityResult.places);
          }
        }
      });
  }

  private loadHubsForAllCities(): void {
    this.retryHubs$
      .pipe(
        startWith(undefined),
        switchMap(() => {
          this.hubs.set([]);
          this.hubsLoading.set(true);
          this.hubsError.set(null);
          return forkJoin(
            CITY_IDS.map((cityId) =>
              this.stopsApi.getStops(cityId).pipe(
                map((hubs) => ({ cityId, hubs, error: null }) satisfies HubLoadState),
                catchError((error: unknown) =>
                  of({
                    cityId,
                    hubs: null,
                    error: apiErrorMessage(error, `Could not load ${CITY_LABELS[cityId]} nearby hubs`),
                  } satisfies HubLoadState),
                ),
              ),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        const successful = results.filter((result) => result.error === null);
        const failed = results.filter((result) => result.error !== null);
        this.hubs.set(successful.flatMap((result) => result.hubs ?? []));
        this.hubsLoading.set(false);
        this.hubsError.set(
          successful.length === 0 && failed.length > 0
            ? failed.map((result) => result.error).join(' ')
            : null,
        );
      });
  }

  private watchDiscoverRequests(): void {
    this.discoverRequest$
      .pipe(
        switchMap((request): Observable<DiscoverResult> => {
          if (request === null) {
            return of({ status: 'idle' });
          }
          return forkJoin(
            CITY_IDS.map((cityId) =>
              this.discoverApi.discover(cityId, request.theme).pipe(
                map((response) => ({ cityId, response, error: null } as DiscoverCityOutcome)),
                catchError((error: unknown) =>
                  of({
                    cityId,
                    response: null,
                    error: apiErrorMessage(error, `Could not load ${CITY_LABELS[cityId]} picks`),
                  } as DiscoverCityOutcome),
                ),
              ),
            ),
          ).pipe(
            map((outcomes) => {
              const groups = outcomes.map((outcome): DiscoverCityGroup => {
                if (outcome.error !== null || outcome.response === null) {
                  return {
                    cityId: outcome.cityId,
                    description: null,
                    placeIds: [],
                    error: outcome.error ?? `Could not load ${CITY_LABELS[outcome.cityId]} picks.`,
                  };
                }
                if (outcome.response.cityId !== outcome.cityId || outcome.response.theme !== request.theme) {
                  return {
                    cityId: outcome.cityId,
                    description: null,
                    placeIds: [],
                    error: 'The discovery reply did not match this city and theme.',
                  };
                }

                const cityPlaceIds = new Set(
                  this.places()
                    .filter((place) => place.cityId === outcome.cityId)
                    .map((place) => place.id),
                );
                const placeIds = [...new Set(Array.isArray(outcome.response.placeIds) ? outcome.response.placeIds : [])]
                  .filter((placeId): placeId is string => typeof placeId === 'string')
                  .filter((placeId) => cityPlaceIds.has(placeId))
                  .slice(0, 5);
                return {
                  cityId: outcome.cityId,
                  description: outcome.response.description,
                  placeIds,
                  error: null,
                };
              });
              return { status: 'success', request, groups } satisfies DiscoverResult;
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result.status === 'idle') {
          this.discoverState.set('idle');
          this.discoverGroups.set([]);
          this.discoverWarning.set(null);
          this.discoverError.set(null);
          this.discoverPlaceIds.set([]);
          return;
        }
        if (result.request.theme !== this.activeDiscoverTheme()) {
          return;
        }
        if (result.status === 'error') {
          this.discoverState.set('error');
          this.discoverError.set(result.error);
          return;
        }
        const groups = result.groups;
        const failedGroups = groups.filter((group) => group.error !== null);
        const availableGroups = groups.filter((group) => group.error === null);
        if (availableGroups.length === 0 && failedGroups.length > 0) {
          this.discoverState.set('error');
          this.discoverError.set(failedGroups.map((group) => group.error).join(' '));
          return;
        }
        this.discoverGroups.set(groups);
        this.discoverWarning.set(
          failedGroups.length > 0
            ? `Could not load picks for ${failedGroups.map((group) => CITY_LABELS[group.cityId]).join(', ')}.`
            : null,
        );
        this.discoverPlaceIds.set(groups.flatMap((group) => group.placeIds));
        this.discoverError.set(null);
        this.discoverState.set('loaded');
      });
  }

  private validateStoredDraftForCity(cityId: CityId): void {
    const pendingCityId = this.draftStore.pendingCityId();
    if (
      pendingCityId === null
      || pendingCityId !== cityId
      || this.validatingDraftCityId === pendingCityId
    ) {
      return;
    }

    this.validatingDraftCityId = pendingCityId;
    this.draftStore.beginValidation();
    this.placesApi
      .getPlaces(cityId)
      .pipe(
        map((places) => ({ places, error: null }) as const),
        catchError((error: unknown) =>
          of({ places: null, error: apiErrorMessage(error, 'Could not validate the tab draft') } as const),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (this.validatingDraftCityId !== pendingCityId) {
          return;
        }
        this.validatingDraftCityId = null;
        if (result.error !== null) {
          this.draftStore.failValidation(result.error);
          return;
        }
        this.draftStore.validatePendingDraft(pendingCityId, result.places);
      });
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
