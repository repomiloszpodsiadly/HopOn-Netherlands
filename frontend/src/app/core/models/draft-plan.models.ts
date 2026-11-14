import { CityId } from './catalog.models';

export type DraftPlan = Readonly<{
  schemaVersion: 1;
  cityId: CityId;
  name: string;
  description: string;
  placeIds: readonly string[];
  updatedAt: string;
  autosaveId?: string;
}>;

export type DraftAddResult =
  | Readonly<{ status: 'added'; addedCount: number; alreadyPresentCount: number }>
  | Readonly<{ status: 'already-added' }>
  | Readonly<{ status: 'limit-reached' }>
  | Readonly<{ status: 'validation-pending' }>
  | Readonly<{ status: 'no-verified-places' }>;
