import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  prepareExplorePage,
  assertRealViewportGeometry,
  seedTabDraft,
  cleanupCreatedPlans,
  planIdFromLocation,
  getActualPlaces,
  openExplorePlaceByName,
  addExplorePlaceByName,
  trackAutosavedPlans,
  isPlansListRead,
  deletePlanThroughUi,
  openFreeMapStyleUrl,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareExplorePage(page);
});

test('completes real H2 CRUD from Explore while OpenFreeMap is unavailable', async ({ page }) => {
  test.setTimeout(90_000);
  const owned: string[] = [];
  let failed = false;
  trackAutosavedPlans(page, owned);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.unroute(openFreeMapStyleUrl);
    await page.route(openFreeMapStyleUrl, route => route.fulfill({ status: 503, body: 'Map unavailable' }));
    const before = await (await page.request.get('/api/plans')).json() as { id: string }[];
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Map unavailable', exact: true })).toBeVisible({ timeout: 15_000 });
    for (const name of ['Royal Palace', 'Erasmus Bridge', 'Dom Tower']) await addExplorePlaceByName(page, name);
    const id = await page.evaluate(() => sessionStorage.getItem('hopon:active-plan:v1'));
    expect(id).toBeTruthy();
    await page.getByRole('link', { name: 'Review current plan', exact: true }).click();
    await expect(page.locator('.details-stop')).toHaveCount(3);
    const renamed = 'Map outage day ' + randomUUID().slice(0, 8);
    await page.locator('#saved-plan-name').fill(renamed);
    await page.getByRole('button', { name: 'Move Dom Tower up', exact: true }).click();
    const update = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/plans/' + id);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await update).status()).toBe(200);
    await page.reload();
    await expect(page.locator('#saved-plan-name')).toHaveValue(renamed);
    const rows = page.locator('.details-stop__copy');
    for (const [index, name] of ['Royal Palace', 'Dom Tower', 'Erasmus Bridge'].entries()) await expect(rows.nth(index)).toContainText(name);
    await deletePlanThroughUi(page);
    const after = await (await page.request.get('/api/plans')).json() as { id: string }[];
    expect(after.map(plan => plan.id)).toEqual(expect.arrayContaining(before.map(plan => plan.id)));
    expect(after.some(plan => plan.id === id)).toBe(false);
  } catch (error) { failed = true; throw error; }
  finally { await cleanupCreatedPlans(page, owned, failed); }
});

test('adds places from all three cities to one automatically saved plan', async ({ page }) => {
  test.setTimeout(60_000);
  const owned: string[] = [];
  let failed = false;
  trackAutosavedPlans(page, owned);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    for (const name of ['Royal Palace', 'Erasmus Bridge', 'Dom Tower']) await addExplorePlaceByName(page, name);
    expect(await page.evaluate(() => sessionStorage.getItem('hopon:active-plan:v1'))).toBeTruthy();
    expect(await page.evaluate(() => sessionStorage.getItem('hopon:draft:v1'))).toBeNull();
    await page.getByRole('link', { name: 'Review current plan', exact: true }).click();
    await expect(page.locator('.details-stop')).toHaveCount(3);
    for (const city of ['Amsterdam', 'Rotterdam', 'Utrecht']) await expect(page.locator('.details-stop__copy small').filter({ hasText: city })).toHaveCount(1);
    await deletePlanThroughUi(page);
  } catch (error) { failed = true; throw error; }
  finally { await cleanupCreatedPlans(page, owned, failed); }
});

test('keeps maximum-length plan names aligned in cards and the current plan banner', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const plans = ['W'.repeat(30), 'My day out', 'A'.repeat(30), 'A quiet afternoon', 'Rotterdam walk', 'Utrecht day'].map((name, index) => ({
    id: randomUUID(), name, description: '', cityId: index % 2 === 0 ? 'amsterdam' : 'rotterdam',
    placeIds: ['amsterdam-relation-3580875'], createdAt: '2026-11-14T10:00:00Z', updatedAt: '2026-11-14T10:00:00Z',
  }));
  await page.route('**/api/plans', route => route.fulfill({ json: plans }));
  for (const plan of plans) await page.route(`**/api/plans/${plan.id}`, route => route.fulfill({ json: plan }));
  await page.goto('/plans/new?city=amsterdam');
  await expect(page.locator('#plan-name')).toHaveAttribute('maxlength', '30');
  await expect(page.locator('#plan-description')).toHaveAttribute('maxlength', '500');
  await page.locator('#plan-name').fill('n'.repeat(31));
  await page.locator('#plan-description').fill('d'.repeat(501));
  await expect(page.locator('#plan-name')).toHaveValue('n'.repeat(30));
  await expect(page.locator('#plan-description')).toHaveValue('d'.repeat(500));
  await expect(page.locator('label[for="plan-description"] small')).toHaveText('500 / 500');
  await expect(page.locator('label[for="plan-description"]')).not.toContainText('Optional');
  await expect(page.locator('.editor-validation')).toHaveCount(0);

  for (const viewport of [
    { width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1024, height: 768 },
    { width: 390, height: 844 }, { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/plans');
    const cards = page.locator('.saved-plan-card');
    await expect(cards).toHaveCount(6);
    for (let index = 0; index < 2; index++) {
      const card = cards.nth(index);
      const title = card.locator('h2');
      await expect(title).toHaveAttribute('title', plans[index].name);
      expect(await title.evaluate(element => element.clientHeight <= parseFloat(getComputedStyle(element).lineHeight) * 2 + 1)).toBe(true);
      const cardBox = (await card.boundingBox())!;
      const cover = (await card.locator('.saved-plan-card__cover').boundingBox())!;
      const dates = (await card.locator('.saved-plan-card__dates').boundingBox())!;
      expect(cover.y + cover.height).toBeLessThanOrEqual(dates.y + 1);
      expect(dates.y + dates.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
    }
    if (viewport.width > 600) {
      const first = (await cards.nth(0).locator('.saved-plan-card__dates').boundingBox())!;
      const second = (await cards.nth(1).locator('.saved-plan-card__dates').boundingBox())!;
      expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if ([1440, 390].includes(viewport.width)) await page.screenshot({ path: testInfo.outputPath(`name-limit-cards-${viewport.width}.png`) });
    await page.evaluate(id => sessionStorage.setItem('hopon:active-plan:v1', id), plans[0].id);
    await page.goto('/');
    const panel = page.locator('.draft-panel');
    await expect(panel.locator('h2')).toHaveText(plans[0].name);
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const title = (await panel.locator('h2').boundingBox())!;
    if (viewport.width > 1100) {
      const actions = (await panel.locator('.draft-panel__actions').boundingBox())!;
      expect(title.x + title.width).toBeLessThanOrEqual(actions.x);
    }
    await expect(page.getByRole('link', { name: 'Review current plan', exact: true })).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if ([1440, 390].includes(viewport.width)) await page.screenshot({ path: testInfo.outputPath(`name-limit-banner-${viewport.width}.png`) });
    await page.goto(`/plans/${plans[0].id}`);
    await expect(page.locator('#saved-plan-name')).toHaveAttribute('maxlength', '30');
    await expect(page.locator('#saved-plan-description')).toHaveAttribute('maxlength', '500');
    await expect(page.locator('label[for="saved-plan-description"]')).not.toContainText('Optional');
    await expect(page.locator('.details-validation')).toHaveCount(0);
  }
});

test('keeps plan confirmation and Explore controls clear across screen sizes', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const plan = {
    id: randomUUID(), name: 'A day to remember', description: 'Original notes', cityId: 'amsterdam',
    placeIds: [], createdAt: '2026-11-14T10:00:00Z', updatedAt: '2026-11-14T10:00:00Z',
  };
  await page.route('**/api/plans', route => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: [plan] });
  });
  await page.route(`**/api/plans/${plan.id}`, route => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: plan });
  });
  await page.goto('/plans');
  await seedTabDraft(page, { cityId: 'amsterdam', name: 'My day out', placeIds: [], updatedAt: plan.updatedAt });

  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1280, height: 720 },
    { width: 390, height: 844 }, { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const review = page.getByRole('link', { name: 'Review current plan', exact: true });
    await expect(review).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Browse freely', exact: true })).toHaveCount(0);
    const savedPlansLink = page.locator('.saved-plans-link');
    if (await savedPlansLink.isVisible()) {
      await savedPlansLink.hover();
      await expect(savedPlansLink).toHaveCSS('background-color', 'rgb(246, 237, 223)');
      const arrow = (await savedPlansLink.locator('span').boundingBox())!;
      const icon = (await savedPlansLink.locator('span svg').boundingBox())!;
      expect(Math.abs(arrow.y + arrow.height / 2 - icon.y - icon.height / 2)).toBeLessThanOrEqual(1);
    }
    const architecture = page.locator('.category-panel').getByRole('button', { name: 'Architecture', exact: true });
    await architecture.click();
    await expect(architecture).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.category-panel').getByRole('button', { name: 'Clear filters', exact: true })).toHaveCount(0);
    await page.locator('.category-panel').getByRole('button', { name: 'All', exact: true }).click();
    await review.scrollIntoViewIfNeeded();
    const count = page.locator('.draft-count');
    await expect(count).toHaveText('0 stops');
    const countBox = (await count.boundingBox())!;
    const reviewBox = (await review.boundingBox())!;
    expect(Math.abs(countBox.y + countBox.height / 2 - reviewBox.y - reviewBox.height / 2)).toBeLessThanOrEqual(1);
    const arrowBox = (await review.locator('span').boundingBox())!;
    const iconBox = (await review.locator('svg').boundingBox())!;
    expect(Math.abs(arrowBox.x + arrowBox.width / 2 - iconBox.x - iconBox.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(arrowBox.y + arrowBox.height / 2 - iconBox.y - iconBox.height / 2)).toBeLessThanOrEqual(1);
    await expect(page.getByText('Choose places now, or save your plan for later.', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`explore-actions-${viewport.width}.png`) });

    const cardArrow = page.locator('.place-card__arrow').first();
    if (await cardArrow.isVisible()) {
      const circle = (await cardArrow.boundingBox())!;
      const icon = (await cardArrow.locator('svg').boundingBox())!;
      expect(Math.abs(circle.y + circle.height / 2 - icon.y - icon.height / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(circle.x + circle.width / 2 - icon.x - icon.width / 2)).toBeLessThanOrEqual(1);
    }
    await openExplorePlaceByName(page, 'Royal Palace');
    const credit = page.locator('.place-detail__credit');
    await expect(credit.locator('.place-detail__credit-content')).toBeHidden();
    await expect(page.locator('.place-detail')).not.toContainText('Used the Commons');
    await page.screenshot({ path: testInfo.outputPath(`photo-detail-${viewport.width}.png`) });
    await credit.locator('summary').click();
    await expect(credit.getByRole('link', { name: 'Photo by Elekes Andor' })).toBeVisible();
    await expect(credit.getByRole('link', { name: 'CC BY-SA 4.0' })).toBeVisible();
    await expect(credit).toContainText('Resized and re-encoded from the source; displayed with a crop.');
    await page.keyboard.press('Escape');

    await page.goto('/plans/new?city=amsterdam');
    await expect(page.getByText('Places can wait. Your plan is ready to save.', { exact: true })).toHaveCount(0);
    await expect(page.locator('.plan-editor-heading .plans-intro')).toHaveCount(0);
    await page.goto(`/plans/${plan.id}`);
    await page.locator('#saved-plan-description').fill('New notes still being edited');
    const back = page.locator('.plan-details-heading .plan-back-link');
    await back.click();
    const dialog = page.locator('#discard-plan-edits');
    await expect(dialog.getByRole('heading', { name: 'Unsaved changes', exact: true })).toBeVisible();
    const keepEditing = dialog.getByRole('button', { name: 'Keep editing', exact: true });
    const leave = dialog.getByRole('button', { name: 'Leave without saving', exact: true });
    await expect(keepEditing).toBeFocused();
    await expect(leave).toBeInViewport();
    expect(await page.locator('app-confirm-dialog').last().getAttribute('title')).toBeNull();
    for (const button of [keepEditing, leave]) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await page.screenshot({ path: testInfo.outputPath(`unsaved-dialog-${viewport.width}.png`) });
    await page.keyboard.press('Shift+Tab');
    await expect(leave).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#saved-plan-description')).toHaveValue('New notes still being edited');
    await back.click();
    await leave.click();
    await expect(page).toHaveURL('/plans');
    await expect(page.locator('.plans-list-shell footer')).toHaveCount(0);
    await expect(page.getByRole('link', { name: `Open ${plan.name} in Amsterdam`, exact: true })).toBeVisible();
    const savedCardArrow = page.locator('.saved-plan-card__arrow').first();
    const circle = (await savedCardArrow.boundingBox())!;
    const icon = (await savedCardArrow.locator('svg').boundingBox())!;
    expect(Math.abs(circle.x + circle.width / 2 - icon.x - icon.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(circle.y + circle.height / 2 - icon.y - icon.height / 2)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`saved-plans-${viewport.width}.png`) });
  }
});

