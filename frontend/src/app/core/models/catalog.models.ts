export const CITY_IDS = ['amsterdam', 'rotterdam', 'utrecht'] as const;

export type CityId = (typeof CITY_IDS)[number];

export type PlaceCategory =
  | 'ARCHITECTURE'
  | 'MUSEUMS'
  | 'CULTURE'
  | 'PARKS_NATURE'
  | 'LANDMARKS';

export type DiscoverTheme = 'architecture' | 'culture' | 'green';

export type HubMode = 'TRAIN' | 'TRAM' | 'METRO' | 'BUS' | 'FERRY' | 'UNKNOWN';

export type Coordinates = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type CityDto = Readonly<{
  id: CityId;
  name: string;
  center: Coordinates;
  defaultZoom: number;
}>;

export type PlaceDto = Readonly<{
  id: string;
  cityId: CityId;
  name: string;
  category: PlaceCategory;
  latitude: number;
  longitude: number;
  tags: readonly string[];
  shortDescription: string;
  imagePath: string | null;
  imageAttributionId: string | null;
}>;

export type MobilityHubDto = Readonly<{
  id: string;
  cityId: CityId;
  name: string;
  latitude: number;
  longitude: number;
  modes: readonly HubMode[];
  source: string;
}>;

export type DiscoverDto = Readonly<{
  cityId: CityId;
  theme: DiscoverTheme;
  description: string;
  placeIds: readonly string[];
}>;

export type ProblemDetailDto = Readonly<{
  type?: string;
  title?: string;
  status: number;
  detail?: string;
  instance?: string;
}>;

export function isCityId(value: string | null | undefined): value is CityId {
  return value !== null && value !== undefined && CITY_IDS.some((cityId) => cityId === value);
}
