import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CityId, DiscoverDto, DiscoverTheme } from '../models/catalog.models';

@Injectable({ providedIn: 'root' })
export class DiscoverApiService {
  private readonly http = inject(HttpClient);

  discover(cityId: CityId, theme: DiscoverTheme): Observable<DiscoverDto> {
    const params = new HttpParams().set('cityId', cityId).set('theme', theme);
    return this.http.get<DiscoverDto>('/api/discover', { params });
  }
}
