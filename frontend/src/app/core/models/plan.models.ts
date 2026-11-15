import { CityId } from './catalog.models';

export const PLAN_NAME_MAX_LENGTH = 30;
export const PLAN_DESCRIPTION_MAX_LENGTH = 500;
export const MAX_SAVED_PLANS = 6;
export const MAX_PLAN_PLACES = 12;

/** A server-created plan may receive the first available numbered name. */
export function isAllocatedPlanName(requested: string, allocated: string): boolean {
  const base = requested.trim();
  if (allocated === base) return true;
  const ending = allocated.match(/-[1-9]\d*$/)?.[0];
  return ending !== undefined && allocated === base.slice(0, PLAN_NAME_MAX_LENGTH - ending.length) + ending;
}

export type PlanUpsertRequest = Readonly<{
  name: string;
  description: string;
  cityId: CityId;
  placeIds: readonly string[];
}>;

export type PlanResponse = Readonly<{
  id: string;
  name: string;
  description: string;
  cityId: CityId;
  placeIds: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;
