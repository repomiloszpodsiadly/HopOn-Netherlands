import { catchError, forkJoin, map, Observable, of } from 'rxjs';
import { CITY_IDS, CITY_LABELS, CityId, PlaceDto } from '../models/catalog.models';
import { apiErrorMessage } from './api-error';
import { PlacesApiService } from './places-api.service';

export type PlacesCatalogResult = Readonly<{
  places: readonly PlaceDto[];
  error: string | null;
}>;

type CityCatalogResult = Readonly<{
  cityId: CityId;
  places: readonly PlaceDto[] | null;
  error: string | null;
}>;

/** Fetches every city in catalog order, retaining successful cities on partial failure. */
export function loadAllCityPlaces(api: PlacesApiService): Observable<PlacesCatalogResult> {
  return forkJoin(CITY_IDS.map((cityId) => api.getPlaces(cityId).pipe(
    map((places) => ({ cityId, places, error: null }) satisfies CityCatalogResult),
    catchError((error: unknown) => of({
      cityId,
      places: null,
      error: apiErrorMessage(error, `Could not load ${CITY_LABELS[cityId]} places`),
    } satisfies CityCatalogResult)),
  ))).pipe(map((catalogs) => {
    const unavailableCities = catalogs
      .filter((catalog) => catalog.error !== null)
      .map((catalog) => CITY_LABELS[catalog.cityId]);
    return {
      places: catalogs.flatMap((catalog) => catalog.places ?? []),
      error: unavailableCities.length === 0
        ? null
        : `Place details could not be loaded for ${unavailableCities.join(', ')}.`,
    };
  }));
}