test('opens the current plan map from the stops panel on desktop and mobile', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const planId = randomUUID();
  let plan = {
    id: planId,
    name: 'A day across the map',
    description: 'Keep these notes when adding places.',
    cityId: 'amsterdam',
    placeIds: [] as string[],
    createdAt: '2026-11-14T10:00:00Z',
    updatedAt: '2026-11-14T10:00:00Z',
  };
  await page.route(`**/api/plans/${planId}`, async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        name: string; description: string; cityId: string; placeIds: string[];
      };
      expect(body.name).toBe(plan.name);
      expect(body.description).toBe(plan.description);
      expect(body.cityId).toBe('amsterdam');
      plan = { ...plan, placeIds: body.placeIds };
    } else {
      expect(route.request().method()).toBe('GET');
    }
    await route.fulfill({ json: plan });
  });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    plan = { ...plan, placeIds: [] };
    await page.setViewportSize(viewport);
    await page.goto(`/plans/${planId}`);
    const exploreMap = page.locator('.details-stops').getByRole('button', { name: 'Explore map', exact: true });
    const save = page.getByRole('button', { name: 'Save changes', exact: true });
    const usePlan = page.locator('.details-form-actions').getByRole('button', { name: 'Use this plan', exact: true });
    await expect(usePlan).toBeEnabled();
    await expect(page.locator('.details-city-label')).toHaveCount(0);
    await expect(exploreMap).toBeEnabled();
    const globe = exploreMap.locator('img');
    await expect.poll(() => globe.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await exploreMap.scrollIntoViewIfNeeded();
    const mapBounds = (await exploreMap.boundingBox())!;
    const headingBounds = (await page.locator('.details-section-heading').boundingBox())!;
    expect(mapBounds.y).toBeGreaterThanOrEqual(headingBounds.y);
    expect(mapBounds.y + mapBounds.height).toBeLessThanOrEqual(headingBounds.y + headingBounds.height + 1);
    await usePlan.scrollIntoViewIfNeeded();
    const keepBounds = (await usePlan.boundingBox())!;
    const saveBounds = (await save.boundingBox())!;
    expect(Math.abs(keepBounds.y - saveBounds.y)).toBeLessThanOrEqual(1);
    expect(keepBounds.x).toBeGreaterThan(saveBounds.x);
    const dates = page.locator('.details-form-actions .plan-details-meta');
    await expect(dates.locator('time')).toHaveCount(2);
    if (viewport.width >= 1000) {
      const datesBox = (await dates.boundingBox())!;
      const actionsBox = (await page.locator('.details-form-actions').boundingBox())!;
      expect(datesBox.y - actionsBox.y).toBeLessThanOrEqual(8);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`saved-plan-map-button-${viewport.width}.png`) });

    await exploreMap.click();
    await expect(page).toHaveURL(`/?plan=${planId}#map-region`);
    await expect(page.locator('#map-region')).toBeFocused();
    await expect(page.locator('.draft-panel')).toContainText(plan.name);
    for (const [index, name] of ['Erasmus Bridge', 'Dom Tower'].entries()) {
      await openExplorePlaceByName(page, name);
      const updatedResponse = page.waitForResponse(response =>
        response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/plans/${planId}`);
      await page.locator('.place-detail').getByRole('button', { name: 'Add to saved plan', exact: true }).click();
      expect((await updatedResponse).status()).toBe(200);
      await expect(page.locator('.draft-count')).toHaveText(`${index + 1} / 12`);
      await expect(page.locator('.draft-feedback')).toContainText(`Added 1 place to ${plan.name}`);
    }
    expect(plan.placeIds).toHaveLength(2);
    await page.keyboard.press('Escape');
    if (viewport.width < 760) {
      await page.locator('.bottom-nav').getByRole('link', { name: 'Map', exact: true }).click();
      await expect(page).toHaveURL(`/?plan=${planId}#map-region`);
      await expect(page.locator('.draft-panel')).toContainText(plan.name);
    }
    await page.getByRole('link', { name: 'Review current plan', exact: true }).click();
    await expect(page).toHaveURL(`/plans/${planId}`);
    await expect(page.locator('#saved-plan-description')).toHaveValue(plan.description);
    await expect(page.locator('.details-stop')).toHaveCount(2);
    await expect(page.locator('.details-stop').first()).toContainText('Rotterdam');
    await expect(page.locator('.details-stop').last()).toContainText('Utrecht');
    const selectedPlaceIds = [...plan.placeIds];
    await expect(exploreMap).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`saved-plan-map-populated-${viewport.width}.png`) });
    await exploreMap.click();
    await expect(page).toHaveURL(`/?plan=${planId}#map-region`);
    await expect(page.locator('.draft-panel')).toContainText('2 / 12');
    await page.getByRole('link', { name: 'Review current plan', exact: true }).click();
    await expect(page.locator('.details-stop')).toHaveCount(2);
    expect(plan.placeIds).toEqual(selectedPlaceIds);
    await usePlan.click();
    await expect(page).toHaveURL(`/?plan=${planId}#map-region`);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Review current plan', exact: true })).toHaveAttribute('href', `/plans/${planId}`);
    await page.reload();
    await expect(page.locator('.draft-panel')).toContainText(plan.name);
    expect(plan.placeIds).toEqual(selectedPlaceIds);
  }
});

