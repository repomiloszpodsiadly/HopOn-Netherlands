import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, signal } from '@angular/core';
import { FeatureCollection, Point } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import { CityDto, PlaceDto } from '../../core/models/catalog.models';

const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const PLACES_SOURCE_ID = 'hopon-places';
const CLUSTERS_LAYER_ID = 'hopon-place-clusters';
const CLUSTER_COUNT_LAYER_ID = 'hopon-cluster-count';
const PLACE_POINTS_LAYER_ID = 'hopon-place-points';
const MAP_LOAD_TIMEOUT_MS = 12_000;

type PlaceFeatureProperties = Readonly<{
  placeId: string;
  name: string;
  category: string;
  selected: boolean;
  discover: boolean;
}>;

type PlaceFeatureCollection = FeatureCollection<Point, PlaceFeatureProperties>;

@Component({
  selector: 'app-map-viewport',
  templateUrl: './map-viewport.html',
  styleUrl: './map-viewport.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapViewportComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) city!: CityDto;
  @Input() places: readonly PlaceDto[] = [];
  @Input() selectedPlaceId: string | null = null;
  @Input() discoverPlaceIds: readonly string[] = [];
  @Output() readonly placeSelected = new EventEmitter<string>();
  @Output() readonly browsePlaces = new EventEmitter<void>();
  @ViewChild('mapHost', { static: true }) private readonly mapHost!: ElementRef<HTMLElement>;

  readonly mapReady = signal(false);
  readonly mapUnavailable = signal(false);

  private map: MapLibreMap | null = null;
  private mapLoadTimeout: ReturnType<typeof setTimeout> | null = null;
  private mapGeneration = 0;
  private destroyed = false;

  ngAfterViewInit(): void {
    this.createMap();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.map === null) {
      return;
    }
    if (changes['city'] && this.mapReady()) {
      this.moveToCity();
    }
    if ((changes['places'] || changes['selectedPlaceId'] || changes['discoverPlaceIds']) && this.mapReady()) {
      this.updatePlacesSource();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disposeMap();
  }

  retry(): void {
    this.disposeMap();
    this.mapReady.set(false);
    this.mapUnavailable.set(false);
    this.createMap();
  }

  focusMap(): void {
    this.mapHost.nativeElement.focus();
  }

  private async createMap(): Promise<void> {
    if (this.map !== null || this.city === undefined || this.destroyed) {
      return;
    }

    const generation = ++this.mapGeneration;
    this.mapLoadTimeout = setTimeout(() => {
      if (generation === this.mapGeneration && !this.mapReady()) {
        this.markUnavailable();
      }
    }, MAP_LOAD_TIMEOUT_MS);

    try {
      const maplibre = await import('maplibre-gl');
      if (generation !== this.mapGeneration || this.destroyed || this.mapUnavailable()) {
        return;
      }

      maplibre.setWorkerUrl(
        new URL(`maplibre-gl-worker.mjs?v=${maplibre.getVersion()}`, document.baseURI).toString(),
      );
      const map = new maplibre.Map({
        container: this.mapHost.nativeElement,
        style: OPENFREEMAP_STYLE,
        center: [this.city.center.longitude, this.city.center.latitude],
        zoom: this.city.defaultZoom,
        attributionControl: { compact: false },
      });
      this.map = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => this.onMapLoaded(map));
      map.on('error', () => this.markUnavailable());
    } catch {
      if (generation === this.mapGeneration && !this.destroyed) {
        this.markUnavailable();
      }
    }
  }

  private onMapLoaded(map: MapLibreMap): void {
    if (this.map !== map || this.mapUnavailable()) {
      return;
    }
    this.clearMapLoadTimeout();
    try {
      map.addSource(PLACES_SOURCE_ID, {
        type: 'geojson',
        data: this.toFeatureCollection(),
        cluster: true,
        clusterRadius: 48,
        clusterMaxZoom: 13,
        promoteId: 'placeId',
      });
      map.addLayer({
        id: CLUSTERS_LAYER_ID,
        type: 'circle',
        source: PLACES_SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#2b7774', 30, '#276964', 100, '#202a2b'],
          'circle-radius': ['step', ['get', 'point_count'], 18, 30, 23, 100, 29],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: CLUSTER_COUNT_LAYER_ID,
        type: 'symbol',
        source: PLACES_SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.addLayer({
        id: PLACE_POINTS_LAYER_ID,
        type: 'circle',
        source: PLACES_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['case', ['get', 'selected'], '#d96843', ['get', 'discover'], '#d49a42', '#2b7774'],
          'circle-radius': ['case', ['get', 'selected'], 9, ['get', 'discover'], 7, 6],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.5],
        },
      });
      this.registerMapEvents(map);
      this.mapReady.set(true);
      this.moveToCity();
    } catch {
      this.markUnavailable();
    }
  }

  private registerMapEvents(map: MapLibreMap): void {
    map.on('click', CLUSTERS_LAYER_ID, (event: MapLayerMouseEvent) => {
      const clusterId = event.features?.[0]?.properties?.['cluster_id'];
      const source = map.getSource(PLACES_SOURCE_ID) as GeoJSONSource | undefined;
      if (typeof clusterId !== 'number' || !source) {
        return;
      }
      void source
        .getClusterExpansionZoom(clusterId)
        .then((zoom) => map.easeTo({ center: event.lngLat, zoom, duration: 350 }))
        .catch(() => this.markUnavailable());
    });
    map.on('click', PLACE_POINTS_LAYER_ID, (event: MapLayerMouseEvent) => {
      const placeId = event.features?.[0]?.properties?.['placeId'];
      if (typeof placeId === 'string') {
        this.placeSelected.emit(placeId);
      }
    });
    map.on('mouseenter', PLACE_POINTS_LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', PLACE_POINTS_LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
    });
  }

  private moveToCity(): void {
    if (this.map === null) {
      return;
    }
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.map.flyTo({
      center: [this.city.center.longitude, this.city.center.latitude],
      zoom: this.city.defaultZoom,
      duration: reducedMotion ? 0 : 650,
    });
  }

  private updatePlacesSource(): void {
    const source = this.map?.getSource(PLACES_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(this.toFeatureCollection());
  }

  private toFeatureCollection(): PlaceFeatureCollection {
    return {
      type: 'FeatureCollection',
      features: this.places.map((place) => ({
        type: 'Feature',
        id: place.id,
        properties: {
          placeId: place.id,
          name: place.name,
          category: place.category,
          selected: place.id === this.selectedPlaceId,
          discover: this.discoverPlaceIds.includes(place.id),
        },
        geometry: {
          type: 'Point',
          coordinates: [place.longitude, place.latitude],
        },
      })),
    };
  }

  private markUnavailable(): void {
    this.clearMapLoadTimeout();
    this.mapReady.set(false);
    this.mapUnavailable.set(true);
  }

  private disposeMap(): void {
    this.mapGeneration += 1;
    this.clearMapLoadTimeout();
    this.map?.remove();
    this.map = null;
    this.mapReady.set(false);
  }

  private clearMapLoadTimeout(): void {
    if (this.mapLoadTimeout !== null) {
      clearTimeout(this.mapLoadTimeout);
      this.mapLoadTimeout = null;
    }
  }
}
