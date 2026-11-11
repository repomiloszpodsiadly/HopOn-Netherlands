import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, RouteReuseStrategy, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { PlaceDto } from '../../core/models/catalog.models';
import { PlanResponse } from '../../core/models/plan.models';
import { DRAFT_PLAN_STORAGE_KEY } from '../../core/services/draft-plan.store';
import { routes } from '../../app.routes';
import { PlanDetailsPage } from './plan-details-page';
import { PlansRouteReuseStrategy } from '../../plans-route-reuse.strategy';

const PLAN_ID = '614c6654-95e7-4ad6-8fd7-c1fc0b01e95e';
const FIRST_PLACE_ID = 'amsterdam-node-34050791';
const SECOND_PLACE_ID = 'amsterdam-node-2720969322';
const THIRD_PLACE_ID = 'amsterdam-node-4866454999';

const PLACES: readonly PlaceDto[] = [
  {
    id: FIRST_PLACE_ID,
    cityId: 'amsterdam',
    name: 'Amsterdam Museum',
    category: 'MUSEUMS',
    latitude: 52.37,
    longitude: 4.89,
    tags: ['museum'],
    shortDescription: 'A city museum.',
    imagePath: null,
    imageAttributionId: null,
  },
  {
    id: SECOND_PLACE_ID,
    cityId: 'amsterdam',
    name: 'Museumplein',
    category: 'LANDMARKS',
    latitude: 52.36,
    longitude: 4.88,
    tags: ['public_square'],
    shortDescription: 'A public square.',
    imagePath: null,
    imageAttributionId: null,
  },
  {
    id: THIRD_PLACE_ID,
    cityId: 'amsterdam',
    name: 'Van Gogh Museum',
    category: 'MUSEUMS',
    latitude: 52.36,
    longitude: 4.88,
    tags: ['art_museum'],
    shortDescription: 'A museum of art.',
    imagePath: null,
    imageAttributionId: null,
  },
];

const SAVED_PLAN: PlanResponse = {
  id: PLAN_ID,
  name: 'Museum afternoon',
  cityId: 'amsterdam',
  placeIds: [FIRST_PLACE_ID, SECOND_PLACE_ID],
  createdAt: '2026-11-08T10:00:00Z',
  updatedAt: '2026-11-10T11:00:00Z',
};

async function waitForDialog(harness: RouterTestingHarness, dialogId: string): Promise<HTMLDialogElement | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    harness.detectChanges();
    const dialog = harness.routeNativeElement?.querySelector<HTMLDialogElement>(`#${dialogId}`) ?? null;
    if (dialog?.hasAttribute('open')) {
      return dialog;
    }
  }
  return harness.routeNativeElement?.querySelector<HTMLDialogElement>(`#${dialogId}`) ?? null;
}

function storeSeparateDraft(): string {
  const raw = JSON.stringify({
    schemaVersion: 1,
    cityId: 'utrecht',
    name: 'Utrecht tab draft',
    placeIds: ['utrecht-node-123'],
    updatedAt: '2026-11-10T10:00:00Z',
  });
  sessionStorage.setItem(DRAFT_PLAN_STORAGE_KEY, raw);
  return raw;
}