test('autosaves map additions and allocates numbered names without a manual save', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const owned: string[] = [];
  let failed = false;
  try {
    const initial = await (await page.request.get('/api/plans')).json() as { name: string }[];
    const names = new Set(initial.map(plan => plan.name.toLowerCase()));
    const availableName = () => {
      let name = 'My day out';
      for (let index = 1; names.has(name.toLowerCase()); index++) name = `My day out-${index}`;
      names.add(name.toLowerCase());
      return name;
    };
    for (const [index, place] of ['Royal Palace', 'Dom Tower'].entries()) {
      await page.goto('/plans/new?city=amsterdam');
      await expect(page.locator('#plan-name')).toHaveValue('My day out');
      await page.locator('.editor-cancel').click();
      await openExplorePlaceByName(page, place);
      const pending = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname.endsWith('/autosave'));
      await page.locator('.place-detail').getByRole('button', { name: 'Add to plan', exact: true }).click();
      const response = await pending;
      expect(response.status()).toBe(200);
      const saved = await response.json() as { id: string; name: string; placeIds: string[] };
      owned.push(saved.id);
      expect(saved.name).toBe(availableName());
      await expect(page.getByRole('link', { name: 'Review current plan', exact: true })).toHaveAttribute('href', `/plans/${saved.id}`);
      expect(await page.evaluate(() => sessionStorage.getItem('hopon:draft:v1'))).toBeNull();
      expect(await page.evaluate(() => sessionStorage.getItem('hopon:active-plan:v1'))).toBe(saved.id);
      if (index === 0) {
        await openExplorePlaceByName(page, 'Erasmus Bridge');
        const updated = page.waitForResponse(response => response.request().method() === 'PUT'
          && new URL(response.url()).pathname === `/api/plans/${saved.id}`);
        await page.locator('.place-detail').getByRole('button', { name: 'Add to saved plan', exact: true }).click();
        expect((await updated).status()).toBe(200);
        await expect(page.locator('.draft-count')).toHaveText('2 / 12');
      }
      await page.reload();
      await expect(page.getByRole('link', { name: 'Review current plan', exact: true })).toHaveAttribute('href', `/plans/${saved.id}`);
      await page.getByRole('link', { name: 'Review current plan', exact: true }).click();
      await expect(page.locator('.details-stop')).toHaveCount(index === 0 ? 2 : 1);
      await page.screenshot({ path: testInfo.outputPath(`autosaved-plan-${index}.png`) });
    }
  } catch (error) { failed = true; throw error; }
  finally { await cleanupCreatedPlans(page, owned, failed); }
});

test('explains six-plan capacity, permits updates and resumes autosave after a slot is freed', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const owned: string[] = [];
  let failed = false;
  try {
    const initial = await (await page.request.get('/api/plans')).json() as { id: string }[];
    expect(initial.length).toBeLessThan(6);
    for (let count = initial.length; count < 6; count++) {
      const response = await page.request.post('/api/plans', { data: {
        name: `Capacity check ${randomUUID().slice(0, 8)}`, description: '', cityId: 'amsterdam', placeIds: [],
      } });
      expect(response.status()).toBe(201);
      owned.push((await response.json() as { id: string }).id);
    }
    await page.goto('/plans');
    await expect(page.getByRole('button', { name: '6 / 6 plans', exact: true })).toBeDisabled();
    await expect(page.locator('#plan-capacity-message')).toContainText('use an existing plan, or delete one');
    await page.goto(`/plans/${owned[0]}`);
    await page.getByRole('button', { name: 'Use this plan', exact: true }).click();
    await openExplorePlaceByName(page, 'Erasmus Bridge');
    const update = page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/plans/${owned[0]}`);
    await page.locator('.place-detail').getByRole('button', { name: 'Add to saved plan', exact: true }).click();
    expect((await update).status()).toBe(200);
    await expect(page.locator('.draft-count')).toHaveText('1 / 12');

    await page.goto('/plans/new?city=amsterdam');
    const manual = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/plans');
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    expect((await manual).status()).toBe(409);
    await expect(page.locator('.editor-state--error')).toContainText('Use an existing plan or delete one');
    await page.locator('.editor-cancel').click();
    await openExplorePlaceByName(page, 'Dom Tower');
    const blocked = page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname.endsWith('/autosave'));
    await page.locator('.place-detail').getByRole('button', { name: 'Add to plan', exact: true }).click();
    expect((await blocked).status()).toBe(409);
    await expect(page.locator('.autosave-feedback')).toContainText('6 of 6 saved plans');
    await expect(page.locator('.autosave-feedback').getByRole('link', { name: 'Use or delete a saved plan', exact: true })).toHaveAttribute('href', '/plans');
    const pendingId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('hopon:draft:v1')!).autosaveId as string);
    owned.push(pendingId);
    expect((await (await page.request.get('/api/plans')).json()).length).toBe(6);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.autosave-feedback').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('six-plan-limit-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect((await page.request.delete(`/api/plans/${owned[0]}`)).status()).toBe(204);
    const retried = page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/plans/${pendingId}/autosave`);
    await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
    expect((await retried).status()).toBe(200);
    await expect(page.getByRole('link', { name: 'Review current plan', exact: true })).toHaveAttribute('href', `/plans/${pendingId}`);
    expect((await (await page.request.get('/api/plans')).json()).length).toBe(6);
  } catch (error) { failed = true; throw error; }
  finally { await cleanupCreatedPlans(page, owned, failed); }
});

