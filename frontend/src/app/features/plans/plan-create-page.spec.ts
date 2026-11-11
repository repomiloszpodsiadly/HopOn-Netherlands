import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { PlaceDto } from '../../core/models/catalog.models';
import { PlanResponse, PlanUpsertRequest } from '../../core/models/plan.models';
import { DRAFT_PLAN_STORAGE_KEY } from '../../core/services/draft-plan.store';
import { routes } from '../../app.routes';

const PLACE_IDS = [
  'amsterdam-node-34050791',
  'amsterdam-node-2720969322',
  'amsterdam-node-4866454999',
  'amsterdam-node-855243398',
  'amsterdam-node-34050790',
  'amsterdam-node-8335928712',
  'amsterdam-node-2720969403',
  'amsterdam-way-601081859',
  'amsterdam-node-2741083668',
  'amsterdam-node-9039056397',
  'amsterdam-node-3974788765',
  'amsterdam-node-2862571795',
  'amsterdam-node-2724102309',
] as const;

const AMSTERDAM_PLACES: readonly PlaceDto[] = PLACE_IDS.map((id, index) => ({
  id,
  cityId: 'amsterdam',
  name: `Place ${index + 1}`,
  category: 'MUSEUMS',
  latitude: 52.37,
  longitude: 4.89,
  tags: ['museum'],
  shortDescription: `Description ${index + 1}`,
  imagePath: null,
  imageAttributionId: null,
}));

const ROTTERDAM_PLACES: readonly PlaceDto[] = [{
  ...AMSTERDAM_PLACES[0],
  id: 'rotterdam-node-2671299642',
  cityId: 'rotterdam',
  name: 'Rotterdam Place',
}];

const PLAN_ID = '614c6654-95e7-4ad6-8fd7-c1fc0b01e95e';

function storeDraft(placeIds: readonly string[], cityId = 'amsterdam', name = 'Museum day'): void {
  sessionStorage.setItem(DRAFT_PLAN_STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    cityId,
    name,
    placeIds,
    updatedAt: '2026-11-10T12:00:00.000Z',
  }));
}

function currentStoredDraft(): { name: string; cityId: string; placeIds: string[] } {
  const value = JSON.parse(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY) ?? '{}') as {
    name: string;
    cityId: string;
    placeIds: string[];
  };
  return { name: value.name, cityId: value.cityId, placeIds: value.placeIds };
}

