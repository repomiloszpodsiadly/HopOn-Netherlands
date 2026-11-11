import { CityId } from './catalog.models';

export type PlanUpsertRequest = Readonly<{
  name: string;
  cityId: CityId;
  placeIds: readonly string[];
}>;

export type PlanResponse = Readonly<{
  id: string;
  name: string;
  cityId: CityId;
  placeIds: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;
