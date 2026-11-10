import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CityDto } from '../models/catalog.models';

@Injectable({ providedIn: 'root' })
export class CitiesApiService {
  private readonly http = inject(HttpClient);

  getCities(): Observable<readonly CityDto[]> {
    return this.http.get<readonly CityDto[]>('/api/cities');
  }
}
