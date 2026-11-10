import { CityId } from './catalog.models';

export type DraftPlan = Readonly<{
  schemaVersion: 1;
  cityId: CityId;
  name: string;
  placeIds: readonly string[];
  updatedAt: string;
}>;

export type DraftAddResult =
  | Readonly<{ status: 'added'; addedCount: number; alreadyPresentCount: number }>
  | Readonly<{ status: 'already-added' }>
  | Readonly<{ status: 'city-conflict' }>
  | Readonly<{ status: 'validation-pending' }>
  | Readonly<{ status: 'no-verified-places' }>;

export type DraftCityConflict = Readonly<{
  cityId: CityId;
  cityName: string;
  placeIds: readonly string[];
}>;
