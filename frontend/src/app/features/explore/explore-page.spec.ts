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
  @Input({ required: true }) city!: CityDto;
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
    TestBed.inject(HttpTestingController).verify({ ignoreCancelled: true });
    sessionStorage.removeItem(DRAFT_PLAN_STORAGE_KEY);
  });

  async function startPage(url: string, hubData?: readonly MobilityHubDto[]) {
    const harness = await RouterTestingHarness.create(url);
    const http = TestBed.inject(HttpTestingController);
    const healthRequest = http.expectOne('/api/health');
    healthRequest.flush({ status: 'UP', service: 'hopon-api' });
    http.expectOne('/api/cities').flush(CITIES);
    const queryCity = new URL(url, 'http://localhost').searchParams.get('city');
    const cityId = queryCity === 'rotterdam' || queryCity === 'utrecht' ? queryCity : 'amsterdam';
    stopsRequest(http, cityId).flush(hubData ?? HUBS.filter((hub) => hub.cityId === cityId));
    await harness.fixture.whenStable();
    harness.detectChanges();
    return {
      harness,
      http,
      component: harness.routeDebugElement!.componentInstance as ExplorePage,
    };
  }

  it('defaults to Amsterdam, canonicalizes the URL, and renders city places', async () => {
    const { harness, http, component } = await startPage('/');
    const request = placesRequest(http, 'amsterdam');
    request.flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.selectedCityId()).toBe('amsterdam');
    expect(TestBed.inject(Router).url).toContain('city=amsterdam');
    expect(harness.routeNativeElement?.querySelectorAll('.place-card')).toHaveLength(3);
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
    const { harness, http } = await startPage(`/?city=${example.cityId}`);
    placesRequest(http, example.cityId).flush([
      ...FEATURED_PLACES.filter((place) => place.cityId === example.cityId),
      {
        id: `${example.cityId}-ordinary-place`, cityId: example.cityId, name: 'A nearby place',
        category: 'LANDMARKS', latitude: 52, longitude: 5, tags: [], shortDescription: 'Another mapped place.',
        imagePath: null, imageAttributionId: null,
      },
    ]);
    await harness.fixture.whenStable();
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
    const { harness, http, component } = await startPage('/?city=amsterdam');
    placesRequest(http, 'amsterdam').flush([FEATURED_PLACES[0]]);
    await harness.fixture.whenStable();
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

  it('replaces an invalid city query with the Amsterdam default', async () => {
    const { harness, http } = await startPage('/?city=haarlem');
    placesRequest(http, 'amsterdam').flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toContain('city=amsterdam');
    expect(harness.routeNativeElement?.querySelector('#city-select')).toBeTruthy();
  });

  it.each(['rotterdam', 'utrecht'] as const)(
    'keeps %s selected and focuses the map on first and repeated Map navigation',
    async (cityId) => {
      const { harness, http } = await startPage(`/?city=${cityId}`);
      placesRequest(http, cityId).flush([]);
      await harness.fixture.whenStable();
      harness.detectChanges();

      const target = harness.routeNativeElement?.querySelector<HTMLElement>('#map-region');
      const mapLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
        '.bottom-nav__item[href$="#map-region"]',
      );
      expect(target).not.toBeNull();
      expect(mapLink).not.toBeNull();
      const scrollIntoView = vi.fn();
      Object.defineProperty(target, 'scrollIntoView', { value: scrollIntoView, configurable: true });

      mapLink!.click();
      await harness.fixture.whenStable();
      harness.detectChanges();

      expect(TestBed.inject(Router).url).toBe(`/?city=${cityId}#map-region`);
      expect(document.activeElement).toBe(target);
      expect(scrollIntoView).toHaveBeenCalledOnce();

      mapLink!.click();
      await harness.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe(`/?city=${cityId}#map-region`);
      expect(document.activeElement).toBe(target);
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    },
  );

  it('loads a directly requested city and changes city through the accessible selector', async () => {
    const { harness, http, component } = await startPage('/?city=rotterdam');
    const rotterdamRequest = placesRequest(http, 'rotterdam');
    rotterdamRequest.flush([
      { ...AMSTERDAM_PLACES[0], id: 'rotterdam-place', cityId: 'rotterdam' },
    ]);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('#places-title')?.textContent).toContain('Places');

    const selector = harness.routeNativeElement?.querySelector('#city-select') as HTMLSelectElement;
    component.selectPlace('rotterdam-place');
    selector.value = 'utrecht';
    selector.dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
    const utrechtRequest = placesRequest(http, 'utrecht');
    utrechtRequest.flush([]);
    stopsRequest(http, 'utrecht').flush(HUBS.filter((hub) => hub.cityId === 'utrecht'));
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toContain('city=utrecht');
    expect(selector.value).toBe('utrecht');
    expect(component.selectedPlaceId()).toBeNull();
    const map = harness.routeDebugElement!.query(By.directive(MapViewportStub)).componentInstance as MapViewportStub;
    expect(map.city.id).toBe('utrecht');
  });

  it('cancels stale city requests during a quick Amsterdam to Rotterdam to Utrecht switch', async () => {
    const { harness, http, component } = await startPage('/?city=amsterdam');
    const amsterdamRequest = placesRequest(http, 'amsterdam');

    await TestBed.inject(Router).navigateByUrl('/?city=rotterdam');
    const rotterdamRequest = placesRequest(http, 'rotterdam');
    const rotterdamHubsRequest = stopsRequest(http, 'rotterdam');
    await TestBed.inject(Router).navigateByUrl('/?city=utrecht');
    const utrechtRequest = placesRequest(http, 'utrecht');
    const utrechtHubsRequest = stopsRequest(http, 'utrecht');
    expect(amsterdamRequest.cancelled).toBe(true);
    expect(rotterdamRequest.cancelled).toBe(true);
    expect(rotterdamHubsRequest.cancelled).toBe(true);

    const utrechtPlace = { ...AMSTERDAM_PLACES[0], id: 'utrecht-place', cityId: 'utrecht' as const };
    utrechtRequest.flush([utrechtPlace]);
    utrechtHubsRequest.flush(HUBS.filter((hub) => hub.cityId === 'utrecht'));
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.selectedCityId()).toBe('utrecht');
    expect(component.places().map((place) => place.id)).toEqual(['utrecht-place']);
    expect(harness.routeNativeElement?.textContent).toContain('Amsterdam Museum');
  });

  it('combines text and category filters and sends the same filtered list to the map', async () => {
    const { harness, http, component } = await startPage('/?city=amsterdam');
    placesRequest(http, 'amsterdam').flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
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

    const expected = [AMSTERDAM_PLACES[0], AMSTERDAM_PLACES[2]];
    const map = harness.routeDebugElement!.query(By.directive(MapViewportStub)).componentInstance as MapViewportStub;
    expect(component.filteredPlaces()).toEqual(expected);
    expect(map.places).toBe(component.filteredPlaces());
    expect(harness.routeNativeElement?.querySelectorAll('.place-card')).toHaveLength(2);
    expect(harness.routeNativeElement?.querySelector('.result-count')?.textContent).toContain('2 places');
    expect(search.ownerDocument.activeElement).toBe(search);
  });

  it('keeps all filtered map points while revealing list cards in batches', async () => {
    const { harness, http, component } = await startPage('/?city=amsterdam');
    const manyPlaces = Array.from({ length: 45 }, (_, index) => ({
      ...AMSTERDAM_PLACES[0], id: `place-${index}`,
    }));
    placesRequest(http, 'amsterdam').flush(manyPlaces);
    await harness.fixture.whenStable();
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
    const { harness, http, component } = await startPage('/?city=amsterdam');
    placesRequest(http, 'amsterdam').flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const count = harness.routeNativeElement?.querySelector('.draft-count');
    const draftPanel = harness.routeNativeElement?.querySelector('.draft-panel');
    const placeResults = harness.routeNativeElement?.querySelector('.place-results');
    const editorLink = harness.routeNativeElement?.querySelector('.draft-editor-link') as HTMLAnchorElement;
    expect(count?.textContent).toContain('0');
    expect(count?.textContent).toContain('stops');
    expect(harness.routeNativeElement?.textContent).toContain('No stops yet for Amsterdam');
    expect(editorLink.getAttribute('href')).toBe('/plans/new?city=amsterdam');
    expect(draftPanel).not.toBeNull();
    expect(placeResults).not.toBeNull();
    expect(
      (draftPanel!.compareDocumentPosition(placeResults!) & Node.DOCUMENT_POSITION_FOLLOWING) > 0,
    ).toBe(true);

    component.draftStore.initializeDraft('amsterdam', 'Amsterdam');
    component.draftStore.addPlaces('amsterdam', 'Amsterdam', ['amsterdam-museum'], AMSTERDAM_PLACES);
    component.selectedCityId.set('rotterdam');
    harness.detectChanges();

    expect(harness.routeNativeElement?.querySelector('.draft-count')?.textContent).toContain('1');
    expect(harness.routeNativeElement?.querySelector('.draft-count')?.textContent).toContain('stop');
    expect(harness.routeNativeElement?.textContent).toContain('Temporary tab draft');
    expect(harness.routeNativeElement?.textContent).toContain('Temporary tab draft for Amsterdam');
    expect(harness.routeNativeElement?.textContent).toContain('not saved to the server');
    expect((harness.routeNativeElement?.querySelector('.draft-editor-link') as HTMLAnchorElement)
      .getAttribute('href')).toBe('/plans/new?city=amsterdam');
  });

  it('opens the same place from a card or map marker and restores focus on Escape', async () => {
    const { harness, http } = await startPage('/?city=amsterdam');
    placesRequest(http, 'amsterdam').flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
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

  it('reports no curated nearby hub without implying transit is unavailable', async () => {
    const { harness, http } = await startPage('/?city=amsterdam', []);
    placesRequest(http, 'amsterdam').flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();
    (harness.routeNativeElement?.querySelector('.place-card') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.textContent).toContain('No curated nearby hub listed.');
    expect(harness.routeNativeElement?.textContent).not.toContain('no transit available');
  });

  it('loads deterministic Discover IDs, highlights the same places, and adds them idempotently', async () => {
    const { harness, http, component } = await startPage('/?city=amsterdam');
    placesRequest(http, 'amsterdam').flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();
    component.chooseDiscoverTheme('architecture');
    const discoverRequest = http.expectOne(
      (request) => request.url === '/api/discover'
        && request.params.get('cityId') === 'amsterdam'
        && request.params.get('theme') === 'architecture',
    );
    discoverRequest.flush({
      cityId: 'amsterdam',
      theme: 'architecture',
      description: 'Architecture highlights selected from the verified catalog.',
      placeIds: ['museumplein', 'van-gogh', 'museumplein', 'not-in-catalog'],
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    const selectedTheme = Array.from(harness.routeNativeElement?.querySelectorAll('.discover-theme') ?? [])
      .find((button) => button.textContent?.includes('Architecture Hunt')) as HTMLButtonElement;
    expect(selectedTheme.getAttribute('aria-pressed')).toBe('true');
    const expectedIds = ['museumplein', 'van-gogh'];
    const map = harness.routeDebugElement!.query(By.directive(MapViewportStub)).componentInstance as MapViewportStub;
    expect(component.discoverPlaceIds()).toEqual(expectedIds);
    expect(map.discoverPlaceIds).toEqual(expectedIds);
    expect(harness.routeNativeElement?.querySelectorAll('.place-card--discover')).toHaveLength(2);
    expect(harness.routeNativeElement?.textContent).toContain('2 verified places in Amsterdam');
    expect(harness.routeNativeElement?.querySelector('.discover-count')?.textContent).toContain('in Amsterdam');

    (harness.routeNativeElement?.querySelector('.discover-pick') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.selectedPlaceId()).toBe('museumplein');
    expect(map.selectedPlaceId).toBe('museumplein');
    expect(harness.routeNativeElement?.querySelector('#place-detail-title')?.textContent)
      .toContain('Museumplein');

    const addAll = Array.from(harness.routeNativeElement?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Add all to plan') as HTMLButtonElement;
    addAll.click();
    expect(component.draftStore.draft()?.placeIds).toEqual(expectedIds);
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('not saved to the server');
    addAll.click();
    expect(component.draftFeedback()).toBe('Already in plan.');

    selectedTheme.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.activeDiscoverTheme()).toBeNull();
    expect(component.discoverPlaceIds()).toEqual([]);
    expect(harness.routeNativeElement?.querySelector('.discover-results')).toBeNull();
  });

  it('shows an accessible empty state when a Discover theme has no verified matches', async () => {
    const { harness, http, component } = await startPage('/?city=amsterdam');
    placesRequest(http, 'amsterdam').flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
    component.chooseDiscoverTheme('green');
    http.expectOne(
      (request) => request.url === '/api/discover' && request.params.get('theme') === 'green',
    ).flush({
      cityId: 'amsterdam',
      theme: 'green',
      description: 'Green spaces selected from the verified catalog.',
      placeIds: [],
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.textContent).toContain('0 verified places in Amsterdam');
    expect(harness.routeNativeElement?.textContent).toContain('No verified places matched this theme');
    expect(harness.routeNativeElement?.querySelector('.discover-picks')).toBeNull();
  });

  it('cancels stale theme and city Discover responses', async () => {
    const { harness, http, component } = await startPage('/?city=amsterdam');
    placesRequest(http, 'amsterdam').flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();

    component.chooseDiscoverTheme('architecture');
    const oldThemeRequest = http.expectOne(
      (request) => request.url === '/api/discover' && request.params.get('theme') === 'architecture',
    );
    component.chooseDiscoverTheme('culture');
    const oldCityRequest = http.expectOne(
      (request) => request.url === '/api/discover' && request.params.get('theme') === 'culture',
    );
    expect(oldThemeRequest.cancelled).toBe(true);

    await TestBed.inject(Router).navigateByUrl('/?city=rotterdam');
    const rotterdamPlaces = placesRequest(http, 'rotterdam');
    const rotterdamHubs = stopsRequest(http, 'rotterdam');
    expect(oldCityRequest.cancelled).toBe(true);
    rotterdamPlaces.flush([
      { ...AMSTERDAM_PLACES[0], id: 'rotterdam-museum', cityId: 'rotterdam' },
    ]);
    rotterdamHubs.flush(HUBS.filter((hub) => hub.cityId === 'rotterdam'));
    await harness.fixture.whenStable();

    component.chooseDiscoverTheme('green');
    const currentRequest = http.expectOne(
      (request) => request.url === '/api/discover'
        && request.params.get('cityId') === 'rotterdam'
        && request.params.get('theme') === 'green',
    );
    currentRequest.flush({
      cityId: 'rotterdam',
      theme: 'green',
      description: 'Green spaces selected from the verified catalog.',
      placeIds: ['rotterdam-museum'],
    });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.activeDiscoverTheme()).toBe('green');
    expect(component.discoverPlaceIds()).toEqual(['rotterdam-museum']);
    expect(component.discoverPlaces().every((place) => place.cityId === 'rotterdam')).toBe(true);
  });

  it('asks before replacing a draft when adding a place from another city', async () => {
    const { harness, http, component } = await startPage('/?city=amsterdam');
    placesRequest(http, 'amsterdam').flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
    component.addPlaceToPlan('amsterdam-museum');

    await TestBed.inject(Router).navigateByUrl('/?city=rotterdam');
    placesRequest(http, 'rotterdam').flush([
      { ...AMSTERDAM_PLACES[0], id: 'rotterdam-museum', cityId: 'rotterdam' },
    ]);
    stopsRequest(http, 'rotterdam').flush(HUBS.filter((hub) => hub.cityId === 'rotterdam'));
    await harness.fixture.whenStable();
    harness.detectChanges();
    component.addPlaceToPlan('rotterdam-museum');
    harness.detectChanges();

    expect(component.draftStore.draft()?.cityId).toBe('amsterdam');
    expect(harness.routeNativeElement?.querySelector('#draft-conflict-title')).toBeTruthy();
    const replace = Array.from(harness.routeNativeElement?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('Start new for Rotterdam')) as HTMLButtonElement;
    replace.click();
    await harness.fixture.whenStable();
    expect(component.draftStore.draft()).toMatchObject({
      cityId: 'rotterdam',
      placeIds: ['rotterdam-museum'],
    });
  });

  it('shows a catalog error and retries the same city request', async () => {
    const { harness, http } = await startPage('/?city=amsterdam');
    placesRequest(http, 'amsterdam').flush(
      { status: 503, detail: 'Catalog is temporarily unavailable' },
      { status: 503, statusText: 'Unavailable' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent)
      .toContain('Catalog is temporarily unavailable');

    (harness.routeNativeElement?.querySelector('.state-card button') as HTMLButtonElement).click();
    const retry = placesRequest(http, 'amsterdam');
    retry.flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelectorAll('.place-card')).toHaveLength(3);
  });

  it('retains the API health status and supports health retry', async () => {
    const harness = await RouterTestingHarness.create('/?city=amsterdam');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/health').flush('offline', { status: 503, statusText: 'Service unavailable' });
    http.expectOne('/api/cities').flush(CITIES);
    placesRequest(http, 'amsterdam').flush([]);
    stopsRequest(http, 'amsterdam').flush(HUBS.filter((hub) => hub.cityId === 'amsterdam'));
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.querySelector('.api-status--offline')).toBeTruthy();
    expect(harness.routeNativeElement?.querySelector('.api-status__text--desktop')?.textContent)
      .toContain('API returned HTTP 503');
    (harness.routeNativeElement?.querySelector('button.api-status__retry') as HTMLButtonElement).click();
    http.expectOne('/api/health').flush({ status: 'UP', service: 'hopon-api' });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('.api-status--online')).toBeTruthy();
  });
});