test('uses the current plan across all three cities with the real API', async ({ page }) => {
  test.setTimeout(90_000);
  const ids: string[] = [];
  let testFailed = false;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/plans/new?city=amsterdam');
    const name = `Current plan ${randomUUID().slice(0, 8)}`;
    await page.locator('#plan-name').fill(name);
    await page.locator('#plan-description').fill('Keep these notes across all three cities.');
    await page.locator('.editor-cancel').click();
    const review = page.getByRole('link', { name: 'Review current plan', exact: true });
    await expect(review).toHaveAttribute('href', '/plans/new?city=amsterdam');
    await review.click();
    const createdResponse = page.waitForResponse(response =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/plans');
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    const response = await createdResponse;
    expect(response.status()).toBe(201);
    const created = await response.json() as { id: string; description: string };
    ids.push(created.id);
    await expect(page).toHaveURL(`/plans/${created.id}`);
    expect(await page.evaluate(() => sessionStorage.getItem('hopon:active-plan:v1'))).toBe(created.id);
    const alternateResponse = await page.request.post('/api/plans', {
      data: { name: `Another plan ${randomUUID().slice(0, 8)}`, description: '', cityId: 'rotterdam', placeIds: [] },
    });
    expect(alternateResponse.status()).toBe(201);
    const alternate = await alternateResponse.json() as { id: string };
    ids.push(alternate.id);
    await page.goto(`/plans/${alternate.id}`);
    await page.getByRole('button', { name: 'Use this plan', exact: true }).click();
    await expect(page).toHaveURL(`/?plan=${alternate.id}#map-region`);
    await expect(page.getByRole('link', { name: 'Review current plan', exact: true })).toHaveAttribute('href', `/plans/${alternate.id}`);
    await page.goto(`/plans/${created.id}`);
    await page.getByRole('button', { name: 'Use this plan', exact: true }).click();
    await expect(page).toHaveURL(`/?plan=${created.id}#map-region`);

    for (const placeName of ['Royal Palace', 'Erasmus Bridge', 'Dom Tower']) {
      await openExplorePlaceByName(page, placeName);
      const updatedResponse = page.waitForResponse(update =>
        update.request().method() === 'PUT' && new URL(update.url()).pathname === `/api/plans/${created.id}`);
      await page.locator('.place-detail').getByRole('button', { name: 'Add to saved plan', exact: true }).click();
      const updated = await updatedResponse;
      expect(updated.status(), await updated.text()).toBe(200);
      await expect(page.locator('.draft-feedback')).toContainText(`Added 1 place to ${name}`);
    }
    await page.keyboard.press('Escape');
    await page.locator('.saved-plans-link').click();
    await page.getByRole('link', { name: 'Back to places', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(review).toHaveAttribute('href', `/plans/${created.id}`);
    await expect(page.locator('.draft-count')).toHaveText('3 / 12');
    await page.reload();
    await expect(page.locator('.draft-panel')).toContainText(name);
    await review.click();
    await expect(page.locator('.details-stop')).toHaveCount(3);
    await expect(page.locator('#saved-plan-description')).toHaveValue(created.description);
    for (const city of ['Amsterdam', 'Rotterdam', 'Utrecht']) {
      await expect(page.locator('.details-stop__copy small').filter({ hasText: city })).toHaveCount(1);
    }
    const removed = await page.request.delete(`/api/plans/${created.id}`);
    expect(removed.status()).toBe(204);
    await page.goto('/');
    await expect(page.locator('.draft-count')).toContainText('0 stops');
    expect(await page.evaluate(() => sessionStorage.getItem('hopon:active-plan:v1'))).toBeNull();
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    await cleanupCreatedPlans(page, ids, testFailed);
  }
});

test('switches the starting city without losing cross-city stops or scrolling', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  let planWrites = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/plans') && request.method() !== 'GET') planWrites++;
  });
  for (const viewport of [
    { width: 1440, height: 720 },
    { width: 1280, height: 600 },
    { width: 390, height: 844 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/plans/new?city=amsterdam');
    await page.locator('#plan-name').fill('An afternoon together');
    for (const cityId of ['rotterdam', 'utrecht', 'amsterdam']) {
      await page.locator('#plan-city').selectOption(cityId);
      await expect(page).toHaveURL(new RegExp(`city=${cityId}`));
      await expect(page.locator('#plan-city')).toHaveValue(cityId);
      await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
      await expect(page.locator('#plan-name')).toHaveValue('An afternoon together');
      await expect(page.locator('.editor-conflict')).toHaveCount(0);
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? '{}')))
        .toMatchObject({ cityId, name: 'An afternoon together', placeIds: [] });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if (viewport.width >= 1000) {
      const settings = await page.locator('.editor-settings').evaluate(element => ({ scroll: element.scrollHeight, visible: element.clientHeight }));
      expect(settings.scroll).toBeLessThanOrEqual(settings.visible);
      for (const row of await page.locator('.editor-settings .plan-settings-row:not(.plan-settings-row--description)').all()) {
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(60);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`empty-city-switch-${viewport.width}.png`) });
    await page.reload();
    await expect(page.locator('#plan-name')).toHaveValue('An afternoon together');
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
  }

  const [amsterdamPlaces, rotterdamPlaces] = await Promise.all([
    getActualPlaces(page, 'amsterdam'),
    getActualPlaces(page, 'rotterdam'),
  ]);
  const mixedPlaceIds = [amsterdamPlaces[0].id, rotterdamPlaces[0].id];
  await page.setViewportSize({ width: 1440, height: 720 });
  await seedTabDraft(page, { cityId: 'amsterdam', name: 'Keep these places', placeIds: mixedPlaceIds, updatedAt: '2026-11-14T10:00:00Z' });
  await page.reload();
  await expect(page.locator('.editor-place')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
  await page.locator('#plan-city').selectOption('rotterdam');
  await expect(page.locator('#plan-city')).toHaveValue('rotterdam');
  await expect(page.locator('#plan-name')).toHaveValue('Keep these places');
  await expect(page.locator('.editor-place')).toHaveCount(2);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null')))
    .toMatchObject({ cityId: 'rotterdam', placeIds: mixedPlaceIds });
  await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
  await expect(page.locator('.editor-conflict')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('mixed-city-starting-city-switch.png') });
  expect(planWrites).toBe(0);
});

test('renders draft stops as a compact table on desktop and mobile', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const catalogs = await Promise.all(['amsterdam', 'rotterdam', 'utrecht'].map(city => getActualPlaces(page, city)));
  const places = catalogs.flatMap(catalog => catalog.slice(0, 4));
  expect(places).toHaveLength(12);
  await page.goto('/plans/new?city=amsterdam');

  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1280, height: 600 },
    { width: 390, height: 844 }, { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    for (const count of [1, 12]) {
      const selected = places.slice(0, count);
      await seedTabDraft(page, {
        cityId: 'amsterdam', name: 'My day out', description: 'Keep the same draft and description.',
        placeIds: selected.map(place => place.id), updatedAt: '2026-11-14T12:00:00.000Z',
      });
      await page.reload();
      const table = page.getByRole('table', { name: 'Stops in plan', exact: true });
      const rows = table.locator('tbody tr');
      await expect(rows).toHaveCount(count);
      await expect(rows.locator('h3')).toHaveText(selected.map(place => place.name));
      await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
      await expect(rows.first().getByRole('button', { name: `Move ${selected[0].name} up`, exact: true })).toBeDisabled();
      await expect(rows.last().getByRole('button', { name: `Move ${selected.at(-1)!.name} down`, exact: true })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      if (viewport.width >= 1000) {
        const lastRow = (await rows.last().boundingBox())!;
        const list = (await page.locator('.editor-place-list').boundingBox())!;
        const actions = (await page.locator('.editor-actions--submit').boundingBox())!;
        expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(list.y + list.height - 1);
        expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(actions.y);
        expect((await rows.first().boundingBox())!.height).toBeLessThan(60);
      } else {
        const remove = rows.first().getByRole('button', { name: `Remove ${selected[0].name}`, exact: true });
        const target = (await remove.boundingBox())!;
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
      await table.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`draft-table-${count}-${viewport.width}.png`) });
      if (count === 12) {
        await rows.first().getByRole('button', { name: `Move ${selected[0].name} down`, exact: true }).click();
        await expect(rows.locator('h3')).toHaveText([selected[1], selected[0], ...selected.slice(2)].map(place => place.name));
        await rows.last().getByRole('button', { name: `Remove ${selected[11].name}`, exact: true }).click();
        await expect(rows).toHaveCount(11);
        await page.reload();
        await expect(rows).toHaveCount(11);
        await expect(rows.locator('h3')).toHaveText([selected[1], selected[0], ...selected.slice(2, 11)].map(place => place.name));
        await expect(page.locator('#plan-description')).toHaveValue('Keep the same draft and description.');
      }
    }
  }
});

