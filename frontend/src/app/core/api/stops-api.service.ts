import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CityId, MobilityHubDto } from '../models/catalog.models';

@Injectable({ providedIn: 'root' })
export class StopsApiService {
  private readonly http = inject(HttpClient);

  getStops(cityId: CityId): Observable<readonly MobilityHubDto[]> {
    const params = new HttpParams().set('cityId', cityId);
    return this.http.get<readonly MobilityHubDto[]>('/api/stops', { params });
  }
}
