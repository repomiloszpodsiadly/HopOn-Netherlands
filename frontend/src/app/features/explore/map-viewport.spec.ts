import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CityDto, PlaceDto } from '../../core/models/catalog.models';
import { MapViewportComponent } from './map-viewport';

interface MockEvent {
  features?: readonly Readonly<{ properties?: Readonly<Record<string, unknown>> }>[];
  lngLat?: Readonly<{ lng: number; lat: number }>;
  error?: Error;
  sourceId?: string;
  sourceDataType?: string;
}

type MockHandler = (event?: MockEvent) => void;

interface MockCanvas {
  style: { cursor: string };
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatch: (event: string) => void;
}

interface MockSource {
  data: unknown;
  setData: ReturnType<typeof vi.fn>;
  getClusterExpansionZoom: ReturnType<typeof vi.fn>;
}

interface MockMap {
  options: Readonly<Record<string, unknown>>;
  handlers: { event: string; layer?: string; handler: MockHandler; once?: boolean }[];
  sources: Record<string, MockSource>;
  layers: unknown[];
  addControl: ReturnType<typeof vi.fn>;
  addLayer: (layer: unknown) => void;
  addSource: (id: string, definition: unknown) => void;
  getSource: (id: string) => MockSource | undefined;
  getCanvas: () => MockCanvas;
  getZoom: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  setPadding: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  flyTo: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  emit: (event: string, layer?: string, payload?: MockEvent) => void;
  dispatchCanvas: (event: string) => void;
}

const mockMapState = vi.hoisted(() => ({ instances: [] as unknown[], throwOnCreate: false }));

vi.mock('maplibre-gl', () => {
  class FakeMap {
    readonly options: Readonly<Record<string, unknown>>;
    readonly handlers: { event: string; layer?: string; handler: MockHandler; once?: boolean }[] = [];
    readonly sources: Record<string, MockSource> = {};
    readonly layers: unknown[] = [];
    readonly addControl = vi.fn();
    readonly getZoom = vi.fn(() => 12.2);
    readonly stop = vi.fn();
    readonly resize = vi.fn();
    readonly setPadding = vi.fn();
    readonly fitBounds = vi.fn();
    readonly flyTo = vi.fn();
    readonly easeTo = vi.fn();
    readonly off = vi.fn((event: string, layerOrHandler: string | MockHandler, handler?: MockHandler) => {
      const layer = typeof layerOrHandler === 'string' ? layerOrHandler : undefined;
      const target = typeof layerOrHandler === 'string' ? handler : layerOrHandler;
      for (let index = this.handlers.length - 1; index >= 0; index -= 1) {
        const registered = this.handlers[index];
        if (registered.event === event && registered.layer === layer && registered.handler === target) {
          this.handlers.splice(index, 1);
        }
      }
    });
    readonly remove = vi.fn();
    private readonly canvasListeners = new Map<string, EventListener>();
    private readonly canvas: MockCanvas = {
      style: { cursor: '' },
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        this.canvasListeners.set(event, handler);
      }),
      removeEventListener: vi.fn((event: string, handler: EventListener) => {
        if (this.canvasListeners.get(event) === handler) {
          this.canvasListeners.delete(event);
        }
      }),
      dispatch: (event: string) => {
        this.canvasListeners.get(event)?.(new Event(event));
      },
    };

    constructor(options: Readonly<Record<string, unknown>>) {
      if (mockMapState.throwOnCreate) {
        throw new Error('WebGL is unavailable');
      }
      this.options = options;
      mockMapState.instances.push(this);
    }

    addSource(id: string, definition: unknown): void {
      const config = definition as Readonly<{ data?: unknown }>;
      const source: MockSource = {
        data: config.data,
        setData: vi.fn((data: unknown) => {
          source.data = data;
        }),
        getClusterExpansionZoom: vi.fn(() => Promise.resolve(15)),
      };
      this.sources[id] = source;
    }

    addLayer(layer: unknown): void {
      this.layers.push(layer);
    }

    getSource(id: string): MockSource | undefined {
      return this.sources[id];
    }

    getCanvas(): MockCanvas {
      return this.canvas;
    }

    on(event: string, layerOrHandler: string | MockHandler, handler?: MockHandler): void {
      this.handlers.push(
        typeof layerOrHandler === 'string'
          ? { event, layer: layerOrHandler, handler: handler! }
          : { event, handler: layerOrHandler },
      );
    }

    once(event: string, handler: MockHandler): void {
      this.handlers.push({ event, handler, once: true });
    }

    emit(event: string, layer?: string, payload: MockEvent = {}): void {
      const matchingHandlers = this.handlers.filter(
        (entry) => entry.event === event && entry.layer === layer,
      );
      matchingHandlers.forEach((entry) => {
        if (entry.once) {
          this.handlers.splice(this.handlers.indexOf(entry), 1);
        }
        entry.handler(payload);
      });
    }

    dispatchCanvas(event: string): void {
      this.canvas.dispatch(event);
    }
  }

  class FakeNavigationControl {}

  return {
    Map: FakeMap,
    NavigationControl: FakeNavigationControl,
    getVersion: () => '6.17.0',
    setWorkerUrl: vi.fn(),
  };
});