test('keeps plan settings separate from save actions in short desktop and mobile viewports', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const places = await getActualPlaces(page, 'amsterdam');
  const id = randomUUID();
  let placeIds: string[] = [];
  await page.route(`**/api/plans/${id}`, route => route.fulfill({ json: {
    id,
    name: 'A day by the canals',
    cityId: 'amsterdam',
    placeIds,
    createdAt: '2026-11-14T08:00:00Z',
    updatedAt: '2026-11-14T08:00:00Z',
  } }));

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1440, height: 720 },
    { width: 1280, height: 600 },
    { width: 1024, height: 600 },
    { width: 768, height: 1024 },
    { width: 720, height: 480 },
    { width: 390, height: 844 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/plans/new?city=amsterdam');
    await expect(page.locator('#plan-name')).toHaveValue('My day out');
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
    const backToPlaces = page.locator('.plan-editor-heading').getByRole('link', { name: 'Back to places', exact: true });
    await expect(backToPlaces).toHaveAttribute('href', '/');
    expect((await backToPlaces.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if (viewport.width >= 1000) {
      const setup = await page.locator('.editor-settings').boundingBox();
      const actions = await page.locator('.editor-actions--submit').boundingBox();
      expect(setup!.y + setup!.height).toBeLessThanOrEqual(actions!.y);
      expect(actions!.y + actions!.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
      const eyebrow = (await page.locator('.plan-editor-heading .plans-eyebrow').boundingBox())!;
      const stopsEyebrow = (await page.locator('.editor-section-heading .plans-eyebrow').boundingBox())!;
      expect(Math.abs(eyebrow.y - stopsEyebrow.y)).toBeLessThanOrEqual(1);
    }
    if (viewport.width === 1440) {
      const setup = await page.locator('.editor-settings').evaluate(element => ({ scroll: element.scrollHeight, visible: element.clientHeight }));
      expect(setup.scroll).toBeLessThanOrEqual(setup.visible);
    }
    if (viewport.width === 1440 && viewport.height === 720 || viewport.width === 390) {
      await page.screenshot({ path: testInfo.outputPath(`create-${viewport.width}.png`) });
    }

    for (const count of [0, 12]) {
      placeIds = places.slice(0, count).map(place => place.id);
      await page.goto(`/plans/${id}`);
      await expect(page.locator('.details-stop')).toHaveCount(count);
      if (count === 0) await expect(page.locator('#add-saved-stop option')).not.toHaveCount(1);
      else await expect(page.locator('#add-saved-stop')).toHaveCount(0);
      const backToPlans = page.locator('.plan-details-heading').getByRole('link', { name: 'Back to Saved Plans', exact: true });
      await expect(backToPlans).toHaveAttribute('href', '/plans');
      await expect(page.locator('.details-form-actions').getByRole('button', { name: 'Use this plan', exact: true })).toBeEnabled();
      await expect(page.locator('.details-stops').getByRole('button', { name: 'Explore map', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      if (viewport.width >= 1000) {
        const settings = await page.locator('.details-settings').boundingBox();
        const stops = await page.locator('.details-stops').boundingBox();
        const actions = await page.locator('.details-form-actions').boundingBox();
        expect(settings!.y + settings!.height).toBeLessThanOrEqual(actions!.y);
        expect(stops!.x).toBeGreaterThanOrEqual(actions!.x + actions!.width);
        expect(stops!.y + stops!.height).toBeLessThanOrEqual(viewport.height);
        expect(actions!.y + actions!.height).toBeLessThanOrEqual(viewport.height);
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
        if (viewport.width === 1440 && count === 0) {
          const settingsSize = await page.locator('.details-settings').evaluate(element => ({ scroll: element.scrollHeight, visible: element.clientHeight }));
          expect(settingsSize.scroll).toBeLessThanOrEqual(settingsSize.visible);
        }
      }
      await page.locator('.details-add-stop-inline').scrollIntoViewIfNeeded();
      const picker = await page.locator('.details-add-stop-inline').boundingBox();
      const actions = await page.locator('.details-form-actions').boundingBox();
      expect(picker!.y + picker!.height).toBeLessThanOrEqual(actions!.y);
      if (count === 12) {
        await expect(page.getByText('12-place limit reached.', { exact: false })).toBeVisible();
        if (viewport.width >= 1000) {
          const table = await page.locator('.details-stop-list').evaluate(element => ({ scroll: element.scrollHeight, visible: element.clientHeight }));
          expect(table.scroll).toBeLessThanOrEqual(table.visible);
          const listBounds = (await page.locator('.details-stop-list').boundingBox())!;
          for (const row of await page.locator('.details-stop').all()) {
            const bounds = (await row.boundingBox())!;
            expect(bounds.y).toBeGreaterThanOrEqual(listBounds.y);
            expect(bounds.y + bounds.height).toBeLessThanOrEqual(listBounds.y + listBounds.height + 1);
          }
        }
      } else {
        await page.locator('#add-saved-stop').selectOption({ index: 1 });
        await page.getByRole('button', { name: 'Add place', exact: true }).click();
        await expect(page.locator('.details-stop')).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
        if (viewport.width === 1440 && viewport.height === 900) {
          await backToPlans.click();
          const discard = page.locator('#discard-plan-edits');
          await expect(discard).toBeVisible();
          await discard.getByRole('button', { name: 'Keep editing', exact: true }).click();
          await expect(page.locator('.details-stop')).toHaveCount(1);
        }
        await page.locator('.details-remove-button').click();
        await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
      }
      if (viewport.width === 1440 && viewport.height === 720 || viewport.width === 390) {
        await page.screenshot({ path: testInfo.outputPath(`details-${count}-${viewport.width}.png`) });
      }
    }
  }
  await page.goto('/plans/new?city=amsterdam');
  await page.locator('#plan-name').fill('A day worth keeping');
  await page.locator('.plan-editor-heading .plan-back-link').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/');
  await expect(page.locator('.draft-name')).toHaveText('A day worth keeping');
});

test('saves optional multiline descriptions across desktop and mobile and keeps one Netherlands city', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const ids: string[] = [];
  let testFailed = false;
  const name = `Description check ${randomUUID().slice(0, 8)}`;
  const description = 'Canals & cafés.\nMeet at 10:00 <near the bridge>.';
  try {
    for (const viewport of [
      { width: 1440, height: 720 }, { width: 1280, height: 600 },
      { width: 390, height: 844 }, { width: 360, height: 640 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/plans/new?city=amsterdam');
      await expect(page.locator('#plan-country')).toHaveValue('netherlands');
      await expect(page.locator('#plan-country option')).toHaveText(['Netherlands']);
      await page.locator('#plan-name').fill(name);
      await page.locator('#plan-description').fill(description);
      await page.locator('#plan-city').selectOption('rotterdam');
      await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
      await expect(page.locator('#plan-description')).toHaveValue(description);
      await page.reload();
      await expect(page.locator('#plan-description')).toHaveValue(description);
      await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      if (viewport.width >= 1000) {
        const size = await page.locator('.editor-settings').evaluate(el => ({ visible: el.clientHeight, scroll: el.scrollHeight }));
        expect(size.scroll).toBeLessThanOrEqual(size.visible);
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
      } else {
        expect(await page.locator('#plan-description').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      }
      await page.screenshot({ path: testInfo.outputPath(`description-create-${viewport.width}.png`) });
    }
    const post = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/plans');
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    const response = await post;
    expect(response.status()).toBe(201);
    const created = await response.json() as { id: string; description: string; cityId: string };
    ids.push(created.id);
    expect(created.description).toBe(description);
    expect(created.cityId).toBe('rotterdam');
    await expect(page.locator('#saved-plan-description')).toHaveValue(description);
    await page.reload();
    await expect(page.locator('#saved-plan-description')).toHaveValue(description);
    const edited = 'Museums first.\nLunch by the water.';
    await page.locator('#saved-plan-description').fill(edited);
    await page.locator('.plan-details-heading .plan-back-link').click();
    const discard = page.locator('#discard-plan-edits');
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.locator('#saved-plan-description')).toHaveValue(edited);
    for (const viewport of [{ width: 1440, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: testInfo.outputPath(`description-details-${viewport.width}.png`) });
    }
    const oversized = await page.request.put(`/api/plans/${created.id}`, { data: { name, cityId: 'rotterdam', placeIds: [], description: 'x'.repeat(501) } });
    expect(oversized.status()).toBe(400);
    expect((await oversized.json()).detail).toContain('500');
    await page.reload();
    await expect(page.locator('#saved-plan-description')).toHaveValue(edited);
    await page.locator('#saved-plan-description').fill('');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.locator('#saved-plan-description')).toHaveValue('');
    await deletePlanThroughUi(page);
  } catch (error) { testFailed = true; throw error; }
  finally { await cleanupCreatedPlans(page, ids, testFailed); }
});

test('saves an empty plan, adds a place later and can return to an empty saved plan', async ({ page }) => {
  const createdIds: string[] = [];
  let testFailed = false;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/plans/new?city=amsterdam');
    await page.locator('#plan-city').selectOption('rotterdam');
    const name = `Places later ${randomUUID().slice(0, 8)}`;
    await page.locator('#plan-name').fill(name);
    const post = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/plans');
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    const response = await post;
    expect(response.status()).toBe(201);
    const saved = await response.json() as { id: string; cityId: string; placeIds: string[] };
    createdIds.push(saved.id);
    expect(saved.placeIds).toEqual([]);
    expect(saved.cityId).toBe('rotterdam');
    await expect(page.locator('.details-stop-count')).toHaveText('0 / 12');
    await expect(page.locator('.details-stop-table')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.locator('.details-stop-count')).toHaveText('0 / 12');
    await expect(page.locator('.details-stop-table')).toBeHidden();
    await expect(page.locator('#add-saved-stop option')).not.toHaveCount(1);
    await page.locator('#add-saved-stop').selectOption({ index: 1 });
    const addedPlaceId = await page.locator('#add-saved-stop').inputValue();
    await page.getByRole('button', { name: 'Add place', exact: true }).click();
    await expect(page.locator('.details-stop-count')).toHaveText('1 / 12');
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('.details-stop')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    const populatedPlan = await page.request.get(`/api/plans/${saved.id}`);
    expect(populatedPlan.status()).toBe(200);
    expect((await populatedPlan.json()).placeIds).toEqual([addedPlaceId]);
    await page.locator('.details-remove-button').click();
    await expect(page.locator('.details-stop-count')).toHaveText('0 / 12');
    await expect(page.locator('.details-stop-table')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.locator('.details-stop-count')).toHaveText('0 / 12');
    await expect(page.locator('.details-stop-table')).toBeHidden();
    const emptyPlan = await page.request.get(`/api/plans/${saved.id}`);
    expect(emptyPlan.status()).toBe(200);
    expect((await emptyPlan.json()).placeIds).toEqual([]);
    await expect(page.locator('#saved-plan-name')).toHaveValue(name);
    await deletePlanThroughUi(page);
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    await cleanupCreatedPlans(page, createdIds, testFailed);
  }
});

test('blocks a thirteenth draft place with feedback and returns an API validation error', async ({ page }) => {
  const allPlaces = await getActualPlaces(page, 'amsterdam');
  const counts = new Map<string, number>();
  for (const place of allPlaces) counts.set(place.name, (counts.get(place.name) ?? 0) + 1);
  const places = allPlaces.filter(place => counts.get(place.name) === 1).slice(0, 13);
  expect(places).toHaveLength(13);
  await page.goto('/plans');
  const ids = places.slice(0, 12).map(place => place.id);
  await seedTabDraft(page, { cityId: 'amsterdam', name: 'A full day', placeIds: ids, updatedAt: '2026-11-10T12:00:00.000Z' });
  await page.goto('/');
  await page.locator('#place-search').fill(places[12].name);
  const card = page.locator('.place-card').filter({ has: page.getByText(places[12].name, { exact: true }) })
    .filter({ has: page.locator('.place-card__city').getByText('Amsterdam', { exact: true }) });
  await card.click();
  await expect(page.locator('.place-detail__limit')).toContainText('12-place limit reached');
  await page.locator('.place-detail').getByRole('button', { name: 'Add to plan', exact: true }).click();
  await expect(page.locator('.draft-feedback')).toContainText('12-place limit');
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? '{}').placeIds)).toEqual(ids);
  const response = await page.request.post('/api/plans', { data: { name: 'Too many places', cityId: 'amsterdam', placeIds: places.map(place => place.id) } });
  expect(response.status()).toBe(400);
  expect(response.headers()['content-type']).toContain('application/problem+json');
  expect((await response.json()).detail).toContain('12');
});

