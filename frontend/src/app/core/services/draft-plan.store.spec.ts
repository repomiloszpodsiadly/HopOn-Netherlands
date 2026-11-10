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

  it('adds only verified current-city IDs, preserves order, and deduplicates repeated adds', () => {
    const store = TestBed.inject(DraftPlanStore);
    const catalog = [place('first'), place('second')];

    expect(store.addPlaces('amsterdam', 'Amsterdam', ['first', 'first', 'unknown'], catalog))
      .toEqual({ status: 'added', addedCount: 1, alreadyPresentCount: 0 });
    expect(store.addPlaces('amsterdam', 'Amsterdam', ['first'], catalog))
      .toEqual({ status: 'already-added' });
    expect(store.addPlaces('amsterdam', 'Amsterdam', ['first', 'second'], catalog))
      .toEqual({ status: 'added', addedCount: 1, alreadyPresentCount: 1 });

    expect(store.draft()?.placeIds).toEqual(['first', 'second']);
    expect(JSON.parse(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY) ?? '{}')).toMatchObject({
      schemaVersion: 1,
      cityId: 'amsterdam',
      name: 'Amsterdam plan',
      placeIds: ['first', 'second'],
    });
    expect(store.draft()?.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('requires an explicit keep or replace decision before crossing cities', () => {
    const store = TestBed.inject(DraftPlanStore);
    store.addPlaces('amsterdam', 'Amsterdam', ['a1'], [place('a1')]);

    expect(store.addPlaces('rotterdam', 'Rotterdam', ['r1'], [place('r1', 'rotterdam')]))
      .toEqual({ status: 'city-conflict' });
    expect(store.draft()?.cityId).toBe('amsterdam');
    expect(store.cityConflict()).toMatchObject({ cityId: 'rotterdam', placeIds: ['r1'] });
    store.keepExistingDraft();
    expect(store.draft()?.placeIds).toEqual(['a1']);

    store.addPlaces('rotterdam', 'Rotterdam', ['r1'], [place('r1', 'rotterdam')]);
    expect(store.startDraftForRequestedCity()).toBe(true);
    expect(store.draft()).toMatchObject({ cityId: 'rotterdam', placeIds: ['r1'] });
  });

  it('restores a valid tab draft only after catalog IDs have been checked', () => {
    sessionStorage.setItem(DRAFT_PLAN_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      cityId: 'amsterdam',
      name: 'Walk',
      placeIds: ['known', 'stale', 'known'],
      updatedAt: '2026-10-01T10:00:00.000Z',
    }));
    const store = TestBed.inject(DraftPlanStore);

    expect(store.isValidating()).toBe(true);
    expect(store.draft()).toBeNull();
    expect(store.pendingCityId()).toBe('amsterdam');
    expect(store.validatePendingDraft('amsterdam', [place('known')])).toBe(true);
    expect(store.isValidating()).toBe(false);
    expect(store.draft()?.placeIds).toEqual(['known']);
    expect(store.restoreMessage()).toContain('removed from this tab draft');
    expect(JSON.parse(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY) ?? '{}').placeIds).toEqual(['known']);
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
    expect(store.addPlaces('amsterdam', 'Amsterdam', ['a1'], [place('a1')]))
      .toEqual({ status: 'validation-pending' });
  });
});