const CITY: CityDto = {
  id: 'amsterdam',
  name: 'Amsterdam',
  center: { latitude: 52.37, longitude: 4.9 },
  defaultZoom: 12.2,
};

const ROTTERDAM: CityDto = {
  id: 'rotterdam',
  name: 'Rotterdam',
  center: { latitude: 51.92, longitude: 4.48 },
  defaultZoom: 12.2,
};

const UTRECHT: CityDto = {
  id: 'utrecht',
  name: 'Utrecht',
  center: { latitude: 52.09, longitude: 5.12 },
  defaultZoom: 12.4,
};

const CITIES: readonly CityDto[] = [CITY, ROTTERDAM, UTRECHT];

const PLACE: PlaceDto = {
  id: 'place-1',
  cityId: 'amsterdam',
  name: 'A place',
  category: 'MUSEUMS',
  latitude: 52.35,
  longitude: 4.91,
  tags: [],
  shortDescription: 'A test place.',
  imagePath: null,
  imageAttributionId: null,
};

const DISTANT_PLACE: PlaceDto = {
  ...PLACE,
  id: 'place-on-city-edge',
  name: 'A distant place',
  latitude: 52.43,
  longitude: 5.0,
};

const ROTTERDAM_PLACE: PlaceDto = {
  ...PLACE,
  id: 'rotterdam-place',
  cityId: 'rotterdam',
  latitude: 51.91,
  longitude: 4.6,
};

const UTRECHT_PLACE: PlaceDto = {
  ...PLACE,
  id: 'utrecht-place',
  cityId: 'utrecht',
  latitude: 52.0907,
  longitude: 5.1214,
};

@Component({
  standalone: true,
  imports: [MapViewportComponent],
  template: `
    <app-map-viewport [cities]="cities" [places]="places" />
    <ul><li class="place-name">{{ places[0]?.name }}</li></ul>
  `,
})
class MapWithPlaceListHost {
  readonly cities = CITIES;
  readonly places = [PLACE];
}

