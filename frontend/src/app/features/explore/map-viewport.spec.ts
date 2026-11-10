import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CityDto, PlaceDto } from '../../core/models/catalog.models';
import { MapViewportComponent } from './map-viewport';

interface MockEvent {
  features?: readonly Readonly<{ properties?: Readonly<Record<string, unknown>> }>[];
  lngLat?: Readonly<{ lng: number; lat: number }>;
}

type MockHandler = (event?: MockEvent) => void;

interface MockSource {
  data: unknown;
  setData: ReturnType<typeof vi.fn>;
  getClusterExpansionZoom: ReturnType<typeof vi.fn>;
}

interface MockMap {
  options: Readonly<Record<string, unknown>>;
  handlers: { event: string; layer?: string; handler: MockHandler }[];
  sources: Record<string, MockSource>;
  layers: unknown[];
  addControl: ReturnType<typeof vi.fn>;
  addLayer: (layer: unknown) => void;
  addSource: (id: string, definition: unknown) => void;
  getSource: (id: string) => MockSource | undefined;
  getCanvas: () => { style: { cursor: string } };
  flyTo: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  emit: (event: string, layer?: string, payload?: MockEvent) => void;
}

const mockMapState = vi.hoisted(() => ({ instances: [] as unknown[], throwOnCreate: false }));

vi.mock('maplibre-gl', () => {
  class FakeMap {
    readonly options: Readonly<Record<string, unknown>>;
    readonly handlers: { event: string; layer?: string; handler: MockHandler }[] = [];
    readonly sources: Record<string, MockSource> = {};
    readonly layers: unknown[] = [];
    readonly addControl = vi.fn();
    readonly flyTo = vi.fn();
    readonly easeTo = vi.fn();
    readonly remove = vi.fn(() => {
      this.handlers.length = 0;
    });
    private readonly canvas = { style: { cursor: '' } };

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

    getCanvas(): { style: { cursor: string } } {
      return this.canvas;
    }

    on(event: string, layerOrHandler: string | MockHandler, handler?: MockHandler): void {
      this.handlers.push(
        typeof layerOrHandler === 'string'
          ? { event, layer: layerOrHandler, handler: handler! }
          : { event, handler: layerOrHandler },
      );
    }

    emit(event: string, layer?: string, payload: MockEvent = {}): void {
      this.handlers
        .filter((entry) => entry.event === event && entry.layer === layer)
        .forEach((entry) => entry.handler(payload));
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

@Component({
  standalone: true,
  imports: [MapViewportComponent],
  template: `
    <app-map-viewport [city]="city" [places]="places" />
    <ul><li class="place-name">{{ places[0]?.name }}</li></ul>
  `,
})
class MapWithPlaceListHost {
  readonly city = CITY;
  readonly places = [PLACE];
}

describe('MapViewportComponent', () => {
  beforeEach(() => {
    mockMapState.instances.length = 0;
    mockMapState.throwOnCreate = false;
    TestBed.configureTestingModule({ imports: [MapViewportComponent, MapWithPlaceListHost] });
  });

  async function waitForMap(): Promise<MockMap> {
    await vi.waitFor(() => expect(mockMapState.instances).toHaveLength(1));
    return mockMapState.instances[0] as MockMap;
  }

  it('creates one map, updates its GeoJSON source, and removes listeners on destroy', async () => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('city', CITY);
    fixture.componentRef.setInput('places', [PLACE]);
    fixture.detectChanges();

    const map = await waitForMap();
    expect(map.options['style']).toBe('https://tiles.openfreemap.org/styles/liberty');
    map.emit('load');
    fixture.detectChanges();

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
  });

  it('moves the existing map to the latest city after a delayed style load', async () => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('city', CITY);
    fixture.detectChanges();
    const map = await waitForMap();

    fixture.componentRef.setInput('city', ROTTERDAM);
    fixture.detectChanges();
    map.emit('load');

    expect(mockMapState.instances).toHaveLength(1);
    expect(map.flyTo).toHaveBeenCalledWith({
      center: [ROTTERDAM.center.longitude, ROTTERDAM.center.latitude],
      zoom: ROTTERDAM.defaultZoom,
      duration: expect.any(Number),
    });
    fixture.destroy();
  });

  it('selects a point and expands a clicked cluster', async () => {
    const fixture = TestBed.createComponent(MapViewportComponent);
    fixture.componentRef.setInput('city', CITY);
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
});
