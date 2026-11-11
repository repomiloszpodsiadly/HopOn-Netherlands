import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  signal,
} from '@angular/core';
import { PlaceDto } from '../../core/models/catalog.models';
import { NearbyHub, formatApproximateDistance } from './nearby-hubs';
import { getPlaceImageAttribution, type PlaceImageAttribution } from './place-image-attribution';

export type AddPlaceEvent = Readonly<{
  placeId: string;
  trigger: EventTarget | null;
}>;

@Component({
  selector: 'app-place-detail',
  templateUrl: './place-detail.html',
  styleUrl: './place-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceDetailComponent implements OnChanges {
  @Input({ required: true }) place!: PlaceDto;
  @Input({ required: true }) cityName!: string;
  @Input({ required: true }) categoryLabel!: string;
  @Input() nearbyHubs: readonly NearbyHub[] = [];
  @Input() hubsLoading = false;
  @Input() hubsError: string | null = null;
  @Input() draftContainsPlace = false;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly addPlace = new EventEmitter<AddPlaceEvent>();
  @Output() readonly retryHubs = new EventEmitter<void>();

  @ViewChild('heading') private readonly heading?: ElementRef<HTMLElement>;
  readonly failedImage = signal(false);
  readonly imageSizes = '(max-width: 900px) calc(100vw - 46px), 348px';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['place']) {
      this.failedImage.set(false);
    }
  }

  focusHeading(): void {
    this.heading?.nativeElement.focus();
  }

  isLicensedLocalImage(): boolean {
    const path = this.place.imagePath;
    const attributionId = this.place.imageAttributionId;
    return path !== null
      && attributionId !== null
      && getPlaceImageAttribution(attributionId) !== null
      && !this.failedImage()
      && path === `/assets/catalog/${attributionId}.jpg`;
  }

  imageAttribution(): PlaceImageAttribution | null {
    return this.isLicensedLocalImage()
      ? getPlaceImageAttribution(this.place.imageAttributionId)
      : null;
  }

  responsiveImageSrcSet(): string | null {
    if (!this.isLicensedLocalImage() || this.place.imagePath === null) {
      return null;
    }

    const smallImagePath = this.place.imagePath.replace(/\.jpg$/, '-640.jpg');
    return `${smallImagePath} 640w, ${this.place.imagePath} 1280w`;
  }

  onImageError(): void {
    this.failedImage.set(true);
  }

  formatDistance(distanceMeters: number): string {
    return formatApproximateDistance(distanceMeters);
  }

  formatModes(modes: readonly string[]): string {
    return modes.map((mode) => mode.charAt(0) + mode.slice(1).toLowerCase()).join(' · ');
  }

  openStreetMapSource(source: string): string | null {
    try {
      const url = new URL(source);
      return (url.protocol === 'https:' || url.protocol === 'http:')
        && (url.hostname === 'openstreetmap.org' || url.hostname.endsWith('.openstreetmap.org'))
        ? url.href
        : null;
    } catch {
      return null;
    }
  }

  requestAdd(event: Event): void {
    this.addPlace.emit({ placeId: this.place.id, trigger: event.currentTarget });
  }
}
