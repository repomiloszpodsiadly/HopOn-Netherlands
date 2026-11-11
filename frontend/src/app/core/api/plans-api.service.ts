import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { isCityId } from '../models/catalog.models';
import { PlanResponse, PlanUpsertRequest } from '../models/plan.models';

export class UnexpectedPlanResponseError extends Error {
  constructor() {
    super('The API did not confirm the saved plan response.');
    this.name = 'UnexpectedPlanResponseError';
  }
}

@Injectable({ providedIn: 'root' })
export class PlansApiService {
  private readonly http = inject(HttpClient);

  getPlans(): Observable<readonly PlanResponse[]> {
    return this.http.get<unknown>('/api/plans', { observe: 'response' }).pipe(
      map((response) => {
        if (response.status !== 200 || !Array.isArray(response.body)) {
          throw new UnexpectedPlanResponseError();
        }
        const plans = response.body.map(asPlanResponse);
        if (plans.some((plan) => plan === null)) {
          throw new UnexpectedPlanResponseError();
        }
        return plans as PlanResponse[];
      }),
    );
  }

  getPlan(id: string): Observable<PlanResponse> {
    return this.http.get<unknown>(`/api/plans/${encodeURIComponent(id)}`, { observe: 'response' }).pipe(
      map((response) => requirePlanResponse(response, 200)),
    );
  }

  createPlan(request: PlanUpsertRequest): Observable<PlanResponse> {
    return this.http.post<unknown>('/api/plans', request, { observe: 'response' }).pipe(
      map((response) => validateCreatedPlan(response)),
    );
  }

  updatePlan(id: string, request: PlanUpsertRequest): Observable<PlanResponse> {
    return this.http.put<unknown>(`/api/plans/${encodeURIComponent(id)}`, request, { observe: 'response' }).pipe(
      map((response) => requirePlanResponse(response, 200, id)),
    );
  }

  deletePlan(id: string): Observable<void> {
    return this.http.delete<unknown>(`/api/plans/${encodeURIComponent(id)}`, { observe: 'response' }).pipe(
      map((response) => {
        if (response.status !== 204 || response.body !== null) {
          throw new UnexpectedPlanResponseError();
        }
      }),
    );
  }
}

function validateCreatedPlan(response: HttpResponse<unknown>): PlanResponse {
  const plan = requirePlanResponse(response, 201);
  const locationId = planIdFromLocation(response.headers.get('Location'));
  if (locationId !== plan.id) {
    throw new UnexpectedPlanResponseError();
  }
  return plan;
}

function requirePlanResponse(
  response: HttpResponse<unknown>,
  expectedStatus: number,
  expectedId?: string,
): PlanResponse {
  const plan = asPlanResponse(response.body);
  if (
    response.status !== expectedStatus
    || plan === null
    || (expectedId !== undefined && plan.id !== expectedId)
  ) {
    throw new UnexpectedPlanResponseError();
  }
  return plan;
}

function asPlanResponse(value: unknown): PlanResponse | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate['id'];
  const name = candidate['name'];
  const cityId = candidate['cityId'];
  const createdAt = candidate['createdAt'];
  const updatedAt = candidate['updatedAt'];
  const placeIds = candidate['placeIds'];
  if (
    typeof id !== 'string'
    || !UUID_PATTERN.test(id)
    || typeof name !== 'string'
    || name.trim().length === 0
    || name.length > 80
    || typeof cityId !== 'string'
    || !isCityId(cityId)
    || !Array.isArray(placeIds)
    || placeIds.length < 1
    || placeIds.length > 12
    || !placeIds.every((placeId) => typeof placeId === 'string' && placeId.length > 0)
    || new Set(placeIds).size !== placeIds.length
    || !isUtcInstant(createdAt)
    || !isUtcInstant(updatedAt)
  ) {
    return null;
  }
  return {
    id,
    name,
    cityId,
    placeIds: [...placeIds] as string[],
    createdAt,
    updatedAt,
  };
}

function planIdFromLocation(location: string | null): string | null {
  if (location === null) {
    return null;
  }
  try {
    const path = new URL(location, 'http://hopon.local').pathname;
    const match = /^\/api\/plans\/([0-9a-f-]{36})$/i.exec(path);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function isUtcInstant(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