test('keeps all 13 real draft places through refresh and saves after one explicit removal', async ({ page }) => {
  test.setTimeout(60_000);
  const amsterdamPlaces = await getActualPlaces(page, 'amsterdam');
  const thirteenPlaces = amsterdamPlaces.slice(0, 13);
  expect(thirteenPlaces).toHaveLength(13);
  const placeIds = thirteenPlaces.map((place) => place.id);
  await page.goto('/plans');
  const draftName = `Thirteen real stops ${randomUUID().slice(0, 8)}`;
  await seedTabDraft(page, {
    cityId: 'amsterdam',
    name: draftName,
    placeIds,
    updatedAt: '2026-11-10T12:00:00.000Z',
  });
  await page.goto('/plans/new');
  await expect(page.locator('.editor-place')).toHaveCount(13);
  await expect(page.locator('#plan-name')).toHaveValue(draftName);
  await expect(page.getByText('This draft has more than 12 places.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save plan' })).toBeDisabled();

  await page.getByRole('button', { name: `Remove ${thirteenPlaces[12].name}` }).click();
  await expect(page.locator('.editor-place')).toHaveCount(12);
  const editedDraftName = 'Twelve verified stops';
  await page.locator('#plan-name').fill(editedDraftName);
  const trimmedDraft = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null') as {
      name: string;
      cityId: string;
      placeIds: string[];
    },
  );
  expect({ name: trimmedDraft.name, cityId: trimmedDraft.cityId, placeIds: trimmedDraft.placeIds })
    .toEqual({ name: editedDraftName, cityId: 'amsterdam', placeIds: placeIds.slice(0, 12) });
  await expect(page.getByRole('button', { name: 'Save plan' })).toBeEnabled();

  await page.reload();
  await expect(page.locator('#plan-name')).toHaveValue(editedDraftName);
  await expect(page.locator('.editor-place')).toHaveCount(12);
  await expect(page.locator('.editor-place h3')).toHaveText(
    thirteenPlaces.slice(0, 12).map((place) => place.name),
  );
  const restoredDraft = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null') as {
      name: string;
      cityId: string;
      placeIds: string[];
    },
  );
  expect({ name: restoredDraft.name, cityId: restoredDraft.cityId, placeIds: restoredDraft.placeIds })
    .toEqual({ name: editedDraftName, cityId: 'amsterdam', placeIds: placeIds.slice(0, 12) });

  const testPlanIds: string[] = [];
  let testFailed = false;
  try {
    const savedName = `Twelve verified stops ${randomUUID().slice(0, 8)}`;
    await page.locator('#plan-name').fill(savedName);
    const postResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/plans',
    );
    await page.getByRole('button', { name: 'Save plan' }).click();
    const postResponse = await postResponsePromise;
    if (postResponse.status() === 201) {
      const createdIdFromLocation = planIdFromLocation(postResponse.headers()['location']);
      if (createdIdFromLocation !== null) {
        testPlanIds.push(createdIdFromLocation);
      }
    }
    expect(postResponse.status()).toBe(201);
    const created = await postResponse.json() as { id: string; name: string; placeIds: string[] };
    expect(postResponse.headers()['location']).toBe(`/api/plans/${created.id}`);
    expect(created.name).toBe(savedName);
    expect(created.placeIds).toEqual(placeIds.slice(0, 12));
    await expect(page).toHaveURL(`/plans/${created.id}`);
    await deletePlanThroughUi(page);
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    await cleanupCreatedPlans(page, testPlanIds, testFailed);
  }
});

test('preserves create inputs after real-shaped 400, 500 and offline failures without auto-retrying', async ({ page }) => {
  const amsterdamPlaces = await getActualPlaces(page, 'amsterdam');
  const placeIds = amsterdamPlaces.slice(0, 2).map((place) => place.id);
  await page.goto('/plans');
  await seedTabDraft(page, {
    cityId: 'amsterdam',
    name: 'Recovery afternoon',
    placeIds,
    updatedAt: '2026-11-10T12:00:00.000Z',
  });

  let postAttempts = 0;
  await page.route('**/api/plans', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    postAttempts += 1;
    if (postAttempts === 1) {
      await route.fulfill({
        status: 400,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 400, title: 'Bad Request', detail: 'Plan name is already in use.' }),
      });
    } else if (postAttempts === 2) {
      await route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 500, title: 'Internal Server Error', detail: 'The write outcome is unknown.' }),
      });
    } else {
      await route.abort('failed');
    }
  });
  await page.goto('/plans/new');
  await expect(page.locator('.editor-place')).toHaveCount(2);
  await page.locator('#plan-name').fill('Keep every stop');

  const expectPreservedDraft = async () => {
    await expect(page.locator('#plan-name')).toHaveValue('Keep every stop');
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null')))
      .toMatchObject({ name: 'Keep every stop', cityId: 'amsterdam', placeIds });
    await expect(page.locator('.editor-place h3')).toHaveText([
      amsterdamPlaces.find((place) => place.id === placeIds[0])!.name,
      amsterdamPlaces.find((place) => place.id === placeIds[1])!.name,
    ]);
  };

  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.locator('.editor-state[role="alert"]')).toContainText('Plan name is already in use.');
  await expectPreservedDraft();
  expect(postAttempts).toBe(1);

  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.locator('.editor-state[role="alert"]')).toContainText('server may have created the plan');
  await expect(page.locator('.editor-state[role="alert"]')).toContainText('Check Saved Plans before trying again');
  await expectPreservedDraft();
  expect(postAttempts).toBe(2);

  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.locator('.editor-state[role="alert"]')).toContainText('Check that the backend is running');
  await expect(page.locator('.editor-state[role="alert"]')).toContainText('server may have created the plan');
  await expectPreservedDraft();
  expect(postAttempts).toBe(3);
  expect(page.url()).toContain('/plans/new');
});

