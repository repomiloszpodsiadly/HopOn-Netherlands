import {
  AfterViewInit,
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Injector,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  signal,
} from '@angular/core';
import { FeatureCollection, Point } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, PaddingOptions } from 'maplibre-gl';
import { CityDto, PlaceDto } from '../../core/models/catalog.models';

const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const PLACES_SOURCE_ID = 'hopon-places';
const CLUSTERS_LAYER_ID = 'hopon-place-clusters';
const CLUSTER_COUNT_LAYER_ID = 'hopon-cluster-count';
const PLACE_POINTS_LAYER_ID = 'hopon-place-points';
const MAP_LOAD_TIMEOUT_MS = 12_000;
const MIN_PLACE_FOCUS_ZOOM = 14;
const MAX_PLACE_FOCUS_ZOOM = 16;
const PLACE_FOCUS_DURATION_MS = 450;
const NO_MAP_PADDING: PaddingOptions = { top: 0, right: 0, bottom: 0, left: 0 };

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

  private readonly injector = inject(Injector);
  private map: MapLibreMap | null = null;
  private mapLoadTimeout: ReturnType<typeof setTimeout> | null = null;
  private mapCleanup: (() => void)[] = [];
  private mapGeneration = 0;
  private cameraOperation = 0;
  private destroyed = false;

  ngAfterViewInit(): void {
    this.createMap();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const map = this.map;
    if (map === null) {
      return;
    }

    const cityChanged = changes['city'] !== undefined;
    const selectionChanged = changes['selectedPlaceId'] !== undefined;
    const placesChanged = changes['places'] !== undefined
      || selectionChanged
      || changes['discoverPlaceIds'] !== undefined;
    const selectionInvalidated = placesChanged
      && this.selectedPlaceId !== null
      && this.currentSelectedPlace() === null;

    if (cityChanged || selectionChanged || selectionInvalidated) {
      this.cameraOperation += 1;
      map.stop();
    }

    if (placesChanged && this.mapReady()) {
      this.updatePlacesSource();
    }

    if (!this.mapReady()) {
      return;
    }
    if (cityChanged) {
      if (this.currentSelectedPlace() !== null) {
        this.scheduleSelectedPlaceFocus();
      } else {
        this.moveToCity();
      }
      return;
    }
    if (selectionChanged) {
      if (this.currentSelectedPlace() !== null) {
        this.scheduleSelectedPlaceFocus();
      } else {
        this.resetMapPadding(map);
      }
    } else if (selectionInvalidated) {
      this.resetMapPadding(map);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disposeMap();
  }

  retry(): void {
    if (this.destroyed) {
      return;
    }
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
        this.markUnavailable(undefined, generation);
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
      const onLoad = () => this.onMapLoaded(map, generation);
      map.on('load', onLoad);
      this.mapCleanup.push(() => map.off('load', onLoad));

      const canvas = map.getCanvas();
      const onWebGlContextLost = () => this.markUnavailable(map, generation);
      canvas.addEventListener('webglcontextlost', onWebGlContextLost);
      this.mapCleanup.push(() => canvas.removeEventListener('webglcontextlost', onWebGlContextLost));
      // MapLibre's error event also covers individual tiles, glyphs and sprites. Critical startup
      // failures are bounded by MAP_LOAD_TIMEOUT_MS; resource errors alone must not disable the map.
    } catch {
      if (generation === this.mapGeneration && !this.destroyed) {
        this.markUnavailable(undefined, generation);
      }
    }
  }

  private onMapLoaded(map: MapLibreMap, generation: number): void {
    if (!this.isCurrentMap(map, generation)) {
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
      this.registerMapEvents(map, generation);
      this.mapReady.set(true);
      if (this.currentSelectedPlace() !== null) {
        this.scheduleSelectedPlaceFocus();
      } else {
        this.moveToCity();
      }
    } catch {
      this.markUnavailable(map, generation);
    }
  }

  private registerMapEvents(map: MapLibreMap, generation: number): void {
    const onClusterClick = (event: MapLayerMouseEvent) => {
      if (!this.isCurrentMap(map, generation)) {
        return;
      }
      const clusterId = event.features?.[0]?.properties?.['cluster_id'];
      const source = map.getSource(PLACES_SOURCE_ID) as GeoJSONSource | undefined;
      if (typeof clusterId !== 'number' || !source) {
        return;
      }
      const cameraOperation = ++this.cameraOperation;
      map.stop();
      void source
        .getClusterExpansionZoom(clusterId)
        .then((zoom) => {
          if (this.isCurrentMap(map, generation) && cameraOperation === this.cameraOperation) {
            map.easeTo({
              center: event.lngLat,
              zoom,
              duration: this.prefersReducedMotion() ? 0 : 350,
            });
          }
        })
        .catch(() => undefined);
    };
    map.on('click', CLUSTERS_LAYER_ID, onClusterClick);
    this.mapCleanup.push(() => map.off('click', CLUSTERS_LAYER_ID, onClusterClick));

    const onPlaceClick = (event: MapLayerMouseEvent) => {
      if (!this.isCurrentMap(map, generation)) {
        return;
      }
      const placeId = event.features?.[0]?.properties?.['placeId'];
      if (typeof placeId === 'string') {
        this.placeSelected.emit(placeId);
      }
    };
    map.on('click', PLACE_POINTS_LAYER_ID, onPlaceClick);
    this.mapCleanup.push(() => map.off('click', PLACE_POINTS_LAYER_ID, onPlaceClick));

    const onPlaceMouseEnter = () => {
      if (!this.isCurrentMap(map, generation)) {
        return;
      }
      map.getCanvas().style.cursor = 'pointer';
    };
    map.on('mouseenter', PLACE_POINTS_LAYER_ID, onPlaceMouseEnter);
    this.mapCleanup.push(() => map.off('mouseenter', PLACE_POINTS_LAYER_ID, onPlaceMouseEnter));

    const onPlaceMouseLeave = () => {
      if (!this.isCurrentMap(map, generation)) {
        return;
      }
      map.getCanvas().style.cursor = '';
    };
    map.on('mouseleave', PLACE_POINTS_LAYER_ID, onPlaceMouseLeave);
    this.mapCleanup.push(() => map.off('mouseleave', PLACE_POINTS_LAYER_ID, onPlaceMouseLeave));
  }

  private moveToCity(): void {
    const map = this.map;
    if (map === null) {
      return;
    }
    this.cameraOperation += 1;
    map.stop();
    this.resetMapPadding(map);
    map.flyTo({
      center: [this.city.center.longitude, this.city.center.latitude],
      zoom: this.city.defaultZoom,
      duration: this.prefersReducedMotion() ? 0 : 650,
    });
  }

  private scheduleSelectedPlaceFocus(): void {
    const map = this.map;
    const placeId = this.selectedPlaceId;
    if (map === null || placeId === null) {
      return;
    }

    const generation = this.mapGeneration;
    const cameraOperation = ++this.cameraOperation;
    afterNextRender(() => {
      if (!this.isCurrentMap(map, generation) || cameraOperation !== this.cameraOperation) {
        return;
      }
      const place = this.currentSelectedPlace();
      if (place === null || place.id !== placeId) {
        return;
      }

      const zoom = Math.min(MAX_PLACE_FOCUS_ZOOM, Math.max(MIN_PLACE_FOCUS_ZOOM, map.getZoom()));
      const padding = this.selectedPlacePadding();
      this.resetMapPadding(map);
      map.flyTo({
        center: [place.longitude, place.latitude],
        zoom,
        duration: this.prefersReducedMotion() ? 0 : PLACE_FOCUS_DURATION_MS,
        padding,
      });
    }, { injector: this.injector });
  }

  private currentSelectedPlace(): PlaceDto | null {
    const placeId = this.selectedPlaceId;
    if (placeId === null) {
      return null;
    }
    return this.places.find((place) => place.id === placeId && place.cityId === this.city.id) ?? null;
  }

  private selectedPlacePadding(): PaddingOptions {
    const panel = document.querySelector<HTMLElement>('.place-detail');
    if (panel === null) {
      return NO_MAP_PADDING;
    }

    const mapBounds = this.mapHost.nativeElement.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    const overlapsMap = panelBounds.right > mapBounds.left
      && panelBounds.left < mapBounds.right
      && panelBounds.bottom > mapBounds.top
      && panelBounds.top < mapBounds.bottom;
    if (!overlapsMap || mapBounds.width <= 0 || mapBounds.height <= 0) {
      return NO_MAP_PADDING;
    }

    const mobileLayout = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 760px)').matches
      : window.innerWidth <= 760;
    if (mobileLayout) {
      const bottom = Math.min(
        mapBounds.bottom - Math.max(mapBounds.top, panelBounds.top),
        mapBounds.height * 0.75,
      );
      return { ...NO_MAP_PADDING, bottom: Math.max(0, bottom) };
    }

    const right = Math.min(
      mapBounds.right - Math.max(mapBounds.left, panelBounds.left),
      mapBounds.width * 0.48,
    );
    return { ...NO_MAP_PADDING, right: Math.max(0, right) };
  }

  private resetMapPadding(map: MapLibreMap): void {
    map.setPadding(NO_MAP_PADDING);
  }

  private prefersReducedMotion(): boolean {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  private markUnavailable(map?: MapLibreMap, generation?: number): void {
    if (this.destroyed || this.mapUnavailable()
      || (generation !== undefined && generation !== this.mapGeneration)
      || (map !== undefined && map !== this.map)) {
      return;
    }
    this.clearMapLoadTimeout();
    this.mapReady.set(false);
    this.mapUnavailable.set(true);
    this.disposeMap();
  }

  private isCurrentMap(map: MapLibreMap, generation: number): boolean {
    return !this.destroyed
      && !this.mapUnavailable()
      && this.map === map
      && this.mapGeneration === generation;
  }

  private disposeMap(): void {
    this.cameraOperation += 1;
    this.mapGeneration += 1;
    this.clearMapLoadTimeout();
    const map = this.map;
    this.map = null;
    this.mapReady.set(false);
    const cleanups = this.mapCleanup;
    this.mapCleanup = [];
    cleanups.forEach((cleanup) => cleanup());
    try {
      map?.remove();
    } catch {
      // A lost WebGL context may already have partially disposed the renderer.
    }
  }

  private clearMapLoadTimeout(): void {
    if (this.mapLoadTimeout !== null) {
      clearTimeout(this.mapLoadTimeout);
      this.mapLoadTimeout = null;
    }
  }
}
