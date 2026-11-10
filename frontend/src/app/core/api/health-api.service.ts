import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';

export type HealthResponse = Readonly<{
  status: 'UP';
  service: 'hopon-api';
}>;

@Injectable({ providedIn: 'root' })
export class HealthApiService {
  private readonly http = inject(HttpClient);

  getHealth(): Observable<HealthResponse> {
    return this.http.get<unknown>('/api/health').pipe(map(toHealthResponse));
  }
}

function toHealthResponse(payload: unknown): HealthResponse {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('status' in payload) ||
    payload.status !== 'UP' ||
    !('service' in payload) ||
    payload.service !== 'hopon-api'
  ) {
    throw new Error('Health endpoint returned an unexpected response');
  }

  return { status: 'UP', service: 'hopon-api' };
}
