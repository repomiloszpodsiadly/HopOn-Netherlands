import { MobilityHubDto, PlaceDto } from '../../core/models/catalog.models';

const EARTH_RADIUS_METERS = 6_371_008.8;
const NEARBY_RADIUS_METERS = 1_500;
const MAX_NEARBY_HUBS = 3;

export type NearbyHub = Readonly<{
  hub: MobilityHubDto;
  distanceMeters: number;
}>;

export function haversineMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (latitudeB - latitudeA) * radians;
  const longitudeDelta = (longitudeB - longitudeA) * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA * radians)
      * Math.cos(latitudeB * radians)
      * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function nearbyHubsForPlace(
  place: PlaceDto,
  hubs: readonly MobilityHubDto[],
): readonly NearbyHub[] {
  return hubs
    .filter((hub) => hub.cityId === place.cityId)
    .map((hub) => ({
      hub,
      distanceMeters: haversineMeters(
        place.latitude,
        place.longitude,
        hub.latitude,
        hub.longitude,
      ),
    }))
    .filter((nearby) => nearby.distanceMeters <= NEARBY_RADIUS_METERS)
    .sort((left, right) =>
      left.distanceMeters - right.distanceMeters || left.hub.id.localeCompare(right.hub.id),
    )
    .slice(0, MAX_NEARBY_HUBS);
}

export function formatApproximateDistance(distanceMeters: number): string {
  if (distanceMeters < 1_000) {
    return `${Math.round(distanceMeters)} m`;
  }
  return `${(distanceMeters / 1_000).toFixed(1)} km`;
}
