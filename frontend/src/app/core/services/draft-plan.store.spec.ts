import { TestBed } from '@angular/core/testing';
import { CityId, PlaceDto } from '../models/catalog.models';
import { DraftPlanStore, DRAFT_PLAN_STORAGE_KEY } from './draft-plan.store';

function place(id: string, cityId: CityId = 'amsterdam'): PlaceDto {
  return {
    id,
    cityId,
    name: id,
    category: 'MUSEUMS',
    latitude: 52.37,
    longitude: 4.89,
    tags: [],
    shortDescription: '',
    imagePath: null,
    imageAttributionId: null,
  };
}

describe('DraftPlanStore', () => {
  beforeEach(() => {
    sessionStorage.removeItem(DRAFT_PLAN_STORAGE_KEY);
    TestBed.configureTestingModule({});
  });

  afterEach(() => sessionStorage.removeItem(DRAFT_PLAN_STORAGE_KEY));

  it('adds verified IDs from different cities, preserves order, and deduplicates repeated adds', () => {
    const store = TestBed.inject(DraftPlanStore);
    const catalog = [place('first'), place('second')];

    expect(store.addPlaces(['first', 'first', 'unknown'], catalog))
      .toEqual({ status: 'added', addedCount: 1, alreadyPresentCount: 0 });
    expect(store.addPlaces(['first'], catalog))
      .toEqual({ status: 'already-added' });
    expect(store.addPlaces(['first', 'second'], catalog))
      .toEqual({ status: 'added', addedCount: 1, alreadyPresentCount: 1 });

    const rotterdamPlace = place('rotterdam-stop', 'rotterdam');
    expect(store.addPlaces([rotterdamPlace.id], [...catalog, rotterdamPlace]))
      .toEqual({ status: 'added', addedCount: 1, alreadyPresentCount: 0 });

    expect(store.draft()?.placeIds).toEqual(['first', 'second', 'rotterdam-stop']);
    expect(JSON.parse(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY) ?? '{}')).toMatchObject({
      schemaVersion: 1,
      cityId: 'amsterdam',
      name: 'My day out',
      placeIds: ['first', 'second', 'rotterdam-stop'],
    });
    expect(store.draft()?.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('accepts twelve places and rejects an extra place or oversized batch without changing the draft', () => {
    const store = TestBed.inject(DraftPlanStore);
    const catalog = Array.from({ length: 13 }, (_, index) => place(`place-${index}`));
    const placeIds = catalog.map(({ id }) => id);

    expect(store.addPlaces(placeIds, catalog))
      .toEqual({ status: 'limit-reached' });
    expect(store.draft()).toBeNull();
    expect(store.addPlaces(placeIds.slice(0, 12), catalog))
      .toEqual({ status: 'added', addedCount: 12, alreadyPresentCount: 0 });
    const before = store.draft();
    expect(store.addPlaces([placeIds[12]], catalog))
      .toEqual({ status: 'limit-reached' });
    expect(store.draft()).toBe(before);
    expect(JSON.parse(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY) ?? '{}').placeIds)
      .toEqual(placeIds.slice(0, 12));
  });

  it('keeps cross-city places together and preserves the plan starting city', () => {
    const store = TestBed.inject(DraftPlanStore);
    store.addPlaces(['a1'], [place('a1')]);

    expect(store.addPlaces(['r1'], [place('r1', 'rotterdam')]))
      .toEqual({ status: 'added', addedCount: 1, alreadyPresentCount: 0 });
    expect(store.draft()).toMatchObject({ cityId: 'amsterdam', name: 'My day out', placeIds: ['a1', 'r1'] });
    expect(store.requestCityChange('utrecht')).toBe(true);
    expect(store.draft()).toMatchObject({ cityId: 'utrecht', placeIds: ['a1', 'r1'] });
  });

  it('changes an empty draft city without a conflict and keeps its custom name', () => {
    const store = TestBed.inject(DraftPlanStore);
    store.initializeDraft('amsterdam');
    store.renameDraft('A quiet afternoon');
    store.updateDescription('A walk by the canals.\nCoffee afterwards.');

    for (const cityId of ['rotterdam', 'utrecht', 'amsterdam'] as const) {
      expect(store.requestCityChange(cityId)).toBe(true);
      expect(store.draft()).toMatchObject({ cityId, name: 'A quiet afternoon', placeIds: [] });
      expect(store.draft()?.description).toBe('A walk by the canals.\nCoffee afterwards.');
      expect(JSON.parse(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY) ?? '{}'))
        .toMatchObject({ cityId, name: 'A quiet afternoon', placeIds: [] });
      expect(JSON.parse(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY) ?? '{}').description)
        .toBe('A walk by the canals.\nCoffee afterwards.');
    }
  });

  it('persists empty drafts, renames, ordered edits, and guards successful-save cleanup', () => {
    const store = TestBed.inject(DraftPlanStore);
    expect(store.initializeDraft('amsterdam')).toBe(true);
    expect(store.draft()?.name).toBe('My day out');
    expect(store.draft()?.placeIds).toEqual([]);

    store.addPlaces(['first', 'second'], [place('first'), place('second')]);
    expect(store.renameDraft('')).toBe(true);
    expect(store.movePlace('second', 'up')).toBe(true);
    expect(store.draft()?.placeIds).toEqual(['second', 'first']);
    expect(store.removePlace('first')).toBe(true);
    expect(store.draft()?.placeIds).toEqual(['second']);

    const submittedDraft = store.draft()!;
    store.renameDraft('A newer edit');
    expect(store.clearAfterSuccessfulSave(submittedDraft)).toBe(false);
    expect(store.draft()?.name).toBe('A newer edit');
    expect(JSON.parse(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY) ?? '{}').name).toBe('A newer edit');

    expect(store.clearAfterSuccessfulSave(store.draft()!)).toBe(true);
    expect(store.draft()).toBeNull();
    expect(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY)).toBeNull();
  });

  it('restores a blank editor name as a valid tab draft state', () => {
    sessionStorage.setItem(DRAFT_PLAN_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      cityId: 'utrecht',
      name: '',
      placeIds: [],
      updatedAt: '2026-10-01T10:00:00.000Z',
    }));
    const store = TestBed.inject(DraftPlanStore);

    expect(store.isValidating()).toBe(true);
    expect(store.validatePendingDraft('utrecht', [])).toBe(true);
    expect(store.draft()?.name).toBe('');
  });

  it('restores a valid tab draft only after catalog IDs have been checked', () => {
    sessionStorage.setItem(DRAFT_PLAN_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      cityId: 'amsterdam',
      name: 'Walk',
      placeIds: ['known', 'rotterdam-known', 'stale', 'known'],
      updatedAt: '2026-10-01T10:00:00.000Z',
    }));
    const store = TestBed.inject(DraftPlanStore);

    expect(store.isValidating()).toBe(true);
    expect(store.draft()).toBeNull();
    expect(store.pendingCityId()).toBe('amsterdam');
    expect(store.validatePendingDraft('amsterdam', [place('known'), place('rotterdam-known', 'rotterdam')])).toBe(true);
    expect(store.isValidating()).toBe(false);
    expect(store.draft()?.placeIds).toEqual(['known', 'rotterdam-known']);
    expect(store.draft()?.description).toBe('');
    expect(store.restoreMessage()).toContain('removed from this tab draft');
    expect(JSON.parse(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY) ?? '{}').placeIds).toEqual(['known', 'rotterdam-known']);
  });

  it('restores multiline descriptions without changing the saved text', () => {
    sessionStorage.setItem(DRAFT_PLAN_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1, cityId: 'amsterdam', name: 'My day', description: 'Canals & cafés.\nMeet at 10:00.',
      placeIds: [], updatedAt: '2026-11-14T10:00:00Z',
    }));
    const store = TestBed.inject(DraftPlanStore);
    expect(store.validatePendingDraft('amsterdam', [])).toBe(true);
    expect(store.draft()?.description).toBe('Canals & cafés.\nMeet at 10:00.');
    expect(store.updateDescription('Canals & cafés.\nMeet at 10:00.')).toBe(false);
  });

  it('clears a corrupt or unsupported draft without throwing', () => {
    sessionStorage.setItem(DRAFT_PLAN_STORAGE_KEY, '{not valid json');
    const store = TestBed.inject(DraftPlanStore);

    expect(store.draft()).toBeNull();
    expect(store.isValidating()).toBe(false);
    expect(store.restoreMessage()).toContain('unreadable tab draft was cleared');
    expect(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY)).toBeNull();
  });

  it('clears a draft with an unsupported schema or malformed fields', () => {
    sessionStorage.setItem(DRAFT_PLAN_STORAGE_KEY, JSON.stringify({
      schemaVersion: 2,
      cityId: 'amsterdam',
      name: '',
      placeIds: [null],
      updatedAt: 'not-a-date',
    }));
    const store = TestBed.inject(DraftPlanStore);

    expect(store.draft()).toBeNull();
    expect(store.isValidating()).toBe(false);
    expect(store.restoreMessage()).toContain('invalid tab draft was cleared');
    expect(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY)).toBeNull();
  });

  it('keeps an unverified stored draft pending when its catalog cannot be fetched', () => {
    sessionStorage.setItem(DRAFT_PLAN_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      cityId: 'utrecht',
      name: 'Day out',
      placeIds: ['u1'],
      updatedAt: '2026-10-01T10:00:00.000Z',
    }));
    const store = TestBed.inject(DraftPlanStore);
    store.failValidation('Catalog unavailable');

    expect(store.draft()).toBeNull();
    expect(store.pendingCityId()).toBe('utrecht');
    expect(store.validationError()).toBe('Catalog unavailable');
    expect(store.addPlaces(['a1'], [place('a1')]))
      .toEqual({ status: 'validation-pending' });
  });
});
