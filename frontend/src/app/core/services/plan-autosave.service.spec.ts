import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PlaceDto } from '../models/catalog.models';
import { ActivePlanStore, ACTIVE_PLAN_STORAGE_KEY } from './active-plan.store';
import { DraftPlanStore, DRAFT_PLAN_STORAGE_KEY } from './draft-plan.store';
import { PlanAutosaveService } from './plan-autosave.service';

const PLACE: PlaceDto = {
  id: 'amsterdam-example', cityId: 'amsterdam', name: 'Example', category: 'CULTURE',
  latitude: 52.37, longitude: 4.89, tags: [], shortDescription: 'A place.',
  imagePath: null, imageAttributionId: null,
};

describe('PlanAutosaveService', () => {
  beforeEach(() => {
    sessionStorage.removeItem(DRAFT_PLAN_STORAGE_KEY);
    sessionStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    sessionStorage.removeItem(DRAFT_PLAN_STORAGE_KEY);
    sessionStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);
  });

  function setup() {
    const drafts = TestBed.inject(DraftPlanStore);
    const service = TestBed.inject(PlanAutosaveService);
    const active = TestBed.inject(ActivePlanStore);
    const http = TestBed.inject(HttpTestingController);
    drafts.addPlaces([PLACE.id], [PLACE]);
    return { drafts, service, active, http };
  }

  function confirm(http: HttpTestingController, id: string, name = 'My day out-1') {
    const request = http.expectOne(`/api/plans/${id}/autosave`);
    expect(request.request.method).toBe('PUT');
    request.flush({ ...request.request.body, name, id,
      createdAt: '2026-11-14T12:00:00Z', updatedAt: '2026-11-14T12:00:00Z' });
  }

  it('keeps the draft until confirmation, accepts an allocated name and selects the saved plan', () => {
    const { drafts, service, active, http } = setup();
    service.save();
    const id = drafts.draft()!.autosaveId!;
    expect(id).toBeTruthy();
    expect(service.pending()).toBe(true);
    expect(active.selectedId()).toBeNull();
    service.save();
    confirm(http, id);
    expect(drafts.draft()).toBeNull();
    expect(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY)).toBeNull();
    expect(active.selectedId()).toBe(id);
    expect(service.lastSaved()?.name).toBe('My day out-1');
    expect(service.pending()).toBe(false);
  });

  it('retries an interrupted write with exactly the same ID and snapshot', () => {
    const { drafts, service, http } = setup();
    service.save();
    const snapshot = drafts.draft()!;
    http.expectOne(`/api/plans/${snapshot.autosaveId}/autosave`).error(new ProgressEvent('error'));
    expect(drafts.draft()).toBe(snapshot);
    expect(service.error()).toContain('Could not connect');
    service.save();
    expect(drafts.draft()?.autosaveId).toBe(snapshot.autosaveId);
    confirm(http, snapshot.autosaveId!);
    expect(service.error()).toBeNull();
    expect(drafts.draft()).toBeNull();
  });

  it('resumes a validated interrupted draft after reload', () => {
    const id = '74148499-9538-425f-af37-1d29037945c2';
    sessionStorage.setItem(DRAFT_PLAN_STORAGE_KEY, JSON.stringify({ schemaVersion: 1,
      cityId: 'amsterdam', name: 'My day out', description: '', placeIds: [PLACE.id], autosaveId: id,
      updatedAt: '2026-11-14T12:00:00Z' }));
    const drafts = TestBed.inject(DraftPlanStore);
    const service = TestBed.inject(PlanAutosaveService);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    http.expectNone(`/api/plans/${id}/autosave`);
    drafts.validatePendingDraft('amsterdam', [PLACE]);
    TestBed.tick();
    expect(service.pending()).toBe(true);
    confirm(http, id);
    expect(TestBed.inject(ActivePlanStore).selectedId()).toBe(id);
  });

  it('explains 6 of 6 capacity and preserves the local places for recovery', () => {
    const { drafts, service, active, http } = setup();
    service.save();
    const id = drafts.draft()!.autosaveId!;
    http.expectOne(`/api/plans/${id}/autosave`).flush({ status: 409,
      detail: 'You have 6 of 6 saved plans. Use an existing plan or delete one before creating another.' },
      { status: 409, statusText: 'Conflict' });
    expect(service.capacityReached()).toBe(true);
    expect(service.error()).toContain('Use an existing plan or delete one');
    expect(drafts.draft()?.placeIds).toEqual([PLACE.id]);
    expect(active.selectedId()).toBeNull();
    TestBed.tick();
    http.expectNone(`/api/plans/${id}/autosave`);
  });

  it('does not erase a newer draft while confirming an earlier snapshot', () => {
    const { drafts, service, active, http } = setup();
    service.save();
    const id = drafts.draft()!.autosaveId!;
    drafts.updateDescription('A newer edit');
    confirm(http, id);
    expect(drafts.draft()?.description).toBe('A newer edit');
    expect(service.error()).toContain('newer draft');
    expect(active.selectedId()).toBeNull();
  });

  it('does not replace a saved plan selected while the write was in flight', () => {
    const { drafts, service, active, http } = setup();
    service.save();
    const id = drafts.draft()!.autosaveId!;
    const selected = '74148499-9538-425f-af37-1d29037945c2';
    active.select(selected);
    confirm(http, id);
    expect(active.selectedId()).toBe(selected);
    expect(drafts.draft()).toBeNull();
  });

  it('keeps the draft on a mismatched confirmation instead of claiming a successful save', () => {
    const { drafts, service, http } = setup();
    service.save();
    const id = drafts.draft()!.autosaveId!;
    confirm(http, id, 'An unrelated plan');
    expect(service.error()).toContain('not confirmed');
    expect(drafts.draft()?.placeIds).toEqual([PLACE.id]);
  });
});
