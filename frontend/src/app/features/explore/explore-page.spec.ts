import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { CityDto, MobilityHubDto, PlaceDto } from '../../core/models/catalog.models';
import { DRAFT_PLAN_STORAGE_KEY } from '../../core/services/draft-plan.store';
import { MapViewportComponent } from './map-viewport';
import { ExplorePage } from './explore-page';

@Component({
  selector: 'app-map-viewport',
  standalone: true,
  template: '<div></div>',
})
class MapViewportStub {
  @Input({ required: true }) cities!: readonly CityDto[];
  @Input() places: readonly PlaceDto[] = [];
  @Input() selectedPlaceId: string | null = null;
  @Input() discoverPlaceIds: readonly string[] = [];
  @Output() readonly placeSelected = new EventEmitter<string>();
  @Output() readonly browsePlaces = new EventEmitter<void>();
}

const CITIES: readonly CityDto[] = [
  { id: 'amsterdam', name: 'Amsterdam', center: { latitude: 52.37, longitude: 4.9 }, defaultZoom: 12.2 },
  { id: 'rotterdam', name: 'Rotterdam', center: { latitude: 51.92, longitude: 4.48 }, defaultZoom: 12.2 },
  { id: 'utrecht', name: 'Utrecht', center: { latitude: 52.09, longitude: 5.12 }, defaultZoom: 12.4 },
];

const AMSTERDAM_PLACES: readonly PlaceDto[] = [
  {
    id: 'amsterdam-museum', cityId: 'amsterdam', name: 'Amsterdam Museum', category: 'MUSEUMS',
    latitude: 52.37, longitude: 4.89, tags: ['museum'], shortDescription: 'A city museum.',
    imagePath: null, imageAttributionId: null,
  },
  {
    id: 'museumplein', cityId: 'amsterdam', name: 'Museumplein', category: 'LANDMARKS',
    latitude: 52.36, longitude: 4.88, tags: ['public_square'], shortDescription: 'A public square.',
    imagePath: null, imageAttributionId: null,
  },
  {
    id: 'van-gogh', cityId: 'amsterdam', name: 'Van Gogh Museum', category: 'MUSEUMS',
    latitude: 52.36, longitude: 4.88, tags: ['art_museum'], shortDescription: 'A museum of art.',
    imagePath: null, imageAttributionId: null,
  },
];

const FEATURED_PLACES: readonly PlaceDto[] = [
  {
    id: 'amsterdam-relation-3580875', cityId: 'amsterdam', name: 'Royal Palace', category: 'ARCHITECTURE',
    latitude: 52.3731, longitude: 4.8913, tags: ['architecture'], shortDescription: 'Royal Palace in Amsterdam.',
    imagePath: '/assets/catalog/royal-palace-amsterdam.jpg', imageAttributionId: 'royal-palace-amsterdam',
  },
  {
    id: 'rotterdam-relation-20774225', cityId: 'rotterdam', name: 'Erasmus Bridge', category: 'ARCHITECTURE',
    latitude: 51.909, longitude: 4.487, tags: ['architecture'], shortDescription: 'Erasmus Bridge in Rotterdam.',
    imagePath: '/assets/catalog/erasmus-bridge-rotterdam.jpg', imageAttributionId: 'erasmus-bridge-rotterdam',
  },
  {
    id: 'utrecht-way-262779230', cityId: 'utrecht', name: 'Dom Tower', category: 'LANDMARKS',
    latitude: 52.0907, longitude: 5.1214, tags: ['landmark'], shortDescription: 'Dom Tower in Utrecht.',
    imagePath: '/assets/catalog/dom-tower-utrecht.jpg', imageAttributionId: 'dom-tower-utrecht',
  },
];

const HUBS: readonly MobilityHubDto[] = [
  {
    id: 'amsterdam-hub-a', cityId: 'amsterdam', name: 'Amsterdam Central',
    latitude: 52.37, longitude: 4.89, modes: ['TRAIN', 'FERRY'], source: 'OpenStreetMap',
  },
  {
    id: 'amsterdam-hub-b', cityId: 'amsterdam', name: 'Museum Quarter',
    latitude: 52.3605, longitude: 4.88, modes: ['TRAM'], source: 'OpenStreetMap',
  },
  {
    id: 'rotterdam-hub', cityId: 'rotterdam', name: 'Rotterdam Central',
    latitude: 51.9244, longitude: 4.4695, modes: ['TRAIN', 'METRO'], source: 'OpenStreetMap',
  },
  {
    id: 'utrecht-hub', cityId: 'utrecht', name: 'Utrecht Central',
    latitude: 52.0894, longitude: 5.1101, modes: ['TRAIN'], source: 'OpenStreetMap',
  },
];

const ROTTERDAM_PLACES: readonly PlaceDto[] = [
  FEATURED_PLACES[1],
  {
    ...AMSTERDAM_PLACES[0], id: 'rotterdam-museum', cityId: 'rotterdam', name: 'Rotterdam Museum',
  },
];

const UTRECHT_PLACES: readonly PlaceDto[] = [
  FEATURED_PLACES[2],
  {
    ...AMSTERDAM_PLACES[0], id: 'utrecht-museum', cityId: 'utrecht', name: 'Utrecht Museum',
  },
];

type CityId = CityDto['id'];
type PlacesByCity = Partial<Record<CityId, readonly PlaceDto[]>>;

const DEFAULT_TEST_PLACES: PlacesByCity = {
  amsterdam: [...AMSTERDAM_PLACES, FEATURED_PLACES[0]],
  rotterdam: ROTTERDAM_PLACES,
  utrecht: UTRECHT_PLACES,
};

function placesRequest(http: HttpTestingController, cityId: string): TestRequest {
  return http.expectOne(
    (request) => request.url === '/api/places' && request.params.get('cityId') === cityId,
  );
}

