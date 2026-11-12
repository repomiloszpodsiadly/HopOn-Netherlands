import attributionManifest from '../../../../public/assets/catalog/assets-attribution.json';
import type { CityId } from '../../core/models/catalog.models';

export type PlaceImageAttribution = Readonly<(typeof attributionManifest.attributions)[number]>;

const PLACE_IMAGE_ATTRIBUTIONS: ReadonlyMap<string, PlaceImageAttribution> = new Map(
  attributionManifest.attributions.map((attribution) => [attribution.id, attribution]),
);

const FEATURED_IMAGE_BY_CITY: ReadonlyMap<CityId, PlaceImageAttribution> = new Map(
  attributionManifest.attributions.map((attribution) => [attribution.cityId as CityId, attribution]),
);

export function getPlaceImageAttribution(id: string | null): PlaceImageAttribution | null {
  return id === null ? null : PLACE_IMAGE_ATTRIBUTIONS.get(id) ?? null;
}

export function getFeaturedPlaceImage(cityId: CityId): PlaceImageAttribution | null {
  return FEATURED_IMAGE_BY_CITY.get(cityId) ?? null;
}