test('keeps one delayed plan POST safe from every SPA exit path until confirmation', async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const placeIds = (await getActualPlaces(page, 'amsterdam')).slice(0, 2).map((place) => place.id);
  const planId = 'b319a73c-3b31-4d28-9c34-6d64940ef2e5';
  const createdPlan = {
    id: planId,
    name: 'Guarded pending save',
    description: '',
    cityId: 'amsterdam',
    placeIds,
    createdAt: '2026-11-11T10:00:00Z',
    updatedAt: '2026-11-11T10:00:00Z',
  };

  await page.goto('/plans');
  await seedTabDraft(page, {
    cityId: 'amsterdam',
    name: 'Guarded pending save',
    placeIds,
    updatedAt: '2026-11-11T09:00:00.000Z',
  });
  await page.getByRole('link', { name: 'Create a plan', exact: true }).click();
  await expect(page.locator('.editor-place')).toHaveCount(2);

  let releasePost!: () => void;
  const postHeld = new Promise<void>((resolve) => { releasePost = resolve; });
  let postAttempts = 0;
  await page.route('**/api/plans', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    postAttempts += 1;
    await postHeld;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      headers: { Location: `/api/plans/${planId}` },
      body: JSON.stringify(createdPlan),
    });
  });
  await page.route(`**/api/plans/${planId}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createdPlan) });
      return;
    }
    await route.continue();
  });

  const postStarted = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/plans',
  );
  await page.getByRole('button', { name: 'Save plan' }).click();
  const postRequest = await postStarted;
  expect(postRequest.postDataJSON()).toEqual({
    name: 'Guarded pending save',
    description: '',
    cityId: 'amsterdam',
    placeIds,
  });
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await expect(page.locator('#plan-name')).toBeDisabled();
  await expect(page.locator('#plan-city')).toBeDisabled();
  const firstRow = page.locator('.editor-place').first();
  await expect(firstRow.locator('.editor-icon-button').nth(1)).toBeDisabled();
  await expect(firstRow.locator('.editor-remove')).toBeDisabled();

  await page.locator('.plan-editor-heading .plan-back-link').click();
  await expect(page).toHaveURL(/\/plans\/new/);
  await page.locator('.plans-brand').click();
  await expect(page).toHaveURL(/\/plans\/new/);
  await page.locator('app-main-navigation .bottom-nav__item').filter({ hasText: 'Map' }).click();
  await expect(page).toHaveURL(/\/plans\/new/);
  await page.locator('app-main-navigation .bottom-nav__item').filter({ hasText: 'Explore' }).click();
  await expect(page).toHaveURL(/\/plans\/new/);
  await page.locator('app-main-navigation .bottom-nav__item').filter({ hasText: 'Plans' }).click();
  await expect(page).toHaveURL(/\/plans\/new/);
  await expect(page.getByText('Saving in progress. Please wait for confirmation.')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/plans\/new/);
  await page.goForward();
  await expect(page).toHaveURL(/\/plans\/new/);
  expect(postAttempts).toBe(1);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null')))
    .toMatchObject({ name: 'Guarded pending save', cityId: 'amsterdam', placeIds });

  releasePost();
  await expect(page).toHaveURL(`/plans/${planId}`);
  await expect(page.getByRole('heading', { name: 'Guarded pending save' })).toBeVisible();
  expect(postAttempts).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('hopon:draft:v1'))).toBeNull();
});

test('keeps saved plans usable at mobile widths with keyboard and browser history', async ({ page }) => {
  test.setTimeout(60_000);
  const [place] = await getActualPlaces(page, 'amsterdam');
  const mobilePlanName = `Mobile check ${randomUUID().slice(0, 8)}`;
  const testPlanIds: string[] = [];
  let testFailed = false;
  try {
    const initialPlansResponse = await page.request.get('http://127.0.0.1:4300/api/plans');
    expect(initialPlansResponse.status()).toBe(200);
    const initialPlans = await initialPlansResponse.json() as { id: string }[];
    const createResponse = await page.request.post('http://127.0.0.1:4300/api/plans', {
      data: { name: mobilePlanName, cityId: 'amsterdam', placeIds: [place.id] },
    });
    if (createResponse.status() === 201) {
      const createdIdFromLocation = planIdFromLocation(createResponse.headers()['location']);
      if (createdIdFromLocation !== null) {
        testPlanIds.push(createdIdFromLocation);
      }
    }
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json() as { id: string };
    expect(planIdFromLocation(createResponse.headers()['location'])).toBe(created.id);

    await page.goto('/plans');
    await seedTabDraft(page, {
      cityId: 'amsterdam',
      name: 'Responsive editor check',
      placeIds: [place.id],
      updatedAt: '2026-11-10T12:00:00.000Z',
    });
    const createdPlanCard = page.locator('.saved-plan-card').filter({ hasText: mobilePlanName });
    await expect(createdPlanCard).toHaveCount(1);
    await expect(createdPlanCard).toBeVisible();
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 844 });
      await expect(page.locator('app-main-navigation a[href="/plans"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }

    await page.getByRole('link', { name: 'Create a plan', exact: true }).click();
    await expect(page.locator('.editor-place')).toHaveCount(1);
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 844 });
      await expect(page.locator('app-main-navigation a[href="/plans"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const navigationBounds = await page.locator('app-main-navigation a[href="/plans"]').boundingBox();
      const saveBounds = await page.getByRole('button', { name: 'Save plan' }).boundingBox();
      expect(navigationBounds?.height).toBeGreaterThanOrEqual(44);
      expect(saveBounds?.height).toBeGreaterThanOrEqual(44);
      for (const control of await page.locator('.editor-icon-button, .editor-remove').all()) {
        const bounds = await control.boundingBox();
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
    }
    await page.locator('app-main-navigation a[href="/plans"]').click();
    await expect(page).toHaveURL(/\/plans$/);

    await page.getByRole('link', { name: `Open ${mobilePlanName} in Amsterdam` }).click();
    await expect(page).toHaveURL(`/plans/${created.id}`);
    await page.goBack();
    await expect(page).toHaveURL(/\/plans$/);
    await page.goForward();
    await expect(page).toHaveURL(`/plans/${created.id}`);
    await expect(page.locator('#saved-plan-name')).toHaveValue(mobilePlanName);

    await page.locator('#saved-plan-name').fill(`${mobilePlanName} edited`);
    await page.goBack();
    const discardDialog = page.locator('#discard-plan-edits');
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(page).toHaveURL(`/plans/${created.id}`);

    const refreshWarningTriggered = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(refreshWarningTriggered).toBe(true);
    await expect(page.locator('#saved-plan-name')).toHaveValue(`${mobilePlanName} edited`);

    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 844 });
      await expect(page.locator('app-main-navigation a[href="/plans"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const saveChanges = page.getByRole('button', { name: 'Save changes' });
      await saveChanges.scrollIntoViewIfNeeded();
      const saveBounds = await saveChanges.boundingBox();
      const navigationBounds = await page.locator('app-main-navigation').boundingBox();
      expect(saveBounds).not.toBeNull();
      expect(navigationBounds).not.toBeNull();
      expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(navigationBounds!.y);
      const shellPaddingBottom = await page.locator('.plan-details-shell').evaluate(
        (element) => Number.parseFloat(getComputedStyle(element).paddingBottom),
      );
      expect(shellPaddingBottom).toBeGreaterThanOrEqual(96);
      for (const control of await page.locator('.details-icon-button, .details-remove-button').all()) {
        const bounds = await control.boundingBox();
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
    }

    await page.locator('#saved-plan-name').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#saved-plan-description')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Explore map', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#add-saved-stop')).toBeFocused();
    await page.keyboard.press('Tab');
    const focusedRemove = page.locator('.details-remove-button');
    await expect(focusedRemove).toBeFocused();
    expect(await focusedRemove.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('3px');

    const deleteButton = page.getByRole('button', { name: 'Delete plan', exact: true });
    await page.setViewportSize({ width: 360, height: 800 });
    await deleteButton.click();
    const confirmation = page.locator('#delete-plan-confirmation');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const dialogButtonBounds = await confirmation.getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
    expect(dialogButtonBounds?.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(confirmation).toBeHidden();
    await expect(deleteButton).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await deleteButton.click();
    await expect(confirmation).toBeVisible();
    const cancelButton = confirmation.getByRole('button', { name: 'Cancel', exact: true });
    await cancelButton.click();
    await expect(confirmation).toBeHidden();
    await expect(deleteButton).toBeFocused();
    await deleteButton.click();
    await expect(confirmation).toBeVisible();
    const deleteResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'DELETE'
        && new URL(response.url()).pathname === `/api/plans/${created.id}`,
    );
    const finalListRead = page.waitForResponse((response) => isPlansListRead(response));
    await confirmation.getByRole('button', { name: 'Delete plan', exact: true }).click();
    expect((await deleteResponsePromise).status()).toBe(204);
    await expect(page).toHaveURL(/\/plans$/);
    const plansAfterDelete = await (await finalListRead).json() as { id: string }[];
    expect(plansAfterDelete.map((plan) => plan.id)).toEqual(
      expect.arrayContaining(initialPlans.map((plan) => plan.id)),
    );
    expect(plansAfterDelete.some((plan) => plan.id === created.id)).toBe(false);
    await expect(page.locator('.plans-empty')).toHaveCount(plansAfterDelete.length === 0 ? 1 : 0);
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    await cleanupCreatedPlans(page, testPlanIds, testFailed);
  }
});

test('captures the Saved Plans screens at every required viewport', async ({ page }) => {
  test.setTimeout(120_000);
  const screenshotsDirectory = join(process.cwd(), 'test-results', 'hop004-e-real-viewport', 'saved-plans');
  const viewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ];
  const testPlanIds: string[] = [];
  let testFailed = false;
  await mkdir(screenshotsDirectory, { recursive: true });

  try {
    await page.route('**/api/plans', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    }));
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/plans');
      await expect(page.locator('.plans-empty')).toBeVisible();
      await assertRealViewportGeometry(page, viewport);
      await page.screenshot({
        path: join(screenshotsDirectory, `list-empty-${viewport.width}x${viewport.height}.png`),
      });
    }
    await page.unroute('**/api/plans');

    const places = await getActualPlaces(page, 'amsterdam');
    const planName = 'A quiet canal day';
    const createResponse = await page.request.post('http://127.0.0.1:4300/api/plans', {
      data: { name: planName, cityId: 'amsterdam', placeIds: places.slice(0, 3).map((place) => place.id) },
    });
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json() as { id: string };
    testPlanIds.push(created.id);
    expect(planIdFromLocation(createResponse.headers()['location'])).toBe(created.id);

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/plans');
      await expect(page.getByRole('link', { name: `Open ${planName} in Amsterdam` })).toBeVisible();
      await assertRealViewportGeometry(page, viewport);
      await page.screenshot({
        path: join(screenshotsDirectory, `list-populated-${viewport.width}x${viewport.height}.png`),
      });
    }

    await seedTabDraft(page, {
      cityId: 'amsterdam',
      name: 'Art and architecture',
      placeIds: places.slice(0, 3).map((place) => place.id),
      updatedAt: '2026-11-10T12:00:00.000Z',
    });
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/plans/new');
      await expect(page.locator('.editor-place')).toHaveCount(3);
      await assertRealViewportGeometry(page, viewport);
      await page.screenshot({
        path: join(screenshotsDirectory, `create-${viewport.width}x${viewport.height}.png`),
      });
      const savePlan = page.getByRole('button', { name: 'Save plan' });
      await savePlan.scrollIntoViewIfNeeded();
      const savePlanBounds = await savePlan.boundingBox();
      expect(savePlanBounds).not.toBeNull();
      if (viewport.width <= 760) {
        const navigationBounds = await page.locator('app-main-navigation .bottom-nav').boundingBox();
        expect(navigationBounds).not.toBeNull();
        expect(savePlanBounds!.y + savePlanBounds!.height).toBeLessThanOrEqual(navigationBounds!.y);
      }
      await page.screenshot({
        path: join(screenshotsDirectory, `create-save-controls-${viewport.width}x${viewport.height}.png`),
      });
    }

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/plans/${created.id}`);
      await expect(page.locator('#saved-plan-name')).toHaveValue(planName);
      await assertRealViewportGeometry(page, viewport);
      await page.screenshot({
        path: join(screenshotsDirectory, `details-${viewport.width}x${viewport.height}.png`),
      });

      await page.locator('#saved-plan-name').fill(`${planName} edited`);
      const saveChanges = page.getByRole('button', { name: 'Save changes' });
      await saveChanges.scrollIntoViewIfNeeded();
      const saveChangesBounds = await saveChanges.boundingBox();
      expect(saveChangesBounds).not.toBeNull();
      if (viewport.width <= 760) {
        const navigationBounds = await page.locator('app-main-navigation .bottom-nav').boundingBox();
        expect(navigationBounds).not.toBeNull();
        expect(saveChangesBounds!.y + saveChangesBounds!.height).toBeLessThanOrEqual(navigationBounds!.y);
      }
      await page.screenshot({
        path: join(screenshotsDirectory, `edit-save-controls-${viewport.width}x${viewport.height}.png`),
      });
      await page.locator('.plan-details-heading .plan-back-link').click();
      const discardDialog = page.locator('#discard-plan-edits');
      await expect(discardDialog).toBeVisible();
      await expect(discardDialog.getByRole('button', { name: 'Keep editing', exact: true })).toBeInViewport();
      await page.screenshot({
        path: join(screenshotsDirectory, `discard-dialog-${viewport.width}x${viewport.height}.png`),
      });
      await discardDialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
      await expect(discardDialog).toBeHidden();
      await page.locator('#saved-plan-name').fill(planName);

      const deleteButton = page.getByRole('button', { name: 'Delete plan', exact: true });
      await deleteButton.click();
      const deleteDialog = page.locator('#delete-plan-confirmation');
      await expect(deleteDialog).toBeVisible();
      await expect(deleteDialog).toBeInViewport();
      await assertRealViewportGeometry(page, viewport);
      await expect(deleteDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
      await page.screenshot({
        path: join(screenshotsDirectory, `delete-dialog-${viewport.width}x${viewport.height}.png`),
      });
      await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(deleteDialog).toBeHidden();
    }
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    await cleanupCreatedPlans(page, testPlanIds, testFailed);
  }
});

