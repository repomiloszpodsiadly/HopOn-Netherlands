import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';

export type HealthResponse = Readonly<{
  status: 'UP';
  service: 'hopon-api';
}>;

export class UnexpectedHealthResponseError extends Error {
  constructor() {
    super('Health endpoint returned an unexpected response');
    this.name = 'UnexpectedHealthResponseError';
  }
}

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
    throw new UnexpectedHealthResponseError();
  }

  return { status: 'UP', service: 'hopon-api' };
}
