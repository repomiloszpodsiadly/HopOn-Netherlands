import { CITY_IDS, CITY_LABELS, CityId, DiscoverDto, DiscoverTheme, PlaceDto } from '../../core/models/catalog.models';

type CityResourceStatus = 'loading' | 'success' | 'empty' | 'error';

export type CityResourceState<T> = Readonly<{
  status: CityResourceStatus;
  data: readonly T[] | null;
  error: string | null;
}>;

export type DiscoverRequest = Readonly<{ theme: DiscoverTheme; requestId: number }>;

export type DiscoverCityGroup = Readonly<{
  cityId: CityId;
  status: 'loading' | 'success' | 'empty' | 'error';
  description: string | null;
  placeIds: readonly string[];
  error: string | null;
}>;

export type DiscoverCityOutcome = Readonly<{
  request: DiscoverRequest;
  cityId: CityId;
  response: DiscoverDto | null;
  error: string | null;
}>;

export function initialCityResourceStates<T>(): Record<CityId, CityResourceState<T>> {
  return Object.fromEntries(CITY_IDS.map((cityId) => [cityId, {
    status: 'loading',
    data: null,
    error: null,
  }])) as Record<CityId, CityResourceState<T>>;
}

export function createDiscoverCityGroup(
  outcome: DiscoverCityOutcome,
  cityState: CityResourceState<PlaceDto>,
): DiscoverCityGroup {
  const { cityId, request, response } = outcome;
  if (outcome.error !== null || response === null) {
    return {
      cityId,
      status: 'error',
      description: null,
      placeIds: [],
      error: outcome.error ?? `Could not load ${CITY_LABELS[cityId]} picks.`,
    };
  }
  if (cityState.data === null) {
    return {
      cityId,
      status: 'error',
      description: null,
      placeIds: [],
      error: `Could not verify ${CITY_LABELS[cityId]} picks because its place catalog is unavailable.`,
    };
  }
  if (response.cityId !== cityId || response.theme !== request.theme) {
    return {
      cityId,
      status: 'error',
      description: null,
      placeIds: [],
      error: 'The discovery reply did not match this city and theme.',
    };
  }

  const cityPlaceIds = new Set(cityState.data.map((place) => place.id));
  const placeIds = [...new Set(Array.isArray(response.placeIds) ? response.placeIds : [])]
    .filter((placeId): placeId is string => typeof placeId === 'string')
    .filter((placeId) => cityPlaceIds.has(placeId))
    .slice(0, 5);
  const hasUnverifiedPicks = (response.placeIds?.length ?? 0) > 0 && placeIds.length === 0;
  return {
    cityId,
    status: hasUnverifiedPicks ? 'error' : placeIds.length > 0 ? 'success' : 'empty',
    description: hasUnverifiedPicks ? null : response.description,
    placeIds: hasUnverifiedPicks ? [] : placeIds,
    error: hasUnverifiedPicks ? `Could not verify the ${CITY_LABELS[cityId]} picks against its place catalog.` : null,
  };
}

export function summarizeDiscoverGroups(groups: readonly DiscoverCityGroup[]): Readonly<{
  placeIds: readonly string[];
  warning: string | null;
  error: string | null;
  state: 'loading' | 'loaded' | 'error';
}> {
  const failedGroups = groups.filter((cityGroup) => cityGroup.status === 'error');
  const resolvedGroups = groups.filter((cityGroup) => cityGroup.status === 'success' || cityGroup.status === 'empty');
  const stillLoading = groups.some((cityGroup) => cityGroup.status === 'loading');
  return {
    placeIds: groups.flatMap((cityGroup) => cityGroup.placeIds),
    warning: failedGroups.length > 0
      ? `Could not load or verify picks for ${failedGroups.map((cityGroup) => CITY_LABELS[cityGroup.cityId]).join(', ')}.`
      : null,
    error: !stillLoading && resolvedGroups.length === 0
      ? failedGroups.map((cityGroup) => cityGroup.error).filter((error): error is string => error !== null).join(' ')
      : null,
    state: stillLoading ? 'loading' : resolvedGroups.length > 0 ? 'loaded' : 'error',
  };
}