test('keeps plan counts and map actions aligned across viewport widths', async ({ page }) => {
  const screenshotsDirectory = join(process.cwd(), 'test-results', 'hop010-visual-polish');
  await mkdir(screenshotsDirectory, { recursive: true });
  const plan = {
    id: randomUUID(), name: 'A quiet day in Utrecht', description: '', cityId: 'utrecht',
    placeIds: ['utrecht-way-857852772'], createdAt: '2026-11-14T10:00:00Z', updatedAt: '2026-11-14T10:00:00Z',
  };
  await page.route('**/api/plans', route => route.fulfill({ json: [plan] }));
  await page.route(`**/api/plans/${plan.id}`, route => route.fulfill({ json: plan }));

  const viewports = [
    { width: 320, height: 640 }, { width: 360, height: 800 }, { width: 390, height: 844 },
    { width: 430, height: 932 }, { width: 600, height: 900 }, { width: 760, height: 1000 },
    { width: 768, height: 1024 }, { width: 900, height: 700 }, { width: 999, height: 800 },
    { width: 1000, height: 800 }, { width: 1100, height: 860 }, { width: 1280, height: 720 },
    { width: 1440, height: 900 }, { width: 1536, height: 864 }, { width: 1920, height: 1080 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/plans');
    const summary = page.locator('.plans-collection-count');
    const createButton = page.getByRole('link', { name: 'Create a plan', exact: true });
    await expect(summary).toHaveText('1 plan · 1 place');
    await expect(createButton).toBeVisible();
    const summaryBounds = await summary.boundingBox();
    const createBounds = await createButton.boundingBox();
    const actionsBounds = await page.locator('.plans-list-heading__actions').boundingBox();
    const headingBounds = await page.locator('.plans-list-heading').boundingBox();
    expect(summaryBounds).not.toBeNull();
    expect(createBounds).not.toBeNull();
    expect(actionsBounds).not.toBeNull();
    expect(headingBounds).not.toBeNull();
    expect(Math.abs(summaryBounds!.y + summaryBounds!.height / 2 - createBounds!.y - createBounds!.height / 2), `Plan count and create button should align at ${viewport.width}px`)
      .toBeLessThanOrEqual(1);
    expect(createBounds!.x + createBounds!.width).toBeLessThanOrEqual(summaryBounds!.x);
    expect(Math.abs(headingBounds!.x + headingBounds!.width - summaryBounds!.x - summaryBounds!.width), `Plan count should sit at the right edge at ${viewport.width}px`)
      .toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `Saved Plans should fit at ${viewport.width}px`)
      .toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: join(screenshotsDirectory, `saved-plans-${viewport.width}.png`) });

    await page.goto(`/plans/${plan.id}`);
    await expect(page.locator('.details-city-label')).toHaveCount(0);
    await expect(page.locator('#plan-details-title')).toHaveText(plan.name);
    await expect(page.locator('#plan-details-title')).toBeVisible();
    const stopsCount = page.locator('.details-stop-count');
    const countCenter = await stopsCount.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const pill = element.getBoundingClientRect();
      return {
        x: Math.abs(text.x + text.width / 2 - pill.x - pill.width / 2),
        y: Math.abs(text.y + text.height / 2 - pill.y - pill.height / 2),
      };
    });
    expect(countCenter.x, `Stop count text should be horizontally centered at ${viewport.width}px`).toBeLessThanOrEqual(1);
    expect(countCenter.y, `Stop count text should be vertically centered at ${viewport.width}px`).toBeLessThanOrEqual(1);
    const exploreMap = page.getByRole('button', { name: 'Explore map', exact: true });
    await expect(exploreMap).toBeVisible();
    const stopsBounds = await stopsCount.boundingBox();
    const mapBounds = await exploreMap.boundingBox();
    const mapIconBounds = await exploreMap.locator('img').boundingBox();
    const mapTextBounds = await exploreMap.locator('span').boundingBox();
    const routeActionsBounds = await page.locator('.details-route-actions').boundingBox();
    const headingCopyBounds = await page.locator('.details-section-heading > div').first().boundingBox();
    expect(stopsBounds).not.toBeNull();
    expect(mapBounds).not.toBeNull();
    expect(mapIconBounds).not.toBeNull();
    expect(mapTextBounds).not.toBeNull();
    expect(routeActionsBounds).not.toBeNull();
    expect(headingCopyBounds).not.toBeNull();
    expect(Math.abs(stopsBounds!.y + stopsBounds!.height / 2 - mapBounds!.y - mapBounds!.height / 2), `Stop count and map button should align at ${viewport.width}px`)
      .toBeLessThanOrEqual(1);
    expect(Math.abs(mapIconBounds!.y + mapIconBounds!.height / 2 - mapTextBounds!.y - mapTextBounds!.height / 2), `Map icon and label should align at ${viewport.width}px`)
      .toBeLessThanOrEqual(1);
    if (routeActionsBounds!.x >= headingCopyBounds!.x + headingCopyBounds!.width - 1) {
      expect(Math.abs(routeActionsBounds!.y + routeActionsBounds!.height / 2 - headingCopyBounds!.y - headingCopyBounds!.height / 2), `Plan actions should be vertically centered beside the heading at ${viewport.width}px`)
        .toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `Plan details should fit at ${viewport.width}px`)
      .toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: join(screenshotsDirectory, `plan-details-${viewport.width}.png`) });
  }
});
