import { TestBed } from '@angular/core/testing';
import { ACTIVE_PLAN_STORAGE_KEY, ActivePlanStore } from './active-plan.store';

const FIRST = '614c6654-95e7-4ad6-8fd7-c1fc0b01e95e';
const SECOND = '764c6654-95e7-4ad6-8fd7-c1fc0b01e95e';

describe('ActivePlanStore', () => {
  beforeEach(() => sessionStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY));
  afterEach(() => sessionStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY));

  it('remembers the selected plan across application reloads in the same tab', () => {
    const store = TestBed.inject(ActivePlanStore);
    expect(store.selectedId()).toBeNull();
    store.select(FIRST);
    expect(sessionStorage.getItem(ACTIVE_PLAN_STORAGE_KEY)).toBe(FIRST);
    TestBed.resetTestingModule();
    expect(TestBed.inject(ActivePlanStore).selectedId()).toBe(FIRST);
  });

  it('switches the current plan without storing copies of server data', () => {
    const store = TestBed.inject(ActivePlanStore);
    store.select(FIRST);
    store.select(SECOND);
    expect(store.selectedId()).toBe(SECOND);
    expect(sessionStorage.getItem(ACTIVE_PLAN_STORAGE_KEY)).toBe(SECOND);
  });

  it('clears a removed active plan without clearing a newer selection', () => {
    const store = TestBed.inject(ActivePlanStore);
    store.select(SECOND);
    store.clear(FIRST);
    expect(store.selectedId()).toBe(SECOND);
    store.clear(SECOND);
    expect(store.selectedId()).toBeNull();
    expect(sessionStorage.getItem(ACTIVE_PLAN_STORAGE_KEY)).toBeNull();
  });

  it('rejects malformed stored and requested plan IDs', () => {
    sessionStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, 'invalid');
    const store = TestBed.inject(ActivePlanStore);
    expect(store.selectedId()).toBeNull();
    expect(sessionStorage.getItem(ACTIVE_PLAN_STORAGE_KEY)).toBeNull();
    store.select('../plans');
    expect(store.selectedId()).toBeNull();
  });
});