describe('PlanCreatePage', () => {
  beforeEach(() => {
    sessionStorage.removeItem(DRAFT_PLAN_STORAGE_KEY);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify({ ignoreCancelled: true });
    sessionStorage.removeItem(DRAFT_PLAN_STORAGE_KEY);
  });

  async function startPage(url: string) {
    const harness = await RouterTestingHarness.create(url);
    const http = TestBed.inject(HttpTestingController);
    const stored = JSON.parse(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY) ?? 'null') as
      { cityId?: string } | null;
    const requestedCity = new URL(url, 'http://localhost').searchParams.get('city');
    const cityId = stored?.cityId ?? requestedCity ?? 'amsterdam';
    const catalogRequest = http.expectOne(
      (request) => request.url === '/api/places' && request.params.get('cityId') === cityId,
    );
    catalogRequest.flush(cityId === 'rotterdam' ? ROTTERDAM_PLACES : AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();
    return {
      harness,
      http,
      component: harness.routeDebugElement!.componentInstance as import('./plan-create-page').PlanCreatePage,
    };
  }

  it('initializes a valid requested city and activates Plans navigation', async () => {
    const { harness, http, component } = await startPage('/plans/new?city=rotterdam');

    expect(component.draftStore.draft()?.cityId).toBe('rotterdam');
    expect(component.draftStore.draft()?.placeIds).toEqual([]);
    expect(harness.routeNativeElement?.querySelector('#plan-city')).toBeTruthy();
    const plansLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      'nav[aria-label="Main navigation"] a[href="/plans"]',
    );
    expect(plansLink?.getAttribute('aria-current')).toBe('page');
    http.expectNone('/api/plans');
  });

  it('restores, reorders and removes stops while persisting their exact order', async () => {
    storeDraft(PLACE_IDS.slice(0, 3));
    const { harness, http } = await startPage('/plans/new');

    const firstDown = harness.routeNativeElement?.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Place 1 down"]',
    );
    firstDown?.click();
    harness.detectChanges();
    expect(currentStoredDraft().placeIds).toEqual([PLACE_IDS[1], PLACE_IDS[0], PLACE_IDS[2]]);

    const removeThird = harness.routeNativeElement?.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Place 3"]',
    );
    removeThird?.click();
    harness.detectChanges();
    expect(currentStoredDraft().placeIds).toEqual([PLACE_IDS[1], PLACE_IDS[0]]);
    expect(harness.routeNativeElement?.querySelectorAll('.editor-place')).toHaveLength(2);
    http.expectNone('/api/plans');
  });

  it('preserves all 13 restored places and blocks a save without sending a request', async () => {
    storeDraft(PLACE_IDS);
    const { component, http } = await startPage('/plans/new');

    expect(component.draftStore.draft()?.placeIds).toEqual(PLACE_IDS);
    expect(currentStoredDraft().placeIds).toEqual(PLACE_IDS);
    expect(component.canSave()).toBe(false);
    component.save();
    http.expectNone('/api/plans');
  });

  it('sends one explicit POST and clears only after a confirmed 201 response', async () => {
    storeDraft(PLACE_IDS.slice(0, 2));
    const { harness, component, http } = await startPage('/plans/new');
    const requestPayload = {
      name: 'Museum day',
      cityId: 'amsterdam',
      placeIds: [...PLACE_IDS.slice(0, 2)],
    } satisfies PlanUpsertRequest;

    component.save();
    component.save();
    const request = http.expectOne('/api/plans');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(requestPayload);
    expect(Object.isFrozen(request.request.body)).toBe(true);
    expect(Object.isFrozen((request.request.body as PlanUpsertRequest).placeIds)).toBe(true);
    expect(component.saving()).toBe(true);

    const response: PlanResponse = {
      id: PLAN_ID,
      ...requestPayload,
      createdAt: '2026-11-10T12:00:00Z',
      updatedAt: '2026-11-10T12:00:00Z',
    };
    request.flush(response, {
      status: 201,
      statusText: 'Created',
      headers: new HttpHeaders({ Location: `/api/plans/${PLAN_ID}` }),
    });
    await harness.fixture.whenStable();
    const detailRequest = http.expectOne(`/api/plans/${PLAN_ID}`);
    detailRequest.flush(response);
    await harness.fixture.whenStable();
    http.expectOne(
      (candidate) => candidate.url === '/api/places' && candidate.params.get('cityId') === 'amsterdam',
    ).flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY)).toBeNull();
    expect(TestBed.inject(Router).url).toBe(`/plans/${PLAN_ID}`);
  });

  it('keeps and explains a newer draft when a confirmed POST matches the submitted snapshot', async () => {
    storeDraft(PLACE_IDS.slice(0, 2));
    const { harness, component, http } = await startPage('/plans/new');

    component.save();
    const request = http.expectOne('/api/plans');
    component.draftStore.renameDraft('A newer draft edit');
    const createdPlan: PlanResponse = {
      id: PLAN_ID,
      name: 'Museum day',
      cityId: 'amsterdam',
      placeIds: [...PLACE_IDS.slice(0, 2)],
      createdAt: '2026-11-10T12:00:00Z',
      updatedAt: '2026-11-10T12:00:00Z',
    };
    request.flush(createdPlan, {
      status: 201,
      statusText: 'Created',
      headers: new HttpHeaders({ Location: `/api/plans/${PLAN_ID}` }),
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(currentStoredDraft()).toEqual({
      name: 'A newer draft edit',
      cityId: 'amsterdam',
      placeIds: [...PLACE_IDS.slice(0, 2)],
    });
    expect(component.createSuccess()).toContain('newer unsaved tab draft remains');
    expect(harness.routeNativeElement?.querySelector(`a[href="/plans/${PLAN_ID}"]`)?.textContent)
      .toContain('Open the saved plan');
    expect(TestBed.inject(Router).url).toBe('/plans/new');
    http.expectNone(`/api/plans/${PLAN_ID}`);
  });

  it('blocks SPA exits while POST is pending without cancelling it, then releases on confirmed success', async () => {
    storeDraft(PLACE_IDS.slice(0, 2));
    const { harness, component, http } = await startPage('/plans/new');

    component.save();
    const request = http.expectOne('/api/plans');
    const exitSelectors = [
      '.plans-topbar .plans-brand',
      '.plans-topbar .editor-back',
      'app-main-navigation a[href*="#map-region"]',
      'app-main-navigation a[href="/?city=amsterdam"]',
      'app-main-navigation a[href="/plans"]',
    ];
    for (const selector of exitSelectors) {
      const link = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(selector);
      expect(link).not.toBeNull();
      link!.click();
      await harness.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe('/plans/new');
      expect(request.cancelled).toBe(false);
    }

    expect(await TestBed.inject(Router).navigateByUrl('/plans')).toBe(false);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(component.navigationMessage()).toBe('Saving in progress. Please wait for confirmation.');
    expect(harness.routeNativeElement?.textContent).toContain('Saving in progress. Please wait for confirmation.');
    expect(request.cancelled).toBe(false);

    const pendingUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pendingUnload);
    expect(pendingUnload.defaultPrevented).toBe(true);

    const savedPlan: PlanResponse = {
      id: PLAN_ID,
      name: 'Museum day',
      cityId: 'amsterdam',
      placeIds: [...PLACE_IDS.slice(0, 2)],
      createdAt: '2026-11-10T12:00:00Z',
      updatedAt: '2026-11-10T12:00:00Z',
    };
    request.flush(savedPlan, {
      status: 201,
      statusText: 'Created',
      headers: new HttpHeaders({ Location: `/api/plans/${PLAN_ID}` }),
    });
    await harness.fixture.whenStable();
    http.expectOne(`/api/plans/${PLAN_ID}`).flush(savedPlan);
    await harness.fixture.whenStable();
    http.expectOne(
      (candidate) => candidate.url === '/api/places' && candidate.params.get('cityId') === 'amsterdam',
    ).flush(AMSTERDAM_PLACES);
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe(`/plans/${PLAN_ID}`);
    const afterSaveUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterSaveUnload);
    expect(afterSaveUnload.defaultPrevented).toBe(false);
  });

  it('locks editor controls and rejects direct edits and conflict actions while POST is pending', async () => {
    storeDraft(PLACE_IDS.slice(0, 2));
    const { harness, component, http } = await startPage('/plans/new');
    const before = currentStoredDraft();

    component.save();
    const request = http.expectOne('/api/plans');
    harness.detectChanges();

    expect(harness.routeNativeElement?.querySelector<HTMLInputElement>('#plan-name')?.disabled).toBe(true);
    expect(harness.routeNativeElement?.querySelector<HTMLSelectElement>('#plan-city')?.disabled).toBe(true);
    expect(harness.routeNativeElement?.querySelector<HTMLButtonElement>(`button[aria-label="Move Place 1 down"]`)?.disabled)
      .toBe(true);
    expect(harness.routeNativeElement?.querySelector<HTMLButtonElement>('button[aria-label="Remove Place 1"]')?.disabled)
      .toBe(true);

    component.onNameInput({ target: { value: 'Changed while saving' } } as unknown as Event);
    component.onCitySelected({ target: { value: 'rotterdam' } } as unknown as Event);
    component.movePlace(PLACE_IDS[0], 'down');
    component.removePlace(PLACE_IDS[0]);
    component.retryCatalog();
    expect(component.draftStore.requestCityChange('rotterdam', 'Rotterdam')).toBe(false);
    const conflictDuringSave = component.draftStore.cityConflict();
    expect(conflictDuringSave?.cityId).toBe('rotterdam');
    component.keepExistingDraft();
    component.replaceDraftWithRequestedCity();

    expect(currentStoredDraft()).toEqual(before);
    expect(component.draftStore.cityConflict()).toBe(conflictDuringSave);
    expect(request.cancelled).toBe(false);
    http.expectNone((candidate) => candidate.url === '/api/places');
    expect(component.confirmNavigationAway()).toBe(false);

    request.flush({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'The request was rejected.',
    }, { status: 400, statusText: 'Bad Request' });
    await harness.fixture.whenStable();

    expect(currentStoredDraft()).toEqual(before);
    expect(component.saving()).toBe(false);
    expect(component.navigationMessage()).toBeNull();
    expect(component.draftStore.cityConflict()).toBe(conflictDuringSave);
    const afterFailureUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterFailureUnload);
    expect(afterFailureUnload.defaultPrevented).toBe(false);
  });

  it('keeps the exact draft after a validation rejection', async () => {
    storeDraft(PLACE_IDS.slice(0, 2));
    const { harness, component, http } = await startPage('/plans/new');
    const before = currentStoredDraft();

    component.save();
    http.expectOne('/api/plans').flush({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Plan name is already in use.',
    }, { status: 400, statusText: 'Bad Request' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(currentStoredDraft()).toEqual(before);
    expect(component.createError()).toBe('Plan name is already in use.');
    expect(component.unknownOutcome()).toBe(false);
  });

  it('keeps the draft and warns about an unknown outcome after server failure', async () => {
    storeDraft(PLACE_IDS.slice(0, 2));
    const { harness, component, http } = await startPage('/plans/new');
    const before = currentStoredDraft();

    component.save();
    http.expectOne('/api/plans').flush({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'The request could not be completed.',
    }, { status: 500, statusText: 'Internal Server Error' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(currentStoredDraft()).toEqual(before);
    expect(component.unknownOutcome()).toBe(true);
    expect(harness.routeNativeElement?.textContent).toContain('server may have created the plan');
    expect(harness.routeNativeElement?.textContent).toContain('Review Saved Plans before retrying');
  });

  it('keeps the draft and gives the same no-auto-retry guidance when offline', async () => {
    storeDraft(PLACE_IDS.slice(0, 2));
    const { harness, component, http } = await startPage('/plans/new');
    const before = currentStoredDraft();

    component.save();
    http.expectOne('/api/plans').error(new ProgressEvent('error'));
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(currentStoredDraft()).toEqual(before);
    expect(component.unknownOutcome()).toBe(true);
    expect(harness.routeNativeElement?.textContent).toContain('Check that the backend is running');
    expect(harness.routeNativeElement?.textContent).toContain('Review Saved Plans before retrying');
  });

  it('keeps the existing city draft until the user explicitly resolves a conflict', async () => {
    storeDraft(PLACE_IDS.slice(0, 2));
    const { harness, component, http } = await startPage('/plans/new?city=rotterdam');

    expect(component.draftStore.cityConflict()?.cityId).toBe('rotterdam');
    expect(currentStoredDraft()).toEqual({
      name: 'Museum day',
      cityId: 'amsterdam',
      placeIds: [...PLACE_IDS.slice(0, 2)],
    });
    expect(harness.routeNativeElement?.textContent).toContain('Keep the existing draft?');
    expect(harness.routeNativeElement?.querySelector('[role="region"][aria-labelledby="plan-city-conflict-title"]'))
      .toBeTruthy();
    expect(harness.routeNativeElement?.querySelector('[aria-modal="true"]')).toBeNull();
    http.expectNone('/api/plans');
  });

  it('keeps the saved draft when the user explicitly chooses Keep existing', async () => {
    storeDraft(PLACE_IDS.slice(0, 2));
    const { harness, component, http } = await startPage('/plans/new?city=rotterdam');

    component.keepExistingDraft();
    await harness.fixture.whenStable();
    const refreshes = http.match(
      (request) => request.url === '/api/places' && request.params.get('cityId') === 'amsterdam',
    );
    for (const refresh of refreshes.filter((candidate) => !candidate.cancelled)) {
      refresh.flush(AMSTERDAM_PLACES);
    }
    await harness.fixture.whenStable();

    expect(component.draftStore.cityConflict()).toBeNull();
    expect(currentStoredDraft()).toEqual({
      name: 'Museum day',
      cityId: 'amsterdam',
      placeIds: [...PLACE_IDS.slice(0, 2)],
    });
    expect(TestBed.inject(Router).url).toContain('city=amsterdam');
  });

  it('replaces the draft only after the user chooses Start new for the requested city', async () => {
    storeDraft(PLACE_IDS.slice(0, 2));
    const { harness, component, http } = await startPage('/plans/new?city=rotterdam');

    component.replaceDraftWithRequestedCity();
    await harness.fixture.whenStable();
    const cityRequests = http.match(
      (request) => request.url === '/api/places' && request.params.get('cityId') === 'rotterdam',
    );
    const activeRequests = cityRequests.filter((candidate) => !candidate.cancelled);
    expect(activeRequests).toHaveLength(1);
    activeRequests[0].flush(ROTTERDAM_PLACES);
    await harness.fixture.whenStable();

    expect(component.draftStore.draft()).toMatchObject({
      cityId: 'rotterdam',
      name: 'Rotterdam plan',
      placeIds: [],
    });
    expect(currentStoredDraft()).toEqual({
      name: 'Rotterdam plan',
      cityId: 'rotterdam',
      placeIds: [],
    });
    expect(harness.routeNativeElement?.querySelector('[role="dialog"]')).toBeNull();
  });
});
