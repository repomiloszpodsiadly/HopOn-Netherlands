import { MobilityHubDto, PlaceDto } from '../../core/models/catalog.models';
import { formatApproximateDistance, haversineMeters, nearbyHubsForPlace } from './nearby-hubs';

const place: PlaceDto = {
  id: 'utrecht-place',
  cityId: 'utrecht',
  name: 'Utrecht place',
  category: 'CULTURE',
  latitude: 52,
  longitude: 5,
  tags: [],
  shortDescription: '',
  imagePath: null,
  imageAttributionId: null,
};

function hub(id: string, latitude: number, cityId = 'utrecht'): MobilityHubDto {
  return {
    id,
    cityId: cityId as 'utrecht' | 'amsterdam' | 'rotterdam',
    name: id,
    latitude,
    longitude: 5,
    modes: ['TRAIN'],
    source: 'https://www.openstreetmap.org/',
  };
}

describe('nearby hub distance', () => {
  it('returns zero for identical coordinates and uses a great-circle distance', () => {
    expect(haversineMeters(52, 5, 52, 5)).toBe(0);
    expect(haversineMeters(52, 5, 52.01, 5)).toBeGreaterThan(1_000);
  });

  it('keeps the three closest same-city hubs and resolves equal distances by stable ID', () => {
    const hubs = [
      hub('hub-c', 52.0003),
      hub('hub-z', 52),
      hub('other-city', 52, 'rotterdam'),
      hub('too-far', 52.02),
      hub('hub-a', 52),
      hub('hub-d', 52.0004),
    ];

    expect(nearbyHubsForPlace(place, hubs).map((item) => item.hub.id))
      .toEqual(['hub-a', 'hub-z', 'hub-c']);
  });

  it('labels rounded meters and kilometers as approximate straight-line distances', () => {
    expect(formatApproximateDistance(72.4)).toBe('72 m');
    expect(formatApproximateDistance(1_240)).toBe('1.2 km');
  });
});
