import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, signal } from '@angular/core';
import type { CityId, PlaceCategory, PlaceDto } from '../../core/models/catalog.models';
import { CategoryIconComponent } from '../shared/category-icon';
import { PointerLightDirective } from '../shared/pointer-light';
import { getFeaturedPlaceImage, getPlaceImageAttribution, type PlaceImageAttribution } from './place-image-attribution';

const CITY_LABELS: Readonly<Record<CityId, string>> = {
  amsterdam: 'Amsterdam',
  rotterdam: 'Rotterdam',
  utrecht: 'Utrecht',
};

export type PlaceResultsView = Readonly<{
  cityName: string;
  loading: boolean;
  error: string | null;
  count: number;
  activeFilters: boolean;
  places: readonly PlaceDto[];
  selectedPlaceId: string | null;
  discoverPlaceIds: readonly string[];
  categoryLabels: Readonly<Record<PlaceCategory, string>>;
  hasMore: boolean;
  remainingCount: number;
}>;

export type PlaceSelectionRequest = Readonly<{
  placeId: string;
  trigger: EventTarget | null;
}>;

@Component({
  selector: 'app-place-results-list',
  imports: [CategoryIconComponent, PointerLightDirective],
  templateUrl: './place-results-list.html',
  styleUrl: './place-results-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceResultsListComponent {
  @Input({ required: true }) view!: PlaceResultsView;
  @Output() readonly placeSelected = new EventEmitter<PlaceSelectionRequest>();
  @Output() readonly retryRequested = new EventEmitter<void>();
  @Output() readonly clearFiltersRequested = new EventEmitter<void>();
  @Output() readonly showMoreRequested = new EventEmitter<void>();

  private readonly failedFeaturedImages = signal<ReadonlySet<string>>(new Set());

  cityName(cityId: CityId): string {
    return CITY_LABELS[cityId];
  }

  featuredImageAttribution(place: PlaceDto): PlaceImageAttribution | null {
    const attribution = getPlaceImageAttribution(place.imageAttributionId);
    const featured = getFeaturedPlaceImage(place.cityId);
    return attribution !== null
      && featured?.id === attribution.id
      && attribution.placeId === place.id
      && attribution.imagePath === place.imagePath
      && !this.failedFeaturedImages().has(place.id)
      ? attribution
      : null;
  }

  featuredImageSrcSet(attribution: PlaceImageAttribution): string | null {
    return attribution.responsiveImagePaths.length === 2
      ? `${attribution.responsiveImagePaths[0]} 640w, ${attribution.responsiveImagePaths[1]} 1280w`
      : null;
  }

  onFeaturedImageError(placeId: string): void {
    this.failedFeaturedImages.update((failed) => new Set([...failed, placeId]));
  }

  displayTag(tag: string): string {
    return tag.replaceAll('_', ' ');
  }
}
