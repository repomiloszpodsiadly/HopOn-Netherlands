import { CITY_IDS, CityId } from '../../core/models/catalog.models';

type CityResourceStatus = 'loading' | 'success' | 'empty' | 'error';

export type CityResourceState<T> = Readonly<{
  status: CityResourceStatus;
  data: readonly T[] | null;
  error: string | null;
}>;

export function initialCityResourceStates<T>(): Record<CityId, CityResourceState<T>> {
  return Object.fromEntries(CITY_IDS.map((cityId) => [cityId, {
    status: 'loading',
    data: null,
    error: null,
  }])) as Record<CityId, CityResourceState<T>>;
}