describe('MapViewportComponent', () => {
  beforeEach(() => {
    mockMapState.instances.length = 0;
    mockMapState.throwOnCreate = false;
    TestBed.configureTestingModule({ imports: [MapViewportComponent, MapWithPlaceListHost] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function waitForMap(): Promise<MockMap> {
    await vi.waitFor(() => expect(mockMapState.instances).toHaveLength(1));
    return mockMapState.instances[0] as MockMap;
  }

  it('refits the shared overview after a width change without replacing the map or losing selected-place focus', async () => {
    let onResize: ResizeObserverCallback = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { onResize = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.componentRef.setInput('places', [PLACE]);
    fixture.detectChanges();
    const map = await waitForMap();
    map.emit('load');
    fixture.detectChanges();
    const resize = (width: number, height: number) => onResize([
      { contentRect: { width, height } } as ResizeObserverEntry,
    ], {} as ResizeObserver);

    resize(340, 320);
    expect(map.resize).toHaveBeenCalledOnce();
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    resize(340, 360);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    expect(mockMapState.instances).toHaveLength(1);

    fixture.componentRef.setInput('selectedPlaceId', PLACE.id);
    fixture.detectChanges();
    await fixture.whenStable();
    map.flyTo.mockClear();
    resize(700, 440);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [PLACE.longitude, PLACE.latitude] }));
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    fixture.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    map.resize.mockClear();
    resize(800, 440);
    expect(map.resize).not.toHaveBeenCalled();
  });

  it('creates one map, updates its GeoJSON source, and removes listeners on destroy', async () => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.componentRef.setInput('places', [PLACE]);
    fixture.detectChanges();

    const map = await waitForMap();
    expect(map.options['style']).toBe('https://tiles.openfreemap.org/styles/liberty');
    map.emit('load');
    fixture.detectChanges();
    expect(map.fitBounds).toHaveBeenCalledOnce();
    const [[west, south], [east, north]] = map.fitBounds.mock.calls[0][0] as number[][];
    expect(west).toBeCloseTo(4.35);
    expect(south).toBeCloseTo(51.84);
    expect(east).toBeCloseTo(5.25);
    expect(north).toBeCloseTo(52.45);
    expect(map.fitBounds.mock.calls[0][1]).toEqual({
      padding: { top: 54, right: 54, bottom: 54, left: 54 },
      maxZoom: 9.5,
      duration: 650,
    });

    const source = map.getSource('hopon-places')!;
    const initialFeature = (source.data as { features: { id: string; geometry: { coordinates: number[] } }[] })
      .features[0];
    expect(initialFeature.id).toBe(PLACE.id);
    expect(initialFeature.geometry.coordinates).toEqual([PLACE.longitude, PLACE.latitude]);

    const replacement = { ...PLACE, id: 'place-2', longitude: 4.92 };
    fixture.componentRef.setInput('places', [replacement]);
    fixture.detectChanges();
    expect(source.setData).toHaveBeenCalledTimes(1);
    expect((source.data as { features: { id: string }[] }).features[0].id).toBe('place-2');

    fixture.componentRef.setInput('discoverPlaceIds', ['place-2']);
    fixture.detectChanges();
    expect(source.setData).toHaveBeenCalledTimes(2);
    expect((source.data as { features: { properties: { discover: boolean } }[] }).features[0].properties.discover)
      .toBe(true);

    fixture.componentRef.setInput('selectedPlaceId', 'place-2');
    fixture.detectChanges();
    expect(source.setData).toHaveBeenCalledTimes(3);
    const selectedFeature = (source.data as { features: { properties: { selected: boolean } }[] })
      .features[0];
    expect(selectedFeature.properties.selected).toBe(true);
    expect(mockMapState.instances).toHaveLength(1);

    fixture.destroy();
    expect(map.remove).toHaveBeenCalledOnce();
    expect(map.handlers).toHaveLength(0);
    expect(map.getCanvas().removeEventListener).toHaveBeenCalledOnce();
  });

  it('fits all three city centers after the delayed style load without recreating the map', async () => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.detectChanges();
    const map = await waitForMap();

    map.emit('load');

    expect(mockMapState.instances).toHaveLength(1);
    expect(map.options['center']).toEqual([CITY.center.longitude, CITY.center.latitude]);
    expect(map.options['zoom']).toBe(7);
    expect(map.fitBounds).toHaveBeenCalledOnce();
    const [[west, south], [east, north]] = map.fitBounds.mock.calls[0][0] as number[][];
    expect(west).toBeCloseTo(4.35);
    expect(south).toBeCloseTo(51.84);
    expect(east).toBeCloseTo(5.25);
    expect(north).toBeCloseTo(52.45);
    expect(map.fitBounds.mock.calls[0][1]).toEqual(expect.objectContaining({ maxZoom: 9.5 }));
    fixture.destroy();
  });

  it.each([DISTANT_PLACE, ROTTERDAM_PLACE, UTRECHT_PLACE])(
    'focuses the selected $cityId marker without recreating the map',
    async (place) => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.componentRef.setInput('places', [place]);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const map = await waitForMap();
    map.emit('load');
    fixture.detectChanges();
    await fixture.whenStable();
    map.flyTo.mockClear();

    component.placeSelected.subscribe((placeId) => {
      fixture.componentRef.setInput('selectedPlaceId', placeId);
    });
    map.emit('click', 'hopon-place-points', {
      features: [{ properties: { placeId: place.id } }],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(map.flyTo).toHaveBeenCalledOnce();
    expect(map.flyTo).toHaveBeenCalledWith({
      center: [place.longitude, place.latitude],
      zoom: 14,
      duration: 450,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    expect(map.getSource('hopon-places')?.data).toMatchObject({
      features: [{ id: place.id, properties: { selected: true } }],
    });
    expect(mockMapState.instances).toHaveLength(1);

    fixture.componentRef.setInput('selectedPlaceId', place.id);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(map.flyTo).toHaveBeenCalledOnce();
    fixture.destroy();
    },
  );

  it('focuses the latest selection when it arrives before the map style loads', async () => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.componentRef.setInput('places', [PLACE]);
    fixture.detectChanges();
    const map = await waitForMap();

    fixture.componentRef.setInput('places', [ROTTERDAM_PLACE]);
    fixture.componentRef.setInput('selectedPlaceId', ROTTERDAM_PLACE.id);
    fixture.detectChanges();
    map.emit('load');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockMapState.instances).toHaveLength(1);
    expect(map.flyTo).toHaveBeenCalledOnce();
    expect(map.flyTo).toHaveBeenCalledWith({
      center: [ROTTERDAM_PLACE.longitude, ROTTERDAM_PLACE.latitude],
      zoom: 14,
      duration: 450,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    fixture.destroy();
  });

  it('cancels the previous camera movement when selection changes across cities', async () => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.componentRef.setInput('places', [PLACE, ROTTERDAM_PLACE, UTRECHT_PLACE]);
    fixture.detectChanges();
    const map = await waitForMap();
    map.emit('load');
    fixture.detectChanges();
    await fixture.whenStable();
    map.stop.mockClear();
    map.flyTo.mockClear();

    fixture.componentRef.setInput('selectedPlaceId', PLACE.id);
    fixture.detectChanges();
    fixture.componentRef.setInput('selectedPlaceId', UTRECHT_PLACE.id);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockMapState.instances).toHaveLength(1);
    expect(map.stop).toHaveBeenCalledTimes(2);
    expect(map.flyTo).toHaveBeenCalledTimes(2);
    expect(map.stop.mock.invocationCallOrder[1]).toBeLessThan(map.flyTo.mock.invocationCallOrder[1]);
    expect(map.flyTo).toHaveBeenLastCalledWith({
      center: [UTRECHT_PLACE.longitude, UTRECHT_PLACE.latitude],
      zoom: 14,
      duration: 450,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    fixture.destroy();
  });

  it('stops a pending focus when the selected place is filtered out', async () => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.componentRef.setInput('places', [PLACE]);
    fixture.detectChanges();
    const map = await waitForMap();
    map.emit('load');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentRef.setInput('selectedPlaceId', PLACE.id);
    fixture.detectChanges();
    await fixture.whenStable();
    map.stop.mockClear();
    map.flyTo.mockClear();

    fixture.componentRef.setInput('places', []);
    fixture.detectChanges();

    expect(map.stop).toHaveBeenCalledOnce();
    expect(map.flyTo).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('uses zero-duration focus when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
    })));
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.componentRef.setInput('places', [PLACE]);
    fixture.detectChanges();
    const map = await waitForMap();
    map.emit('load');
    fixture.detectChanges();
    await fixture.whenStable();
    map.flyTo.mockClear();

    fixture.componentRef.setInput('selectedPlaceId', PLACE.id);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [PLACE.longitude, PLACE.latitude],
      duration: 0,
    }));
    fixture.destroy();
  });

  it('offsets focus above the visible mobile detail sheet', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 760px)',
    })));
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.componentRef.setInput('places', [PLACE]);
    fixture.detectChanges();
    const mapHost = fixture.nativeElement.querySelector('.map-viewport__canvas') as HTMLElement;
    vi.spyOn(mapHost, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 400));
    const panel = document.createElement('aside');
    panel.className = 'place-detail';
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 180, 400, 220));
    fixture.nativeElement.append(panel);

    const map = await waitForMap();
    map.emit('load');
    fixture.detectChanges();
    await fixture.whenStable();
    map.flyTo.mockClear();

    fixture.componentRef.setInput('selectedPlaceId', PLACE.id);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [PLACE.longitude, PLACE.latitude],
      padding: { top: 0, right: 0, bottom: 220, left: 0 },
    }));
    fixture.destroy();
  });

  it('selects a point and expands a clicked cluster', async () => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.componentRef.setInput('places', [PLACE]);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const selection = vi.fn();
    component.placeSelected.subscribe(selection);
    const map = await waitForMap();
    map.emit('load');

    map.emit('click', 'hopon-place-points', {
      features: [{ properties: { placeId: PLACE.id } }],
    });
    expect(selection).toHaveBeenCalledWith(PLACE.id);

    map.emit('click', 'hopon-place-clusters', {
      features: [{ properties: { cluster_id: 42 } }],
      lngLat: { lng: 4.9, lat: 52.37 },
    });
    await Promise.resolve();
    expect(map.getSource('hopon-places')?.getClusterExpansionZoom).toHaveBeenCalledWith(42);
    expect(map.easeTo).toHaveBeenCalledWith({
      center: { lng: 4.9, lat: 52.37 },
      zoom: 15,
      duration: 350,
    });
    fixture.destroy();
  });

  it('keeps a loaded map usable after transient errors and a failed cluster expansion', async () => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.componentRef.setInput('places', [PLACE]);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const map = await waitForMap();
    map.emit('load');

    map.emit('error', undefined, {
      error: new Error('Raster tile request failed with HTTP 503'),
      sourceId: 'openfreemap-base',
      sourceDataType: 'content',
    });
    expect(component.mapReady()).toBe(true);
    expect(component.mapUnavailable()).toBe(false);

    const source = map.getSource('hopon-places')!;
    source.getClusterExpansionZoom.mockRejectedValueOnce(new Error('Cluster is no longer available'));
    map.emit('click', 'hopon-place-clusters', {
      features: [{ properties: { cluster_id: 42 } }],
      lngLat: { lng: 4.9, lat: 52.37 },
    });
    await vi.waitFor(() => expect(source.getClusterExpansionZoom).toHaveBeenCalledOnce());
    await Promise.resolve();
    await Promise.resolve();

    expect(component.mapReady()).toBe(true);
    expect(component.mapUnavailable()).toBe(false);
    expect(map.easeTo).not.toHaveBeenCalled();

    source.getClusterExpansionZoom.mockResolvedValueOnce(16);
    map.emit('click', 'hopon-place-clusters', {
      features: [{ properties: { cluster_id: 43 } }],
      lngLat: { lng: 4.91, lat: 52.36 },
    });
    await vi.waitFor(() => expect(map.easeTo).toHaveBeenCalledOnce());
    expect(map.easeTo).toHaveBeenCalledWith({
      center: { lng: 4.91, lat: 52.36 },
      zoom: 16,
      duration: 350,
    });
    fixture.destroy();
  });

  it('falls back when the critical style never finishes loading and when WebGL is lost', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const map = await waitForMap();

    expect(component.mapUnavailable()).toBe(false);
    await vi.advanceTimersByTimeAsync(12_000);
    fixture.detectChanges();
    expect(component.mapUnavailable()).toBe(true);
    expect(map.remove).toHaveBeenCalledOnce();
    expect(map.handlers).toHaveLength(0);
    fixture.destroy();

    vi.useRealTimers();
    mockMapState.instances.length = 0;
    const webGlFixture = TestBed.createComponent(MapViewportComponent);
    webGlFixture.componentRef.setInput('cities', CITIES);
    webGlFixture.detectChanges();
    const webGlComponent = webGlFixture.componentInstance;
    const webGlMap = await waitForMap();
    webGlMap.emit('load');
    webGlMap.dispatchCanvas('webglcontextlost');
    webGlFixture.detectChanges();

    expect(webGlComponent.mapUnavailable()).toBe(true);
    expect(webGlMap.remove).toHaveBeenCalledOnce();
    webGlFixture.destroy();
  });

  it('recreates the map on retry and ignores callbacks from the failed generation', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const failedMap = await waitForMap();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(component.mapUnavailable()).toBe(true);

    component.retry();
    await vi.waitFor(() => expect(mockMapState.instances).toHaveLength(2));
    const retriedMap = mockMapState.instances[1] as MockMap;
    expect(failedMap.remove).toHaveBeenCalledOnce();
    expect(component.mapUnavailable()).toBe(false);

    failedMap.emit('load');
    failedMap.dispatchCanvas('webglcontextlost');
    expect(component.mapUnavailable()).toBe(false);

    retriedMap.emit('load');
    expect(component.mapReady()).toBe(true);
    fixture.destroy();
    expect(retriedMap.remove).toHaveBeenCalledOnce();
  });

  it('removes listeners and ignores late map events when destroyed during style loading', async () => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const map = await waitForMap();

    fixture.destroy();
    map.emit('load');
    map.dispatchCanvas('webglcontextlost');

    expect(map.remove).toHaveBeenCalledOnce();
    expect(map.handlers).toHaveLength(0);
    expect(component.mapReady()).toBe(false);
    expect(component.mapUnavailable()).toBe(false);
  });

  it('shows a bounded map fallback while the place list stays available', async () => {
    mockMapState.throwOnCreate = true;
    const fixture = TestBed.createComponent(MapWithPlaceListHost);
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.querySelector('.map-viewport__fallback')).toBeTruthy(),
    );

    expect(fixture.nativeElement.querySelector('.map-viewport__fallback')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.map-viewport__loading')).toBeNull();
    expect(fixture.nativeElement.querySelector('.place-name')?.textContent).toContain('A place');
    fixture.destroy();
  });

  it('offers only reconnect and restores the map through that button', async () => {
    mockMapState.throwOnCreate = true;
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('cities', CITIES);
    fixture.componentRef.setInput('places', [PLACE]);
    fixture.detectChanges();

    const button = await vi.waitFor(() => {
      const fallbackButton = fixture.nativeElement.querySelector(
        '.map-viewport__fallback-actions button.button--primary',
      ) as HTMLButtonElement | null;
      expect(fallbackButton).not.toBeNull();
      return fallbackButton as HTMLButtonElement;
    });
    expect(fixture.nativeElement.querySelectorAll('.map-viewport__fallback-actions button')).toHaveLength(1);
    mockMapState.throwOnCreate = false;
    button.click();
    fixture.detectChanges();
    const map = await waitForMap();
    map.emit('load');
    fixture.detectChanges();
    expect(fixture.componentInstance.mapReady()).toBe(true);
    expect(fixture.nativeElement.querySelector('.map-viewport__fallback')).toBeNull();
    fixture.destroy();
  });
});
