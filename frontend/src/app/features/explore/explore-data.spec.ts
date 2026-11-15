import { PlaceDto } from '../../core/models/catalog.models';
import { createDiscoverCityGroup, DiscoverCityOutcome, summarizeDiscoverGroups } from './explore-data';

const places: readonly PlaceDto[] = Array.from({ length: 6 }, (_, index) => ({
  id: `place-${index}`,
  cityId: 'amsterdam',
  name: `Place ${index}`,
  category: 'CULTURE',
  latitude: 52.37,
  longitude: 4.9,
  tags: [],
  shortDescription: '',
  imagePath: null,
  imageAttributionId: null,
}));

function outcome(placeIds: readonly string[]): DiscoverCityOutcome {
  return {
    request: { theme: 'culture', requestId: 1 },
    cityId: 'amsterdam',
    response: { cityId: 'amsterdam', theme: 'culture', description: 'City picks', placeIds },
    error: null,
  };
}

describe('Discover data transformations', () => {
  it('verifies, deduplicates and caps picks without mutating the response or catalog', () => {
    const ids = Object.freeze(['place-2', 'unknown', 'place-2', 'place-0', 'place-5', 'place-1', 'place-4', 'place-3']);
    const result = createDiscoverCityGroup(outcome(ids), { status: 'success', data: places, error: null });

    expect(result).toEqual({
      cityId: 'amsterdam', status: 'success', description: 'City picks',
      placeIds: ['place-2', 'place-0', 'place-5', 'place-1', 'place-4'], error: null,
    });
    expect(ids).toEqual(['place-2', 'unknown', 'place-2', 'place-0', 'place-5', 'place-1', 'place-4', 'place-3']);
    expect(places.map((place) => place.id)).toEqual(['place-0', 'place-1', 'place-2', 'place-3', 'place-4', 'place-5']);
  });

  it('distinguishes an empty reply from picks that cannot be verified', () => {
    const catalog = { status: 'success', data: places, error: null } as const;
    expect(createDiscoverCityGroup(outcome([]), catalog).status).toBe('empty');
    expect(createDiscoverCityGroup(outcome(['unknown']), catalog)).toEqual({
      cityId: 'amsterdam', status: 'error', description: null, placeIds: [],
      error: 'Could not verify the Amsterdam picks against its place catalog.',
    });
  });

  it('keeps partial results while loading and reports complete failure only after all cities resolve', () => {
    const failed = createDiscoverCityGroup(outcome(['place-0']), { status: 'error', data: null, error: 'Unavailable' });
    const loading = { cityId: 'rotterdam', status: 'loading', description: null, placeIds: [], error: null } as const;
    expect(summarizeDiscoverGroups([failed, loading])).toEqual({
      placeIds: [], warning: 'Could not load or verify picks for Amsterdam.', error: null, state: 'loading',
    });
    expect(summarizeDiscoverGroups([failed])).toEqual({
      placeIds: [], warning: 'Could not load or verify picks for Amsterdam.',
      error: 'Could not verify Amsterdam picks because its place catalog is unavailable.', state: 'error',
    });
    const success = createDiscoverCityGroup(outcome(['place-1']), { status: 'success', data: places, error: null });
    expect(summarizeDiscoverGroups([success, { ...failed, cityId: 'utrecht' }])).toEqual({
      placeIds: ['place-1'], warning: 'Could not load or verify picks for Utrecht.', error: null, state: 'loaded',
    });
  });
});
