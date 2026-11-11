import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { PlanResponse } from '../../core/models/plan.models';
import { routes } from '../../app.routes';
import { PlansListPage } from './plans-list-page';

const NEWER_PLAN: PlanResponse = {
  id: '614c6654-95e7-4ad6-8fd7-c1fc0b01e95e',
  name: 'Rotterdam by the water',
  cityId: 'rotterdam',
  placeIds: ['rotterdam-node-2671299642', 'rotterdam-way-123456789'],
  createdAt: '2026-11-09T08:15:00Z',
  updatedAt: '2026-11-10T12:00:00Z',
};

const OLDER_PLAN: PlanResponse = {
  id: '764c6654-95e7-4ad6-8fd7-c1fc0b01e95e',
  name: 'Amsterdam afternoon',
  cityId: 'amsterdam',
  placeIds: ['amsterdam-node-34050791'],
  createdAt: '2026-11-08T09:00:00Z',
  updatedAt: '2026-11-09T11:30:00Z',
};

describe('PlansListPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes)],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify({ ignoreCancelled: true }));

  async function startPage() {
    const harness = await RouterTestingHarness.create('/plans');
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne('/api/plans');
    expect(request.request.method).toBe('GET');
    return {
      harness,
      http,
      request,
      component: harness.routeDebugElement!.componentInstance as PlansListPage,
    };
  }

  it('renders server ordering, city, place count and truthful date values', async () => {
    const { harness, component, request, http } = await startPage();
    expect(component.loading()).toBe(true);
    request.flush([NEWER_PLAN, OLDER_PLAN]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const cards = Array.from(harness.routeNativeElement?.querySelectorAll('.saved-plan-card') ?? []);
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Rotterdam by the water');
    expect(cards[0].textContent).toContain('Rotterdam');
    expect(cards[0].textContent).toContain('2 places');
    expect(cards[1].textContent).toContain('Amsterdam afternoon');
    expect(cards[1].textContent).toContain('1 place');
    expect(cards[0].querySelector('time')?.getAttribute('datetime')).toBe(NEWER_PLAN.createdAt);
    expect(harness.routeNativeElement?.querySelector('nav[aria-label="Main navigation"] a[href="/plans"]')
      ?.getAttribute('aria-current')).toBe('page');
    expect(component.plans()).toEqual([NEWER_PLAN, OLDER_PLAN]);
    http.expectNone('/api/plans/');
  });

  it('shows an empty state with a create action when the backend has no plans', async () => {
    const { harness, request } = await startPage();
    request.flush([]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.textContent).toContain('Your plan book is ready.');
    expect(harness.routeNativeElement?.querySelector('.plans-empty a[href="/plans/new"]')?.textContent)
      .toContain('Start your first plan');
  });

  it('shows an actionable load error and retries GET /api/plans', async () => {
    const { harness, request, http } = await startPage();
    request.flush({ status: 503, detail: 'Plans are temporarily unavailable.' }, {
      status: 503,
      statusText: 'Unavailable',
    });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent)
      .toContain('Plans are temporarily unavailable.');

    (harness.routeNativeElement?.querySelector('button') as HTMLButtonElement).click();
    const retry = http.expectOne('/api/plans');
    retry.flush([NEWER_PLAN]);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('Rotterdam by the water');
  });

  it('cancels a stale list read when the user retries before it completes', async () => {
    const { harness, component, request, http } = await startPage();
    component.retry();
    const retry = http.expectOne('/api/plans');
    expect(request.cancelled).toBe(true);
    retry.flush([OLDER_PLAN]);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.plans()).toEqual([OLDER_PLAN]);
    expect(harness.routeNativeElement?.textContent).toContain('Amsterdam afternoon');
  });
});
