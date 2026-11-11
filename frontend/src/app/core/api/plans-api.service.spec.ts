import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { PlanResponse, PlanUpsertRequest } from '../models/plan.models';
import { apiErrorMessage } from './api-error';
import { PlansApiService, UnexpectedPlanResponseError } from './plans-api.service';

const PLAN_ID = '614c6654-95e7-4ad6-8fd7-c1fc0b01e95e';
const PLACE_IDS = ['amsterdam-node-34050791', 'amsterdam-node-2720969322'];
const REQUEST: PlanUpsertRequest = {
  name: 'Amsterdam afternoon',
  cityId: 'amsterdam',
  placeIds: PLACE_IDS,
};
const RESPONSE: PlanResponse = {
  id: PLAN_ID,
  name: REQUEST.name,
  cityId: REQUEST.cityId,
  placeIds: PLACE_IDS,
  createdAt: '2026-11-10T12:00:00Z',
  updatedAt: '2026-11-10T12:00:00Z',
};

describe('PlansApiService', () => {
  let service: PlansApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PlansApiService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PlansApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('posts the typed payload to the same-origin endpoint and requires 201 with a matching Location', () => {
    let response: PlanResponse | undefined;
    service.createPlan(REQUEST).subscribe((created) => (response = created));

    const request = httpTesting.expectOne('/api/plans');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(REQUEST);
    request.flush(RESPONSE, {
      status: 201,
      statusText: 'Created',
      headers: new HttpHeaders({ Location: `/api/plans/${PLAN_ID}` }),
    });

    expect(response).toEqual(RESPONSE);
  });

  it('loads the server list and one authoritative saved plan', () => {
    let plans: readonly PlanResponse[] | undefined;
    service.getPlans().subscribe((result) => (plans = result));
    const listRequest = httpTesting.expectOne('/api/plans');
    expect(listRequest.request.method).toBe('GET');
    listRequest.flush([RESPONSE]);
    expect(plans).toEqual([RESPONSE]);

    let plan: PlanResponse | undefined;
    service.getPlan(PLAN_ID).subscribe((result) => (plan = result));
    const detailRequest = httpTesting.expectOne(`/api/plans/${PLAN_ID}`);
    expect(detailRequest.request.method).toBe('GET');
    detailRequest.flush(RESPONSE);
    expect(plan).toEqual(RESPONSE);
  });

  it('sends a complete ordered replacement and requires a valid 200 response', () => {
    const replacement: PlanUpsertRequest = {
      name: 'A reordered day',
      cityId: 'amsterdam',
      placeIds: [...PLACE_IDS].reverse(),
    };
    const updated: PlanResponse = {
      ...RESPONSE,
      ...replacement,
      updatedAt: '2026-11-10T12:30:00Z',
    };
    let result: PlanResponse | undefined;
    service.updatePlan(PLAN_ID, replacement).subscribe((response) => (result = response));

    const request = httpTesting.expectOne(`/api/plans/${PLAN_ID}`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual(replacement);
    request.flush(updated);
    expect(result).toEqual(updated);

    let error: unknown;
    service.updatePlan(PLAN_ID, replacement).subscribe({ error: (caught: unknown) => (error = caught) });
    httpTesting.expectOne(`/api/plans/${PLAN_ID}`).flush({ ...updated, id: '00000000-0000-0000-0000-000000000000' });
    expect(error).toBeInstanceOf(UnexpectedPlanResponseError);
  });

  it('requires DELETE to return exactly 204 with no body', () => {
    let completed = false;
    service.deletePlan(PLAN_ID).subscribe(() => (completed = true));
    const request = httpTesting.expectOne(`/api/plans/${PLAN_ID}`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(completed).toBe(true);

    let error: unknown;
    service.deletePlan(PLAN_ID).subscribe({ error: (caught: unknown) => (error = caught) });
    httpTesting.expectOne(`/api/plans/${PLAN_ID}`).flush(null, { status: 200, statusText: 'OK' });
    expect(error).toBeInstanceOf(UnexpectedPlanResponseError);
  });

  it('rejects a success response without the required status, location or response shape', () => {
    const errors: unknown[] = [];
    service.createPlan(REQUEST).subscribe({ error: (error: unknown) => errors.push(error) });
    httpTesting.expectOne('/api/plans').flush(RESPONSE, {
      status: 200,
      statusText: 'OK',
      headers: new HttpHeaders({ Location: `/api/plans/${PLAN_ID}` }),
    });

    service.createPlan(REQUEST).subscribe({ error: (error: unknown) => errors.push(error) });
    httpTesting.expectOne('/api/plans').flush(RESPONSE, {
      status: 201,
      statusText: 'Created',
      headers: new HttpHeaders({ Location: '/api/plans/00000000-0000-0000-0000-000000000000' }),
    });

    service.createPlan(REQUEST).subscribe({ error: (error: unknown) => errors.push(error) });
    httpTesting.expectOne('/api/plans').flush({ id: PLAN_ID }, {
      status: 201,
      statusText: 'Created',
      headers: new HttpHeaders({ Location: `/api/plans/${PLAN_ID}` }),
    });

    expect(errors).toHaveLength(3);
    expect(errors.every((error) => error instanceof UnexpectedPlanResponseError)).toBe(true);
  });

  it('uses a safe ProblemDetail message for a rejected request', () => {
    let error: unknown;
    service.createPlan(REQUEST).subscribe({ error: (caught: unknown) => (error = caught) });
    httpTesting.expectOne('/api/plans').flush({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Plan name must not be blank.',
    }, { status: 400, statusText: 'Bad Request' });

    expect(apiErrorMessage(error, 'Could not save plan')).toBe('Plan name must not be blank.');
    expect(apiErrorMessage(new HttpErrorResponse({ status: 0 }), 'Could not save plan'))
      .toContain('Check that the backend is running');
  });
});