describe('PlanDetailsPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        { provide: RouteReuseStrategy, useClass: PlansRouteReuseStrategy },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify({ ignoreCancelled: true });
    sessionStorage.removeItem(DRAFT_PLAN_STORAGE_KEY);
  });

  async function startPage(plan: PlanResponse | null = SAVED_PLAN) {
    const harness = await RouterTestingHarness.create(`/plans/${PLAN_ID}`);
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne(`/api/plans/${PLAN_ID}`);
    expect(request.request.method).toBe('GET');
    if (plan === null) {
      request.flush({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'Plan not found.' }, {
        status: 404,
        statusText: 'Not Found',
      });
      await harness.fixture.whenStable();
      harness.detectChanges();
    } else {
      request.flush(plan);
      await harness.fixture.whenStable();
      const catalog = http.expectOne(
        (candidate) => candidate.url === '/api/places' && candidate.params.get('cityId') === plan.cityId,
      );
      catalog.flush(PLACES.filter((place) => place.cityId === plan.cityId));
      await harness.fixture.whenStable();
      harness.detectChanges();
    }
    return {
      harness,
      http,
      component: harness.routeDebugElement!.componentInstance as PlanDetailsPage,
    };
  }

  it('loads authoritative details with real catalog metadata without touching the tab draft', async () => {
    const draft = storeSeparateDraft();
    const { harness, component } = await startPage();

    expect(component.plan()).toEqual(SAVED_PLAN);
    expect(harness.routeNativeElement?.textContent).toContain('Amsterdam Museum');
    expect(harness.routeNativeElement?.textContent).toContain('Museumplein');
    expect(harness.routeNativeElement?.querySelector('time')?.getAttribute('datetime'))
      .toBe(SAVED_PLAN.createdAt);
    expect(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY)).toBe(draft);
  });

  it('shows an ID fallback for a saved place missing from the current catalog', async () => {
    const unavailablePlan = { ...SAVED_PLAN, placeIds: ['removed-osm-place'] };
    const { harness } = await startPage(unavailablePlan);

    expect(harness.routeNativeElement?.textContent).toContain('Place details are unavailable');
    expect(harness.routeNativeElement?.querySelector('code')?.textContent).toBe('removed-osm-place');
  });

  it('sends a complete ordered PUT and reconciles to the server response', async () => {
    const draft = storeSeparateDraft();
    const { harness, component, http } = await startPage();
    const nameInput = harness.routeNativeElement?.querySelector('#saved-plan-name') as HTMLInputElement;
    nameInput.value = 'A reordered Amsterdam day';
    nameInput.dispatchEvent(new Event('input'));
    component.movePlace(FIRST_PLACE_ID, 'down');
    const selector = harness.routeNativeElement?.querySelector('#add-saved-stop') as HTMLSelectElement;
    selector.value = THIRD_PLACE_ID;
    selector.dispatchEvent(new Event('change'));
    harness.detectChanges();
    (harness.routeNativeElement?.querySelector('.details-add-stop button') as HTMLButtonElement).click();
    harness.detectChanges();

    expect(component.placeIds()).toEqual([SECOND_PLACE_ID, FIRST_PLACE_ID, THIRD_PLACE_ID]);
    expect(component.dirty()).toBe(true);
    (harness.routeNativeElement?.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    const request = http.expectOne(`/api/plans/${PLAN_ID}`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      name: 'A reordered Amsterdam day',
      cityId: 'amsterdam',
      placeIds: [SECOND_PLACE_ID, FIRST_PLACE_ID, THIRD_PLACE_ID],
    });
    request.flush({
      ...SAVED_PLAN,
      name: 'A reordered Amsterdam day',
      placeIds: [SECOND_PLACE_ID, FIRST_PLACE_ID, THIRD_PLACE_ID],
      updatedAt: '2026-11-10T12:00:00Z',
    });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.dirty()).toBe(false);
    expect(component.plan()?.updatedAt).toBe('2026-11-10T12:00:00Z');
    expect(component.saveNotice()).toBe('Your changes are saved.');
    expect(sessionStorage.getItem(DRAFT_PLAN_STORAGE_KEY)).toBe(draft);
  });

  it('preserves edits after a failed PUT', async () => {
    const { harness, component, http } = await startPage();
    const input = harness.routeNativeElement?.querySelector('#saved-plan-name') as HTMLInputElement;
    input.value = 'Unsaved better title';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    component.save();
    http.expectOne(`/api/plans/${PLAN_ID}`).flush({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Plan name is invalid.',
    }, { status: 400, statusText: 'Bad Request' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.name()).toBe('Unsaved better title');
    expect(component.dirty()).toBe(true);
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent)
      .toContain('Plan name is invalid.');
  });

  it('shows a not-found state with a route back to the server list after a 404 read', async () => {
    const missing = await startPage(null);
    expect(missing.component.missing()).toBe(true);
    expect(missing.harness.routeNativeElement?.textContent).toContain('This plan could not be found.');
    expect(missing.harness.routeNativeElement?.querySelector('.plans-state a[href="/plans"]')?.textContent)
      .toContain('Back to Saved Plans');
  });

  it('keeps an edit after PUT 404 and marks the saved record as stale', async () => {
    const { harness, component, http } = await startPage();
    component.name.set('Keep my edit');
    component.save();
    http.expectOne(`/api/plans/${PLAN_ID}`).flush({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Plan not found.',
    }, { status: 404, statusText: 'Not Found' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.missing()).toBe(true);
    expect(component.name()).toBe('Keep my edit');
    expect(harness.routeNativeElement?.textContent).toContain('This plan no longer exists.');
    expect(harness.routeNativeElement?.querySelector('a[href="/plans"]')).toBeTruthy();
  });

  it('asks before leaving dirty edits and lets the user stay', async () => {
    const { harness, component, http } = await startPage();
    component.name.set('Unsaved title');
    expect(component.dirty()).toBe(true);
    const guard = vi.spyOn(component, 'confirmNavigationAway');
    const navigation = TestBed.inject(Router).navigateByUrl('/plans');
    const dialog = await waitForDialog(harness, 'discard-plan-edits');
    expect(guard).toHaveBeenCalled();

    expect(dialog?.hasAttribute('open')).toBe(true);
    (dialog?.querySelector('button') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(await navigation).toBe(false);
    expect(TestBed.inject(Router).url).toBe(`/plans/${PLAN_ID}`);
    http.expectNone('/api/plans');
  });

  it('allows an explicit discard and completes the guarded navigation', async () => {
    const { harness, component, http } = await startPage();
    component.name.set('Unsaved title');
    expect(component.dirty()).toBe(true);
    const navigation = TestBed.inject(Router).navigateByUrl('/plans');
    await waitForDialog(harness, 'discard-plan-edits');

    const discard = harness.routeNativeElement?.querySelector<HTMLButtonElement>(
      '#discard-plan-edits button.confirm-dialog__button--confirm',
    );
    discard?.click();
    expect(await navigation).toBe(true);
    const listRequest = http.expectOne('/api/plans');
    listRequest.flush([]);
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/plans');
  });

  it('guards a route change from one plan ID to another', async () => {
    const { harness, component } = await startPage();
    component.name.set('Unsaved title');
    const navigation = TestBed.inject(Router).navigateByUrl('/plans/764c6654-95e7-4ad6-8fd7-c1fc0b01e95e');
    const dialog = await waitForDialog(harness, 'discard-plan-edits');

    expect(dialog?.hasAttribute('open')).toBe(true);
    dialog?.querySelector<HTMLButtonElement>('.confirm-dialog__button--quiet')?.click();
    expect(await navigation).toBe(false);
    expect(TestBed.inject(Router).url).toBe(`/plans/${PLAN_ID}`);
  });

  it('supports delete cancel and Escape while restoring focus to the opener', async () => {
    const { harness, http } = await startPage();
    const opener = harness.routeNativeElement?.querySelector<HTMLButtonElement>('.plans-button--danger');
    opener?.focus();
    opener?.click();
    await Promise.resolve();
    harness.detectChanges();
    const dialog = harness.routeNativeElement?.querySelector<HTMLDialogElement>('#delete-plan-confirmation');
    expect(dialog?.hasAttribute('open')).toBe(true);
    const cancel = dialog?.querySelector<HTMLButtonElement>('.confirm-dialog__button--quiet');
    expect(document.activeElement).toBe(cancel);

    cancel?.click();
    await Promise.resolve();
    harness.detectChanges();
    expect(dialog?.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(opener);

    opener?.click();
    await Promise.resolve();
    harness.detectChanges();
    const confirm = dialog?.querySelector<HTMLButtonElement>('.confirm-dialog__button--confirm');
    confirm?.focus();
    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cancel);

    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await Promise.resolve();
    harness.detectChanges();
    expect(dialog?.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(opener);
    http.expectNone(`/api/plans/${PLAN_ID}`);
  });

  it('deletes once after confirmation, waits for 204, then refetches the list', async () => {
    const { harness, http } = await startPage();
    (harness.routeNativeElement?.querySelector('.plans-button--danger') as HTMLButtonElement).click();
    harness.detectChanges();
    const confirm = harness.routeNativeElement?.querySelector<HTMLButtonElement>(
      '#delete-plan-confirmation .confirm-dialog__button--confirm',
    );
    confirm?.click();
    const request = http.expectOne(`/api/plans/${PLAN_ID}`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/plans');
    const list = http.expectOne('/api/plans');
    list.flush([]);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('Your plan book is ready.');
  });

  it('keeps the details visible and reports a delete failure without navigating', async () => {
    const { harness, http } = await startPage();
    (harness.routeNativeElement?.querySelector('.plans-button--danger') as HTMLButtonElement).click();
    harness.detectChanges();
    (harness.routeNativeElement?.querySelector(
      '#delete-plan-confirmation .confirm-dialog__button--confirm',
    ) as HTMLButtonElement).click();
    http.expectOne(`/api/plans/${PLAN_ID}`).flush({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'Delete could not be completed.',
    }, { status: 500, statusText: 'Internal Server Error' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe(`/plans/${PLAN_ID}`);
    expect(harness.routeNativeElement?.textContent).toContain('Delete could not be completed.');
    expect(harness.routeNativeElement?.querySelector('#delete-plan-confirmation[open]')).toBeTruthy();
  });

  it('treats DELETE 404 as an already-removed saved plan', async () => {
    const { harness, component, http } = await startPage();
    (harness.routeNativeElement?.querySelector('.plans-button--danger') as HTMLButtonElement).click();
    harness.detectChanges();
    (harness.routeNativeElement?.querySelector(
      '#delete-plan-confirmation .confirm-dialog__button--confirm',
    ) as HTMLButtonElement).click();
    http.expectOne(`/api/plans/${PLAN_ID}`).flush({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Plan not found.',
    }, { status: 404, statusText: 'Not Found' });
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(component.missing()).toBe(true);
    expect(harness.routeNativeElement?.textContent).toContain('This plan was already removed.');
    expect(harness.routeNativeElement?.querySelector('#delete-plan-confirmation[open]')).toBeNull();
  });
});
