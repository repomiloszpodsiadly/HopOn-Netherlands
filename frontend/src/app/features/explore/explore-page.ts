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
  distinctUntilChanged,
  finalize,
  map,
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

type ApiState = 'checking' | 'online' | 'offline' | 'unexpected';

type PlaceLoadState =
  | Readonly<{ cityId: CityId; places: readonly PlaceDto[]; error: null }>
  | Readonly<{ cityId: CityId; places: null; error: string }>;

type HubLoadState =
  | Readonly<{ cityId: CityId; hubs: readonly MobilityHubDto[]; error: null }>
  | Readonly<{ cityId: CityId; hubs: null; error: string }>;

type DiscoverRequest = Readonly<{ cityId: CityId; theme: DiscoverTheme }>;

type DiscoverResult =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'success'; request: DiscoverRequest; response: DiscoverDto }>
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
  imports: [MapViewportComponent, PlaceDetailComponent, MainNavigationComponent, RouterLink],
  templateUrl: './explore-page.html',
  styleUrl: './explore-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorePage {
  private readonly healthApi = inject(HealthApiService);
  private readonly citiesApi = inject(CitiesApiService);
  private readonly placesApi = inject(PlacesApiService);
  private readonly stopsApi = inject(StopsApiService);
  private readonly discoverApi = inject(DiscoverApiService);
  private readonly injector = inject(Injector);
  private readonly draftValidationRequest$ = new Subject<CityId>();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
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
  readonly compactApiStatusText = signal('Checking API');
  readonly cities = signal<readonly CityDto[]>([]);
  readonly citiesLoading = signal(true);
  readonly citiesError = signal<string | null>(null);
  readonly selectedCityId = signal<CityId>(DEFAULT_CITY);
  readonly places = signal<readonly PlaceDto[]>([]);
  readonly placesLoading = signal(true);
  readonly placesError = signal<string | null>(null);
  readonly hubs = signal<readonly MobilityHubDto[]>([]);
  readonly hubsLoading = signal(true);
  readonly hubsError = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly activeCategory = signal<PlaceCategory | null>(null);
  readonly selectedPlaceId = signal<string | null>(null);
  readonly visiblePlaceLimit = signal(INITIAL_PLACE_LIMIT);
  readonly activeDiscoverTheme = signal<DiscoverTheme | null>(null);
  readonly discoverState = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  readonly discoverResponse = signal<DiscoverDto | null>(null);
  readonly discoverError = signal<string | null>(null);
  readonly discoverPlaceIds = signal<readonly string[]>([]);
  readonly draftFeedback = signal('');
  readonly draftStore = inject(DraftPlanStore);
  @ViewChild('placeResults') private placeResultsElement?: ElementRef<HTMLElement>;
  @ViewChild(PlaceDetailComponent) private placeDetail?: PlaceDetailComponent;
  @ViewChild('draftConflictHeading') private draftConflictHeadingElement?: ElementRef<HTMLElement>;
  @ViewChild(MapViewportComponent) private mapViewport?: MapViewportComponent;

  readonly currentCity = computed(
    () => this.cities().find((city) => city.id === this.selectedCityId()) ?? null,
  );
  readonly currentCityName = computed(
    () => this.currentCity()?.name ?? CITY_LABELS[this.selectedCityId()],
  );
  readonly draftEditorCityId = computed(
    () => this.draftStore.draft()?.cityId ?? this.draftStore.pendingCityId() ?? this.selectedCityId(),
  );
  readonly selectedPlace = computed(() => {
    const selectedId = this.selectedPlaceId();
    return selectedId === null
      ? null
      : this.places().find(
          (place) => place.id === selectedId && place.cityId === this.selectedCityId(),
        ) ?? null;
  });
  readonly nearbyHubs = computed<readonly NearbyHub[]>(() => {
    const place = this.selectedPlace();
    return place === null ? [] : nearbyHubsForPlace(place, this.hubs());
  });
  readonly discoverPlaces = computed(() => {
    const placesById = new Map(this.places().map((place) => [place.id, place]));
    return this.discoverPlaceIds()
      .map((placeId) => placesById.get(placeId))
      .filter((place): place is PlaceDto => place !== undefined);
  });
  readonly discoverVisibleCount = computed(() => {
    const visibleIds = new Set(this.filteredPlaces().map((place) => place.id));
    return this.discoverPlaceIds().filter((placeId) => visibleIds.has(placeId)).length;
  });
  readonly filteredPlaces = computed(() => {
    const query = normalizeSearch(this.searchQuery().trim());
    const category = this.activeCategory();
    return this.places().filter(
      (place) =>
        place.cityId === this.selectedCityId() &&
        (category === null || place.category === category) &&
        (query.length === 0 || normalizeSearch(place.name).includes(query)),
    );
  });
  readonly visiblePlaces = computed(() => {
    const filtered = this.filteredPlaces();
    const visible = filtered.slice(0, this.visiblePlaceLimit());
    const selectedId = this.selectedPlaceId();
    if (selectedId === null || visible.some((place) => place.id === selectedId)) {
      return visible;
    }
    const selectedPlace = filtered.find((place) => place.id === selectedId);
    return selectedPlace ? [selectedPlace, ...visible] : visible;
  });
  readonly resultCount = computed(() => this.filteredPlaces().length);
  readonly hasMorePlaces = computed(() => this.visiblePlaceLimit() < this.resultCount());
  readonly hasActiveFilters = computed(
    () => this.searchQuery().trim().length > 0 || this.activeCategory() !== null,
  );

  constructor() {
    this.checkHealth();
    this.loadCities();
    this.watchDiscoverRequests();
    this.loadPlacesForRouteCity();
    this.loadHubsForRouteCity();
  }

  retryHealthCheck(): void {
    if (this.healthCheckPending) {
      return;
    }
    this.apiState.set('checking');
    this.apiStatusText.set('Checking local API');
    this.compactApiStatusText.set('Checking API');
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
    if (pendingCityId === this.selectedCityId()) {
      this.retryPlaces();
      return;
    }
    this.validatingDraftCityId = null;
    this.validateStoredDraftForCity(this.selectedCityId());
  }

  onCitySelected(event: Event): void {
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
    results?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    return draft?.cityId === this.selectedCityId() && draft.placeIds.includes(placeId);
  }

  chooseDiscoverTheme(theme: DiscoverTheme): void {
    this.searchQuery.set('');
    this.activeCategory.set(null);
    this.visiblePlaceLimit.set(INITIAL_PLACE_LIMIT);
    this.activeDiscoverTheme.set(theme);
    this.discoverState.set('loading');
    this.discoverResponse.set(null);
    this.discoverError.set(null);
    this.discoverPlaceIds.set([]);
    this.discoverRequest$.next({ cityId: this.selectedCityId(), theme });
  }

  retryDiscover(): void {
    const theme = this.activeDiscoverTheme();
    if (theme !== null) {
      this.chooseDiscoverTheme(theme);
    }
  }

  addPlaceToPlan(placeId: string, trigger?: EventTarget | null): void {
    this.requestDraftAdd([placeId], trigger);
  }

  addDetailPlaceToPlan(event: AddPlaceEvent): void {
    this.addPlaceToPlan(event.placeId, event.trigger);
  }

  addDiscoverSelection(trigger?: EventTarget | null): void {
    this.requestDraftAdd(this.discoverPlaceIds(), trigger);
  }

  keepExistingDraft(): void {
    this.draftStore.keepExistingDraft();
    this.restoreDraftFocus();
  }

  startDraftForCurrentCity(): void {
    const conflict = this.draftStore.cityConflict();
    if (conflict === null || conflict.cityId !== this.selectedCityId()) {
      this.draftStore.keepExistingDraft();
      this.draftFeedback.set('The city changed. Add the place again to start a draft here.');
      this.restoreDraftFocus();
      return;
    }
    this.draftStore.startDraftForRequestedCity();
    this.draftFeedback.set(`Started a new ${this.currentCityName()} tab draft.`);
    this.restoreDraftFocus();
  }

  displayTag(tag: string): string {
    return tag.replaceAll('_', ' ');
  }

  private requestDraftAdd(placeIds: readonly string[], trigger?: EventTarget | null): void {
    const result = this.draftStore.addPlaces(
      this.selectedCityId(),
      this.currentCityName(),
      placeIds,
      this.places(),
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
        this.draftFeedback.set('There are no verified current-city places to add.');
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

  private loadPlacesForRouteCity(): void {
    this.route.queryParamMap
      .pipe(
        map((params) => params.get('city')),
        map(resolveCityId),
        distinctUntilChanged(),
        tap((cityId) => {
          const urlCityId = this.route.snapshot.queryParamMap.get('city');
          if (!isCityId(urlCityId)) {
            void this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { city: cityId },
              queryParamsHandling: 'merge',
              replaceUrl: true,
            });
          }
          this.selectedCityId.set(cityId);
          this.selectedPlaceId.set(null);
          this.detailFocusReturn = null;
          this.draftStore.keepExistingDraft();
          this.draftFocusReturn = null;
          this.places.set([]);
          this.hubs.set([]);
          this.hubsError.set(null);
          this.activeDiscoverTheme.set(null);
          this.discoverRequest$.next(null);
          this.discoverState.set('idle');
          this.discoverResponse.set(null);
          this.discoverError.set(null);
          this.discoverPlaceIds.set([]);
          this.draftFeedback.set('');
          this.visiblePlaceLimit.set(INITIAL_PLACE_LIMIT);
          this.validateStoredDraftForCity(cityId);
        }),
        switchMap((cityId) =>
          this.retryPlaces$.pipe(
            startWith(undefined),
            switchMap(() => {
              this.placesLoading.set(true);
              this.placesError.set(null);
              return this.placesApi.getPlaces(cityId).pipe(
                map((places) => ({ cityId, places, error: null }) satisfies PlaceLoadState),
                catchError((error: unknown) =>
                  of({
                    cityId,
                    places: null,
                    error: apiErrorMessage(error, 'Could not load places'),
                  } satisfies PlaceLoadState),
                ),
              );
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result.cityId !== this.selectedCityId()) {
          return;
        }
        this.placesLoading.set(false);
        if (result.error !== null) {
          this.places.set([]);
          this.placesError.set(result.error);
          if (this.draftStore.pendingCityId() === result.cityId) {
            this.draftStore.failValidation(result.error);
          }
          return;
        }
        this.places.set(result.places);
        this.draftStore.validatePendingDraft(result.cityId, result.places);
      });
  }

  private loadHubsForRouteCity(): void {
    this.route.queryParamMap
      .pipe(
        map((params) => params.get('city')),
        map(resolveCityId),
        distinctUntilChanged(),
        tap(() => {
          this.hubs.set([]);
          this.hubsLoading.set(true);
          this.hubsError.set(null);
        }),
        switchMap((cityId) =>
          this.retryHubs$.pipe(
            startWith(undefined),
            switchMap(() =>
              this.stopsApi.getStops(cityId).pipe(
                map((hubs) => ({ cityId, hubs, error: null }) satisfies HubLoadState),
                catchError((error: unknown) =>
                  of({
                    cityId,
                    hubs: null,
                    error: apiErrorMessage(error, 'Could not load nearby hubs'),
                  } satisfies HubLoadState),
                ),
              ),
            ),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result.cityId !== this.selectedCityId()) {
          return;
        }
        this.hubsLoading.set(false);
        if (result.error !== null) {
          this.hubs.set([]);
          this.hubsError.set(result.error);
          return;
        }
        this.hubs.set(result.hubs);
      });
  }

  private watchDiscoverRequests(): void {
    this.discoverRequest$
      .pipe(
        switchMap((request): Observable<DiscoverResult> => {
          if (request === null) {
            return of({ status: 'idle' });
          }
          return this.discoverApi.discover(request.cityId, request.theme).pipe(
            map((response) => ({ status: 'success', request, response }) satisfies DiscoverResult),
            catchError((error: unknown) =>
              of({
                status: 'error',
                request,
                error: apiErrorMessage(error, 'Could not load discovery picks'),
              } satisfies DiscoverResult),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result.status === 'idle') {
          this.discoverState.set('idle');
          this.discoverResponse.set(null);
          this.discoverError.set(null);
          this.discoverPlaceIds.set([]);
          return;
        }
        if (
          result.request.cityId !== this.selectedCityId()
          || result.request.theme !== this.activeDiscoverTheme()
        ) {
          return;
        }
        if (result.status === 'error') {
          this.discoverState.set('error');
          this.discoverError.set(result.error);
          return;
        }

        const { response, request } = result;
        if (response.cityId !== request.cityId || response.theme !== request.theme) {
          this.discoverState.set('error');
          this.discoverError.set('The discovery reply did not match this city and theme.');
          return;
        }
        const currentCityPlaceIds = new Set(
          this.places().filter((place) => place.cityId === request.cityId).map((place) => place.id),
        );
        const responsePlaceIds = Array.isArray(response.placeIds) ? response.placeIds : [];
        const placeIds = [...new Set(responsePlaceIds)]
          .filter((placeId): placeId is string => typeof placeId === 'string')
          .filter((placeId) => currentCityPlaceIds.has(placeId))
          .slice(0, 5);
        const verifiedResponse = { ...response, placeIds };
        this.discoverResponse.set(verifiedResponse);
        this.discoverPlaceIds.set(placeIds);
        this.discoverError.set(null);
        this.discoverState.set('loaded');
      });
  }

  private validateStoredDraftForCity(routeCityId: CityId): void {
    const pendingCityId = this.draftStore.pendingCityId();
    if (
      pendingCityId === null
      || pendingCityId === routeCityId
      || this.validatingDraftCityId === pendingCityId
    ) {
      return;
    }

    this.validatingDraftCityId = pendingCityId;
    this.draftStore.beginValidation();
    this.placesApi
      .getPlaces(pendingCityId)
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
          this.compactApiStatusText.set('API online');
        },
        error: (error: unknown) => {
          const failure = describeHealthFailure(error);
          this.apiState.set(failure.state);
          this.apiStatusText.set(failure.message);
          this.compactApiStatusText.set(failure.compactMessage);
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
  compactMessage: string;
} {
  if (
    error instanceof UnexpectedHealthResponseError ||
    (error instanceof HttpErrorResponse && error.status >= 200 && error.status < 300)
  ) {
    return {
      state: 'unexpected',
      message: 'API responded unexpectedly',
      compactMessage: 'Invalid API reply',
    };
  }

  if (error instanceof HttpErrorResponse) {
    return {
      state: 'offline',
      message: error.status === 0 ? 'Could not reach API' : `API returned HTTP ${error.status}`,
      compactMessage: 'API offline',
    };
  }

  return {
    state: 'unexpected',
    message: 'Health check failed unexpectedly',
    compactMessage: 'Check failed',
  };
}