function stopsRequest(http: HttpTestingController, cityId: string): TestRequest {
  return http.expectOne(
    (request) => request.url === '/api/stops' && request.params.get('cityId') === cityId,
  );
}

function flushPlaces(http: HttpTestingController, placesByCity: PlacesByCity = {}): void {
  for (const city of CITIES) {
    placesRequest(http, city.id).flush(placesByCity[city.id] ?? []);
  }
}

function discoverRequest(http: HttpTestingController, cityId: CityId, theme: string): TestRequest {
  return http.expectOne(
    (request) => request.url === '/api/discover'
      && request.params.get('cityId') === cityId
      && request.params.get('theme') === theme,
  );
}

function flushDiscover(
  http: HttpTestingController,
  theme: string,
  placeIdsByCity: PlacesByCity,
): void {
  for (const city of CITIES) {
    discoverRequest(http, city.id, theme).flush({
      cityId: city.id,
      theme,
      description: `${theme} highlights in ${city.name}.`,
      placeIds: (placeIdsByCity[city.id] ?? []).map((place) => place.id),
    });
  }
}

describe('ExplorePage', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '', component: ExplorePage }]),
      ],
    });
    TestBed.overrideComponent(ExplorePage, {
      remove: { imports: [MapViewportComponent] },
      add: { imports: [MapViewportStub] },
    });
    await TestBed.compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    sessionStorage.removeItem(DRAFT_PLAN_STORAGE_KEY);
  });

  async function startPage(
    url = '/',
    options: {
      hubs?: readonly MobilityHubDto[];
      places?: PlacesByCity;
      deferHubs?: boolean;
      deferPlaces?: boolean;
    } = {},
  ) {
    const harness = await RouterTestingHarness.create(url);
    const http = TestBed.inject(HttpTestingController);
    const healthRequest = http.expectOne('/api/health');
    healthRequest.flush({ status: 'UP', service: 'hopon-api' });
    http.expectOne('/api/cities').flush(CITIES);
    if (!options.deferHubs) {
      for (const city of CITIES) {
        stopsRequest(http, city.id).flush(
          (options.hubs ?? HUBS).filter((hub) => hub.cityId === city.id),
        );
      }
    }
    if (!options.deferPlaces) {
      flushPlaces(http, options.places ?? DEFAULT_TEST_PLACES);
    }
    await harness.fixture.whenStable();
    harness.detectChanges();
    return {
      harness,
      http,
      component: harness.routeDebugElement!.componentInstance as ExplorePage,
    };
  }

  it('loads all three city catalogs together without a city selector', async () => {
    const { harness, component } = await startPage('/');
    harness.detectChanges();

    expect(component.places()).toHaveLength(
      AMSTERDAM_PLACES.length + 1 + ROTTERDAM_PLACES.length + UTRECHT_PLACES.length,
    );
    expect(component.filteredPlaces()).toEqual(component.places());
    expect(TestBed.inject(Router).url).toBe('/');
    expect(harness.routeNativeElement?.querySelector('#city-select')).toBeNull();
    expect(harness.routeNativeElement?.querySelectorAll('.place-card')).toHaveLength(component.places().length);
    expect(harness.routeNativeElement?.textContent).toContain('Amsterdam');
    expect(harness.routeNativeElement?.textContent).toContain('Rotterdam');
    expect(harness.routeNativeElement?.textContent).toContain('Utrecht');
    expect(harness.routeNativeElement?.querySelector('nav[aria-label="Main navigation"]')).toBeTruthy();
  });

  it.each([
    {
      cityId: 'amsterdam', id: 'amsterdam-relation-3580875', name: 'Royal Palace',
      imagePath: '/assets/catalog/royal-palace-amsterdam.jpg',
      smallPath: '/assets/catalog/royal-palace-amsterdam-640.jpg', author: 'Elekes Andor', license: 'CC BY-SA 4.0',
    },
    {
      cityId: 'rotterdam', id: 'rotterdam-relation-20774225', name: 'Erasmus Bridge',
      imagePath: '/assets/catalog/erasmus-bridge-rotterdam.jpg',
      smallPath: '/assets/catalog/erasmus-bridge-rotterdam-640.jpg', author: 'acediscovery', license: 'CC BY 4.0',
    },
    {
      cityId: 'utrecht', id: 'utrecht-way-262779230', name: 'Dom Tower',
      imagePath: '/assets/catalog/dom-tower-utrecht.jpg',
      smallPath: '/assets/catalog/dom-tower-utrecht-640.jpg', author: 'tED', license: 'CC BY 2.0',
    },
  ] as const)('features the correctly attributed $name in $cityId', async (example) => {
    const places: PlacesByCity = {
      [example.cityId]: [
        ...FEATURED_PLACES.filter((place) => place.cityId === example.cityId),
        {
          id: `${example.cityId}-ordinary-place`, cityId: example.cityId, name: 'A nearby place',
          category: 'LANDMARKS', latitude: 52, longitude: 5, tags: [], shortDescription: 'Another mapped place.',
          imagePath: null, imageAttributionId: null,
        },
      ],
    };
    const { harness } = await startPage('/', { places });
    harness.detectChanges();

    const cards = harness.routeNativeElement?.querySelectorAll('.place-card');
    const featuredCard = cards?.[0] as HTMLButtonElement | undefined;
    const image = featuredCard?.querySelector('img') as HTMLImageElement | null | undefined;
    const credit = harness.routeNativeElement?.querySelector('.place-card__credit') as HTMLElement | null;

    expect(cards).toHaveLength(2);
    expect(featuredCard?.textContent).toContain(example.name);
    expect(featuredCard?.classList.contains('place-card--featured')).toBe(true);
    expect(featuredCard?.getAttribute('aria-pressed')).toBe('false');
    expect(image?.getAttribute('src')).toBe(example.imagePath);
    expect(image?.getAttribute('srcset')).toContain(`${example.smallPath} 640w`);
    expect(image?.getAttribute('sizes')).toContain('100vw');
    expect(image?.getAttribute('width')).toBe('1280');
    expect(image?.getAttribute('height')).toBe('960');
    expect(image?.getAttribute('loading')).toBe('eager');
    expect(credit?.textContent).toContain(example.author);
    expect(credit?.textContent).toContain(example.license);
    expect(credit?.textContent).toContain('Resized and re-encoded from the source; displayed with a crop.');
    expect(credit?.querySelector('a[href^="https://commons.wikimedia.org/"]')).toBeTruthy();
    expect(credit?.querySelector(`a[href^="https://creativecommons.org/licenses/"]`)?.textContent)
      .toContain(example.license);
  });

  it('keeps a featured place selectable when its local photo fails to load', async () => {
    const { harness, component } = await startPage('/', {
      places: { amsterdam: [FEATURED_PLACES[0]] },
    });
    harness.detectChanges();

    const image = harness.routeNativeElement?.querySelector('.place-card__image') as HTMLImageElement;
    image.dispatchEvent(new Event('error'));
    harness.detectChanges();

    expect(harness.routeNativeElement?.querySelector('.place-card__image')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('.place-card__credit')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('.place-card')?.classList.contains('place-card--featured'))
      .toBe(false);
    (harness.routeNativeElement?.querySelector('.place-card') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(component.selectedPlaceId()).toBe(FEATURED_PLACES[0].id);
  });

  it('removes a legacy city query without showing the removed selector', async () => {
    const { harness } = await startPage('/?city=haarlem');
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/');
    expect(harness.routeNativeElement?.querySelector('#city-select')).toBeNull();
  });

  it('links to the shared map and focuses it on first and repeated navigation', async () => {
    const { harness } = await startPage('/');
    harness.detectChanges();

    const target = harness.routeNativeElement?.querySelector<HTMLElement>('#map-region');
    const mapLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      '.bottom-nav__item[href$="#map-region"]',
    );
    expect(target).not.toBeNull();
    expect(mapLink?.getAttribute('href')).toBe('/#map-region');
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', { value: scrollIntoView, configurable: true });

    mapLink!.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/#map-region');
    expect(document.activeElement).toBe(target);
    expect(scrollIntoView).toHaveBeenCalledOnce();

    mapLink!.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/#map-region');
    expect(document.activeElement).toBe(target);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it.each([
    { reducedMotion: true, behavior: 'auto' },
    { reducedMotion: false, behavior: 'smooth' },
  ])('browses places with $behavior scrolling for reducedMotion=$reducedMotion', async ({ reducedMotion, behavior }) => {
    const { harness, component } = await startPage('/');
    harness.detectChanges();

    const placeResults = harness.routeNativeElement?.querySelector('.place-results') as HTMLElement;
    const scrollIntoView = vi.fn();
    const matchMedia = vi.fn().mockReturnValue({ matches: reducedMotion });
    Object.defineProperty(placeResults, 'scrollIntoView', { value: scrollIntoView, configurable: true });
    vi.stubGlobal('matchMedia', matchMedia);

    try {
      component.browsePlaces();

      expect(document.activeElement).toBe(placeResults);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior, block: 'start' });
      expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('routes the map Browse Places event through the motion-aware page handler', async () => {
    const { harness } = await startPage('/');
    harness.detectChanges();

    const placeResults = harness.routeNativeElement?.querySelector('.place-results') as HTMLElement;
    const scrollIntoView = vi.fn();
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(placeResults, 'scrollIntoView', { value: scrollIntoView, configurable: true });
    vi.stubGlobal('matchMedia', matchMedia);

    try {
      const map = harness.routeDebugElement!.query(By.directive(MapViewportStub)).componentInstance as MapViewportStub;
      map.browsePlaces.emit();

      expect(document.activeElement).toBe(placeResults);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
      expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([FEATURED_PLACES[1], FEATURED_PLACES[2]])(
    'selects the shared $cityId catalog card and shows its city details',
    async (place) => {
      const { harness, component } = await startPage('/');
      harness.detectChanges();
      const card = Array.from(harness.routeNativeElement?.querySelectorAll<HTMLButtonElement>('.place-card') ?? [])
        .find((candidate) => candidate.textContent?.includes(place.name));

      expect(card).toBeTruthy();
      card!.click();
      await harness.fixture.whenStable();
      harness.detectChanges();

      expect(component.selectedPlace()?.id).toBe(place.id);
      expect(component.selectedPlace()?.cityId).toBe(place.cityId);
      expect(card?.querySelector('.place-card__city')?.textContent?.trim()).toBe(
        place.cityId === 'rotterdam' ? 'Rotterdam' : 'Utrecht',
      );
      expect(harness.routeNativeElement?.querySelector('#place-detail-title')?.textContent).toContain(place.name);
      expect(harness.routeNativeElement?.textContent).toContain(place.cityId === 'rotterdam' ? 'Rotterdam' : 'Utrecht');
      const map = harness.routeDebugElement!.query(By.directive(MapViewportStub)).componentInstance as MapViewportStub;
      expect(map.cities).toEqual(CITIES);
      expect(map.selectedPlaceId).toBe(place.id);
    },
  );

  it('renders each city catalog as it arrives and keeps successful data usable during a partial failure', async () => {
    const { harness, http, component } = await startPage('/', { deferPlaces: true });
    const amsterdamRequest = placesRequest(http, 'amsterdam');
    const rotterdamRequest = placesRequest(http, 'rotterdam');
    const utrechtRequest = placesRequest(http, 'utrecht');

    expect(CITIES.every((city) => component.placeCityStates()[city.id].status === 'loading')).toBe(true);
    amsterdamRequest.flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.placeCityStates().amsterdam).toMatchObject({ status: 'success', data: AMSTERDAM_PLACES });
    expect(component.placeCityStates().rotterdam.status).toBe('loading');
    expect(component.placeCityStates().utrecht.status).toBe('loading');
    expect(component.placesLoading()).toBe(false);
    expect(component.places()).toEqual(AMSTERDAM_PLACES);
    expect(harness.routeNativeElement?.querySelector('.place-skeleton-list')).toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain('Loading places for Rotterdam');
    expect(harness.routeNativeElement?.textContent).toContain('Loading places for Utrecht');

    const search = harness.routeNativeElement?.querySelector<HTMLInputElement>('#place-search');
    search!.value = 'Amsterdam Museum';
    search!.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect(component.filteredPlaces().map((place) => place.name)).toEqual(['Amsterdam Museum']);
    const map = harness.routeDebugElement!.query(By.directive(MapViewportStub)).componentInstance as MapViewportStub;
    expect(map.places).toEqual(component.filteredPlaces());

    rotterdamRequest.flush(
      { status: 503, detail: 'Rotterdam catalog is temporarily unavailable' },
      { status: 503, statusText: 'Unavailable' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.placeCityStates().rotterdam).toMatchObject({ status: 'error', data: null });
    expect(component.placeCityStates().utrecht.status).toBe('loading');
    expect(component.placesWarning()).toContain('Rotterdam');
    expect(harness.routeNativeElement?.textContent).toContain('Places unavailable for Rotterdam');
    expect(component.filteredPlaces()).toEqual([AMSTERDAM_PLACES[0]]);

    utrechtRequest.flush(UTRECHT_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.placeCityStates().utrecht).toMatchObject({ status: 'success', data: UTRECHT_PLACES });
    expect(component.places()).toEqual([...AMSTERDAM_PLACES, ...UTRECHT_PLACES]);
    expect(component.placesLoading()).toBe(false);
  });

  it('cancels old city requests on retry and retains the last successful catalog after refresh failure', async () => {
    const { harness, http, component } = await startPage('/', { deferPlaces: true });
    const oldAmsterdamRequest = placesRequest(http, 'amsterdam');
    const oldRotterdamRequest = placesRequest(http, 'rotterdam');
    const oldUtrechtRequest = placesRequest(http, 'utrecht');
    oldAmsterdamRequest.flush(AMSTERDAM_PLACES);
    oldRotterdamRequest.flush(
      { status: 503, detail: 'Rotterdam catalog is temporarily unavailable' },
      { status: 503, statusText: 'Unavailable' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    const retryButton = harness.routeNativeElement?.querySelector<HTMLButtonElement>(
      '.city-catalog-status__item--error button',
    );
    retryButton!.click();
    harness.detectChanges();
    expect(oldUtrechtRequest.cancelled).toBe(true);
    expect(component.placeCityStates().amsterdam).toMatchObject({ status: 'loading', data: AMSTERDAM_PLACES });
    expect(component.places()).toEqual(AMSTERDAM_PLACES);

    const newAmsterdamRequest = placesRequest(http, 'amsterdam');
    const newRotterdamRequest = placesRequest(http, 'rotterdam');
    const newUtrechtRequest = placesRequest(http, 'utrecht');
    newAmsterdamRequest.flush(
      { status: 503, detail: 'Amsterdam refresh is temporarily unavailable' },
      { status: 503, statusText: 'Unavailable' },
    );
    newRotterdamRequest.flush(ROTTERDAM_PLACES);
    newUtrechtRequest.flush(UTRECHT_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.placeCityStates().amsterdam).toMatchObject({ status: 'error', data: AMSTERDAM_PLACES });
    expect(component.places()).toEqual([...AMSTERDAM_PLACES, ...ROTTERDAM_PLACES, ...UTRECHT_PLACES]);
    expect(harness.routeNativeElement?.textContent).toContain('showing the last loaded catalog');
  });

  it('keeps successful city cards usable and reports one failed city catalog', async () => {
    const { harness, http, component } = await startPage('/', { deferPlaces: true });
    placesRequest(http, 'amsterdam').flush(AMSTERDAM_PLACES);
    placesRequest(http, 'rotterdam').flush(ROTTERDAM_PLACES);
    placesRequest(http, 'utrecht').flush(
      { status: 503, detail: 'Utrecht catalog is temporarily unavailable' },
      { status: 503, statusText: 'Unavailable' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.places()).toEqual([...AMSTERDAM_PLACES, ...ROTTERDAM_PLACES]);
    expect(component.placesError()).toBeNull();
    expect(component.placesWarning()).toContain('Utrecht');
    expect(harness.routeNativeElement?.querySelector('.catalog-warning--map')?.textContent)
      .toContain('Utrecht');
    expect(harness.routeNativeElement?.textContent).toContain('Amsterdam Museum');
    expect(harness.routeNativeElement?.textContent).toContain('Rotterdam Museum');
    const map = harness.routeDebugElement!.query(By.directive(MapViewportStub)).componentInstance as MapViewportStub;
    expect(map.places).toEqual(component.filteredPlaces());
  });

  it('combines text and category filters and sends the same filtered list to the map', async () => {
    const { harness, component } = await startPage('/', {
      places: {
        amsterdam: AMSTERDAM_PLACES,
        rotterdam: [ROTTERDAM_PLACES[1]],
        utrecht: [UTRECHT_PLACES[1]],
      },
    });
    harness.detectChanges();

    const search = harness.routeNativeElement?.querySelector('#place-search') as HTMLInputElement;
    search.focus();
    search.value = 'museum';
    search.dispatchEvent(new Event('input'));
    const museumsButton = Array.from(
      harness.routeNativeElement?.querySelectorAll<HTMLButtonElement>('.filter-chip') ?? [],
    ).find((button) => button.textContent?.trim() === 'Museums');
    museumsButton?.click();
    harness.detectChanges();

    const expected = [AMSTERDAM_PLACES[0], AMSTERDAM_PLACES[2], ROTTERDAM_PLACES[1], UTRECHT_PLACES[1]];
    const map = harness.routeDebugElement!.query(By.directive(MapViewportStub)).componentInstance as MapViewportStub;
    expect(component.filteredPlaces()).toEqual(expected);
    expect(map.places).toBe(component.filteredPlaces());
    expect(harness.routeNativeElement?.querySelectorAll('.place-card')).toHaveLength(4);
    expect(harness.routeNativeElement?.querySelector('.result-count')?.textContent).toContain('4 places');
    expect(search.ownerDocument.activeElement).toBe(search);
  });

  it('keeps all filtered map points while revealing list cards in batches', async () => {
    const manyPlaces = Array.from({ length: 45 }, (_, index) => ({
      ...AMSTERDAM_PLACES[0], id: `place-${index}`,
    }));
    const { harness, component } = await startPage('/', { places: { amsterdam: manyPlaces } });
    harness.detectChanges();

    const map = harness.routeDebugElement!.query(By.directive(MapViewportStub)).componentInstance as MapViewportStub;
    expect(harness.routeNativeElement?.querySelectorAll('.place-card')).toHaveLength(40);
    expect(map.places).toHaveLength(45);
    expect(component.resultCount()).toBe(45);
    (harness.routeNativeElement?.querySelector('.show-more') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelectorAll('.place-card')).toHaveLength(45);
  });

  it('shows the temporary draft count and keeps its city when linking to the editor', async () => {
    const { harness, component } = await startPage('/', { places: { amsterdam: AMSTERDAM_PLACES } });
    harness.detectChanges();

    const count = harness.routeNativeElement?.querySelector('.draft-count');
    const draftPanel = harness.routeNativeElement?.querySelector('.draft-panel');
    const placeResults = harness.routeNativeElement?.querySelector('.place-results');
    const editorLink = harness.routeNativeElement?.querySelector('.draft-editor-link') as HTMLAnchorElement;
    expect(count?.textContent).toContain('0');
    expect(count?.textContent).toContain('stops');
    expect(harness.routeNativeElement?.textContent).toContain('Plan a day in one city.');
    expect(editorLink.getAttribute('href')).toBe('/plans/new?city=amsterdam');
    expect(draftPanel).not.toBeNull();
    expect(placeResults).not.toBeNull();
    expect(placeResults!.closest('.explore-sidebar')).not.toBeNull();
    expect(draftPanel!.closest('.map-column')).not.toBeNull();

    component.draftStore.initializeDraft('amsterdam', 'Amsterdam');
    component.draftStore.addPlaces('amsterdam', 'Amsterdam', ['amsterdam-museum'], AMSTERDAM_PLACES);
    harness.detectChanges();

    expect(harness.routeNativeElement?.querySelector('.draft-count')?.textContent).toContain('1');
    expect(harness.routeNativeElement?.querySelector('.draft-count')?.textContent).toContain('stop');
    expect(harness.routeNativeElement?.textContent).toContain('Temporary tab draft');
    expect(harness.routeNativeElement?.textContent).toContain('Temporary tab draft for Amsterdam');
    expect(harness.routeNativeElement?.textContent).toContain('not saved to the server');
    expect(component.draftEditorCityId()).toBe('amsterdam');
    expect((harness.routeNativeElement?.querySelector('.draft-editor-link') as HTMLAnchorElement)
      .getAttribute('href')).toBe('/plans/new?city=amsterdam');
  });

  it('opens the same place from a card or map marker and restores focus on Escape', async () => {
    const { harness } = await startPage('/', { places: { amsterdam: AMSTERDAM_PLACES } });
    harness.detectChanges();

    const firstCard = harness.routeNativeElement?.querySelector('.place-card') as HTMLButtonElement;
    firstCard.focus();
    firstCard.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    const page = harness.routeDebugElement!.componentInstance as ExplorePage;
    const map = harness.routeDebugElement!.query(By.directive(MapViewportStub)).componentInstance as MapViewportStub;
    expect(page.selectedPlaceId()).toBe('amsterdam-museum');
    expect(map.selectedPlaceId).toBe('amsterdam-museum');
    expect(harness.routeNativeElement?.querySelector('#place-detail-title')?.textContent).toContain('Amsterdam Museum');
    expect(harness.routeNativeElement?.querySelectorAll('.nearby-list li')).toHaveLength(2);
    expect(harness.routeNativeElement?.textContent).toContain('Approx. straight-line distance:');
    expect(harness.routeNativeElement?.textContent).toContain('Amsterdam Central');
    expect(document.activeElement).toBe(harness.routeNativeElement?.querySelector('#place-detail-title'));

    const addPlace = Array.from(harness.routeNativeElement?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Add to plan') as HTMLButtonElement;
    addPlace.click();
    harness.detectChanges();
    expect(page.draftStore.draft()?.placeIds).toEqual(['amsterdam-museum']);
    expect(harness.routeNativeElement?.querySelector('.added-badge')?.textContent).toContain('Added');
    addPlace.click();
    expect(page.draftFeedback()).toBe('Already in plan.');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(page.selectedPlaceId()).toBeNull();
    expect(document.activeElement).toBe(firstCard);

    map.placeSelected.emit('van-gogh');
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(page.selectedPlaceId()).toBe('van-gogh');
    expect(harness.routeNativeElement?.querySelector('#place-detail-title')?.textContent).toContain('Van Gogh Museum');
  });

  it('shows a selected city hub failure and recovers its nearby hubs on retry', async () => {
    const { harness, http, component } = await startPage('/', { deferHubs: true });
    const amsterdamRequest = stopsRequest(http, 'amsterdam');
    const rotterdamRequest = stopsRequest(http, 'rotterdam');
    const utrechtRequest = stopsRequest(http, 'utrecht');
    amsterdamRequest.flush(HUBS.filter((hub) => hub.cityId === 'amsterdam'));
    rotterdamRequest.flush(HUBS.filter((hub) => hub.cityId === 'rotterdam'));
    component.selectPlace(FEATURED_PLACES[2].id);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.selectedHubState()?.status).toBe('loading');
    expect(harness.routeNativeElement?.textContent).toContain('Checking nearby hubs in Utrecht');

    utrechtRequest.flush(
      { status: 503, detail: 'Utrecht hub catalog is temporarily unavailable' },
      { status: 503, statusText: 'Unavailable' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.selectedHubState()).toMatchObject({ status: 'error', data: null });
    expect(harness.routeNativeElement?.textContent).toContain('Hub information unavailable for Utrecht');
    expect(harness.routeNativeElement?.textContent).not.toContain('No curated nearby hub listed.');

    (harness.routeNativeElement?.querySelector('.nearby-error button') as HTMLButtonElement).click();
    harness.detectChanges();
    for (const city of CITIES) {
      stopsRequest(http, city.id).flush(HUBS.filter((hub) => hub.cityId === city.id));
    }
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.selectedHubState()).toMatchObject({ status: 'success', data: [HUBS[3]] });
    expect(harness.routeNativeElement?.querySelector('.nearby-error')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('.nearby-list')?.textContent).toContain('Utrecht Central');
  });

  it('reports no curated nearby hub without implying transit is unavailable', async () => {
    const { harness } = await startPage('/', { hubs: [], places: { amsterdam: AMSTERDAM_PLACES } });
    harness.detectChanges();
    (harness.routeNativeElement?.querySelector('.place-card') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.textContent)
      .toContain('No curated nearby hub listed in the loaded Amsterdam catalog.');
    expect(harness.routeNativeElement?.textContent).not.toContain('no transit available');
  });

  it('loads deterministic Discover IDs, highlights the same places, and adds them idempotently', async () => {
    const { harness, http, component } = await startPage('/', {
      places: {
        amsterdam: AMSTERDAM_PLACES,
        rotterdam: ROTTERDAM_PLACES,
        utrecht: UTRECHT_PLACES,
      },
    });
    component.chooseDiscoverTheme('architecture');
    flushDiscover(http, 'architecture', {
      amsterdam: [AMSTERDAM_PLACES[1], AMSTERDAM_PLACES[2], AMSTERDAM_PLACES[1]],
      rotterdam: [ROTTERDAM_PLACES[1]],
      utrecht: [UTRECHT_PLACES[1]],
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    const selectedTheme = Array.from(harness.routeNativeElement?.querySelectorAll('.discover-theme') ?? [])
      .find((button) => button.textContent?.includes('Architecture Hunt')) as HTMLButtonElement;
    expect(selectedTheme.getAttribute('aria-pressed')).toBe('true');
    const expectedIds = ['museumplein', 'van-gogh', 'rotterdam-museum', 'utrecht-museum'];
    const map = harness.routeDebugElement!.query(By.directive(MapViewportStub)).componentInstance as MapViewportStub;
    expect(component.discoverPlaceIds()).toEqual(expectedIds);
    expect(map.discoverPlaceIds).toEqual(expectedIds);
    expect(component.discoverGroups().map((group) => [group.cityId, group.placeIds.length])).toEqual([
      ['amsterdam', 2], ['rotterdam', 1], ['utrecht', 1],
    ]);
    expect(harness.routeNativeElement?.querySelectorAll('.place-card--discover')).toHaveLength(4);
    expect(harness.routeNativeElement?.textContent).toContain('Amsterdam');
    expect(harness.routeNativeElement?.textContent).toContain('Rotterdam');
    expect(harness.routeNativeElement?.textContent).toContain('Utrecht');

    (harness.routeNativeElement?.querySelector('.discover-pick') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.selectedPlaceId()).toBe('museumplein');
    expect(map.selectedPlaceId).toBe('museumplein');
    expect(harness.routeNativeElement?.querySelector('#place-detail-title')?.textContent)
      .toContain('Museumplein');

    const addAmsterdam = Array.from(harness.routeNativeElement?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Add Amsterdam picks to plan') as HTMLButtonElement;
    addAmsterdam.click();
    expect(component.draftStore.draft()?.placeIds).toEqual(['museumplein', 'van-gogh']);
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('not saved to the server');
    addAmsterdam.click();
    expect(component.draftFeedback()).toBe('Already in plan.');

    selectedTheme.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.activeDiscoverTheme()).toBeNull();
    expect(component.discoverPlaceIds()).toEqual([]);
    expect(harness.routeNativeElement?.querySelector('.discover-results')).toBeNull();
  });

  it('keeps Discover groups loading until their city catalog can verify returned place IDs', async () => {
    const { harness, http, component } = await startPage('/', { deferPlaces: true });
    component.chooseDiscoverTheme('culture');
    const discoverRequests = CITIES.map((city) => discoverRequest(http, city.id, 'culture'));
    discoverRequests.forEach((request, index) => request.flush({
      cityId: CITIES[index].id,
      theme: 'culture',
      description: `${CITIES[index].name} culture.`,
      placeIds: [[AMSTERDAM_PLACES[1]], [ROTTERDAM_PLACES[1]], [UTRECHT_PLACES[1]]][index]
        .map((place) => place.id),
    }));
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.discoverGroups().map((group) => group.status)).toEqual(['loading', 'loading', 'loading']);
    expect(harness.routeNativeElement?.textContent).not.toContain('No verified places matched this theme here.');

    placesRequest(http, 'amsterdam').flush(AMSTERDAM_PLACES);
    placesRequest(http, 'rotterdam').flush(ROTTERDAM_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.discoverGroups().map((group) => group.status)).toEqual(['success', 'success', 'loading']);
    expect(component.discoverPlaceIds()).toEqual([AMSTERDAM_PLACES[1].id, ROTTERDAM_PLACES[1].id]);

    placesRequest(http, 'utrecht').flush(
      { status: 503, detail: 'Utrecht catalog is temporarily unavailable' },
      { status: 503, statusText: 'Unavailable' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.discoverGroups()[2]).toMatchObject({
      status: 'error',
      error: 'Could not verify Utrecht picks because its place catalog is unavailable.',
      placeIds: [],
    });
    expect(component.discoverState()).toBe('loaded');
    expect(component.discoverWarning()).toContain('Utrecht');
    expect(harness.routeNativeElement?.querySelector('.discover-city-group:last-child')?.textContent)
      .toContain('Could not verify Utrecht picks');
  });

  it('retries a failed Discover request manually without deselecting its theme', async () => {
    const { harness, http, component } = await startPage('/');
    harness.detectChanges();

    const architectureButton = Array.from(
      harness.routeNativeElement?.querySelectorAll('.discover-theme') ?? [],
    ).find((button) => button.textContent?.includes('Architecture Hunt')) as HTMLButtonElement;
    architectureButton.click();
    const firstRequests = CITIES.map((city) => discoverRequest(http, city.id, 'architecture'));
    firstRequests.forEach((request) => request.flush(
      { status: 500, detail: 'Discover is temporarily unavailable' },
      { status: 500, statusText: 'Server Error' },
    ));
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(architectureButton.getAttribute('aria-pressed')).toBe('true');
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent)
      .toContain('Discover is temporarily unavailable');
    expect(harness.routeNativeElement?.querySelector('.discover-error button')).toBeTruthy();

    (harness.routeNativeElement?.querySelector('.discover-error button') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(component.activeDiscoverTheme()).toBe('architecture');
    expect(harness.routeNativeElement?.querySelector('.discover-results [role="status"]')?.textContent)
      .toContain('Finding architecture picks across all three cities');
    const secondRequests = CITIES.map((city) => discoverRequest(http, city.id, 'architecture'));
    secondRequests.forEach((request) => request.flush(
      { status: 503, detail: 'Discover is still unavailable' },
      { status: 503, statusText: 'Unavailable' },
    ));
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.activeDiscoverTheme()).toBe('architecture');
    expect(architectureButton.getAttribute('aria-pressed')).toBe('true');
    expect(harness.routeNativeElement?.querySelector('.discover-error button')).toBeTruthy();
    http.expectNone((request) => request.url === '/api/discover');

    (harness.routeNativeElement?.querySelector('.discover-error button') as HTMLButtonElement).click();
    flushDiscover(http, 'architecture', { amsterdam: [AMSTERDAM_PLACES[1]] });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.activeDiscoverTheme()).toBe('architecture');
    expect(component.discoverState()).toBe('loaded');
    expect(component.discoverPlaceIds()).toEqual(['museumplein']);
    expect(architectureButton.getAttribute('aria-pressed')).toBe('true');
    expect(harness.routeNativeElement?.querySelectorAll('.discover-pick')).toHaveLength(1);
    expect(harness.routeNativeElement?.textContent).toContain('Museumplein');
    expect(harness.routeNativeElement?.querySelector('.discover-error')).toBeNull();
    http.expectNone((request) => request.url === '/api/discover');
  });

  it('shows Discover groups progressively, reports one failed city, and recovers after retry', async () => {
    const { harness, http, component } = await startPage('/');
    component.chooseDiscoverTheme('architecture');
    const amsterdamRequest = discoverRequest(http, 'amsterdam', 'architecture');
    const rotterdamRequest = discoverRequest(http, 'rotterdam', 'architecture');
    const utrechtRequest = discoverRequest(http, 'utrecht', 'architecture');
    amsterdamRequest.flush({
      cityId: 'amsterdam', theme: 'architecture', description: 'Amsterdam architecture.',
      placeIds: [AMSTERDAM_PLACES[1].id],
    });
    rotterdamRequest.flush({
      cityId: 'rotterdam', theme: 'architecture', description: 'Rotterdam architecture.',
      placeIds: [ROTTERDAM_PLACES[1].id],
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.discoverState()).toBe('loading');
    expect(component.discoverGroups().map((group) => [group.cityId, group.status])).toEqual([
      ['amsterdam', 'success'], ['rotterdam', 'success'], ['utrecht', 'loading'],
    ]);
    expect(component.discoverPlaceIds()).toEqual([AMSTERDAM_PLACES[1].id, ROTTERDAM_PLACES[1].id]);
    expect(harness.routeNativeElement?.textContent).toContain('Museumplein');
    expect(harness.routeNativeElement?.textContent).toContain('Rotterdam Museum');
    expect(harness.routeNativeElement?.textContent).toContain('Finding verified picks in Utrecht');

    utrechtRequest.flush(
      { status: 503, detail: 'Utrecht picks are temporarily unavailable' },
      { status: 503, statusText: 'Unavailable' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.discoverState()).toBe('loaded');
    expect(component.discoverGroups()[2]).toMatchObject({ status: 'error', placeIds: [] });
    expect(component.discoverWarning()).toContain('Utrecht');
    expect(harness.routeNativeElement?.querySelector('.discover-city-group:last-child')?.textContent)
      .toContain('Utrecht picks are temporarily unavailable');

    (harness.routeNativeElement?.querySelector('.discover-warning button') as HTMLButtonElement).click();
    const retryRequests = CITIES.map((city) => discoverRequest(http, city.id, 'architecture'));
    retryRequests.forEach((request, index) => request.flush({
      cityId: CITIES[index].id,
      theme: 'architecture',
      description: `${CITIES[index].name} architecture.`,
      placeIds: [[AMSTERDAM_PLACES[1]], [ROTTERDAM_PLACES[1]], [UTRECHT_PLACES[1]]][index]
        .map((place) => place.id),
    }));
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.discoverState()).toBe('loaded');
    expect(component.discoverGroups().map((group) => group.status)).toEqual(['success', 'success', 'success']);
    expect(component.discoverWarning()).toBeNull();
    expect(component.discoverPlaceIds()).toEqual([
      AMSTERDAM_PLACES[1].id, ROTTERDAM_PLACES[1].id, UTRECHT_PLACES[1].id,
    ]);
  });

  it('deselects a selected Discover theme and cancels its pending request', async () => {
    const { harness, http, component } = await startPage('/');
    harness.detectChanges();

    const architectureButton = Array.from(
      harness.routeNativeElement?.querySelectorAll('.discover-theme') ?? [],
    ).find((button) => button.textContent?.includes('Architecture Hunt')) as HTMLButtonElement;
    architectureButton.click();
    const pendingRequests = CITIES.map((city) => discoverRequest(http, city.id, 'architecture'));

    architectureButton.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(pendingRequests.every((request) => request.cancelled)).toBe(true);
    expect(component.activeDiscoverTheme()).toBeNull();
    expect(component.discoverState()).toBe('idle');
    expect(component.discoverPlaceIds()).toEqual([]);
    expect(harness.routeNativeElement?.querySelector('.discover-results')).toBeNull();
  });

  it('shows an accessible empty state when a Discover theme has no verified matches', async () => {
    const { harness, http, component } = await startPage('/');
    component.chooseDiscoverTheme('green');
    flushDiscover(http, 'green', {});
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.discoverGroups()).toHaveLength(3);
    expect(harness.routeNativeElement?.textContent).toContain('No verified places matched this theme here.');
    expect(harness.routeNativeElement?.querySelector('.discover-picks')).toBeNull();
  });

  it('cancels stale all-city Discover requests when the selected theme changes', async () => {
    const { harness, http, component } = await startPage('/');
    component.chooseDiscoverTheme('architecture');
    const oldThemeRequests = CITIES.map((city) => discoverRequest(http, city.id, 'architecture'));
    component.chooseDiscoverTheme('culture');
    const oldCultureRequests = CITIES.map((city) => discoverRequest(http, city.id, 'culture'));
    expect(oldThemeRequests.every((request) => request.cancelled)).toBe(true);
    component.chooseDiscoverTheme('green');
    expect(oldCultureRequests.every((request) => request.cancelled)).toBe(true);

    flushDiscover(http, 'green', { rotterdam: [ROTTERDAM_PLACES[1]] });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.activeDiscoverTheme()).toBe('green');
    expect(component.discoverPlaceIds()).toEqual(['rotterdam-museum']);
    expect(component.discoverGroups().map((group) => group.cityId)).toEqual([
      'amsterdam', 'rotterdam', 'utrecht',
    ]);
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('asks before replacing a draft when adding a place from another city', async () => {
    const { harness, component } = await startPage('/');
    component.addPlaceToPlan('amsterdam-museum');
    harness.detectChanges();
    component.addPlaceToPlan('rotterdam-museum');
    harness.detectChanges();

    expect(component.draftStore.draft()?.cityId).toBe('amsterdam');
    expect(harness.routeNativeElement?.querySelector('#draft-conflict-title')).toBeTruthy();
    const keep = Array.from(harness.routeNativeElement?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Keep existing') as HTMLButtonElement;
    keep.click();
    await harness.fixture.whenStable();
    expect(component.draftStore.draft()).toMatchObject({
      cityId: 'amsterdam',
      placeIds: ['amsterdam-museum'],
    });

    component.addPlaceToPlan('rotterdam-museum');
    harness.detectChanges();
    const replace = Array.from(harness.routeNativeElement?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('Start new for Rotterdam')) as HTMLButtonElement;
    replace.click();
    await harness.fixture.whenStable();
    expect(component.draftStore.draft()).toMatchObject({
      cityId: 'rotterdam',
      placeIds: ['rotterdam-museum'],
    });
  });

  it('shows a catalog error and retries all three city requests', async () => {
    const { harness, http } = await startPage('/', { deferPlaces: true });
    for (const city of CITIES) {
      placesRequest(http, city.id).flush(
      { status: 503, detail: 'Catalog is temporarily unavailable' },
      { status: 503, statusText: 'Unavailable' },
      );
    }
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent)
      .toContain('Catalog is temporarily unavailable');

    (harness.routeNativeElement?.querySelector('.state-card button') as HTMLButtonElement).click();
    flushPlaces(http, { amsterdam: AMSTERDAM_PLACES });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelectorAll('.place-card')).toHaveLength(3);
  });

  it('retains the API health status and supports health retry', async () => {
    const harness = await RouterTestingHarness.create('/');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/health').flush('offline', { status: 503, statusText: 'Service unavailable' });
    http.expectOne('/api/cities').flush(CITIES);
    for (const city of CITIES) {
      stopsRequest(http, city.id).flush(HUBS.filter((hub) => hub.cityId === city.id));
    }
    flushPlaces(http, {});
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.querySelector('.api-alert')).toBeTruthy();
    expect(harness.routeNativeElement?.querySelector('.api-alert')?.textContent)
      .toContain('API returned HTTP 503');
    (harness.routeNativeElement?.querySelector('button.api-status__retry') as HTMLButtonElement).click();
    http.expectOne('/api/health').flush({ status: 'UP', service: 'hopon-api' });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('.api-alert')).toBeNull();
  });
});
