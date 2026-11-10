import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CityId, PlaceCategory, PlaceDto } from '../models/catalog.models';

@Injectable({ providedIn: 'root' })
export class PlacesApiService {
  private readonly http = inject(HttpClient);

  getPlaces(
    cityId: CityId,
    query?: string,
    category?: PlaceCategory,
  ): Observable<readonly PlaceDto[]> {
    let params = new HttpParams().set('cityId', cityId);
    if (query !== undefined) {
      params = params.set('q', query);
    }
    if (category !== undefined) {
      params = params.set('category', category);
    }
    return this.http.get<readonly PlaceDto[]>('/api/places', { params });
  }

  getPlace(id: string): Observable<PlaceDto> {
    return this.http.get<PlaceDto>(`/api/places/${encodeURIComponent(id)}`);
  }
}
