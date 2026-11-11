import { expect, test, type Page, type Response } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const openFreeMapStyleUrl = 'https://tiles.openfreemap.org/styles/liberty';
const isolatedStyle = {
  version: 8,
  name: 'HopOn deterministic E2E style',
  glyphs: 'http://127.0.0.1:4300/__e2e/glyphs/{fontstack}/{range}.pbf',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f1eee6' },
    },
  ],
};
const tileOutageStyle = {
  version: 8,
  name: 'HopOn deterministic tile-outage E2E style',
  glyphs: 'http://127.0.0.1:4300/__e2e/glyphs/{fontstack}/{range}.pbf',
  sources: {
    'controlled-base-tiles': {
      type: 'raster',
      tiles: ['http://127.0.0.1:4300/__e2e/tiles/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenFreeMap',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f1eee6' },
    },
    {
      id: 'controlled-base-tiles',
      type: 'raster',
      source: 'controlled-base-tiles',
    },
  ],
};
const transparentTile = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+p5qgoAAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ page }) => {
  page.on('requestfailed', (request) => {
    if (request.url().toLowerCase().includes('worker')) {
      console.log(`MapLibre worker request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
    }
  });
  await useIsolatedMapStyle(page);
});

test('keeps the latest city when city requests overlap', async ({ page }) => {
  await page.route('**/api/places?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cityId') !== 'rotterdam') {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ response }).catch(() => undefined);
  });

  await page.goto('/');
  const citySelect = page.getByRole('combobox', { name: 'Choose a city' });
  await expect(citySelect).toHaveValue('amsterdam');
  await expect(page.locator('.place-card').first()).toBeVisible();

  await citySelect.selectOption('rotterdam');
  await citySelect.selectOption('utrecht');

  await expect(citySelect).toHaveValue('utrecht');
  await expect(page.locator('.place-results__heading')).toContainText('UTRECHT');
  await expect(page.locator('.place-card').first()).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
});

test('searches and filters a real catalog place, opens details, and restores focus on Escape', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.map-viewport__canvas canvas')).toBeVisible();
  await expect(page.locator('.map-viewport__fallback')).toHaveCount(0);
  const firstCard = page.locator('.place-card').first();
  await expect(firstCard).toBeVisible();

  const placeName = await firstCard.locator('.place-card__name').innerText();
  const category = (await firstCard.locator('.place-card__eyebrow').textContent())?.trim() ?? '';
  expect(category).not.toBe('');
  await page.locator('.filter-row').getByRole('button', { name: category, exact: true }).click();
  await page.locator('#place-search').fill(placeName);
  await expect(page.locator('.place-card')).toHaveCount(1);

  const filteredCard = page.locator('.place-card').first();
  await filteredCard.scrollIntoViewIfNeeded();
  await filteredCard.click();
  await expect(page.locator('.place-detail')).toContainText(placeName);
  await expect(page.locator('.place-detail')).toContainText('Nearby transport hubs');
  await page.keyboard.press('Escape');

  await expect(page.locator('.place-detail')).toHaveCount(0);
  await expect(page.locator('.place-card')).toBeFocused();
});

test('adds Discover places once, restores the tab draft, and asks before changing draft city', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Architecture Hunt' }).click();
  const discoverPicks = page.locator('.discover-pick');
  await expect(discoverPicks.first()).toBeVisible();
  const pickCount = await discoverPicks.count();

  const addAll = page.getByRole('button', { name: 'Add all to plan' });
  await addAll.click();
  await expect(page.locator('.draft-feedback')).toContainText('Added');
  await addAll.click();
  await expect(page.locator('.draft-feedback')).toContainText('Already in plan');
  await expect(page.locator('.draft-count')).toContainText(`${pickCount} stops`);

  await page.reload();
  await expect(page.locator('.draft-count')).toContainText(`${pickCount} stops`);

  await page.getByRole('combobox', { name: 'Choose a city' }).selectOption('rotterdam');
  await expect(page.locator('.place-results__heading')).toContainText('ROTTERDAM');
  const rotterdamCard = page.locator('.place-card').first();
  await rotterdamCard.scrollIntoViewIfNeeded();
  await rotterdamCard.click();
  const detailAddButton = page.locator('.place-detail').getByRole('button', { name: 'Add to plan' });
  await expect(detailAddButton).toBeVisible();
  await detailAddButton.click();

  const conflict = page.getByRole('region', { name: 'Keep the existing draft?' });
  await expect(conflict).toBeVisible();
  await conflict.getByRole('button', { name: 'Start new for Rotterdam' }).click();
  await expect(page.locator('.draft-feedback')).toContainText('Started a new Rotterdam tab draft');

  await detailAddButton.click();
  await expect(page.locator('.draft-feedback')).toContainText('Already in plan');
  await expect(page.locator('.draft-count')).toContainText('1 stop');
});

test('completes real H2 CRUD from Explore while OpenFreeMap is unavailable', async ({ page }) => {
  test.setTimeout(60_000);
  const testPlanIds: string[] = [];
  let testFailed = false;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.unroute(openFreeMapStyleUrl);
    let blockedMapRequests = 0;
    await page.route(openFreeMapStyleUrl, (route) => {
      blockedMapRequests += 1;
      return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Map blocked for CRUD check' });
    });

    const amsterdamPlaces = await getActualPlaces(page, 'amsterdam');
    const initialPlansResponse = await page.request.get('http://127.0.0.1:4300/api/plans');
    expect(initialPlansResponse.status()).toBe(200);
    const initialPlans = await initialPlansResponse.json() as { id: string }[];
    expect(Array.isArray(initialPlans)).toBe(true);

    const unrelatedName = `Unrelated sentinel ${randomUUID()}`;
    const unrelatedResponse = await page.request.post('http://127.0.0.1:4300/api/plans', {
      data: { name: unrelatedName, cityId: 'amsterdam', placeIds: [amsterdamPlaces[0].id] },
    });
    let unrelatedPlanId: string | null = null;
    if (unrelatedResponse.status() === 201) {
      unrelatedPlanId = planIdFromLocation(unrelatedResponse.headers()['location']);
      if (unrelatedPlanId !== null) {
        testPlanIds.push(unrelatedPlanId);
      }
    }
    expect(unrelatedResponse.status()).toBe(201);
    const unrelatedPlan = await unrelatedResponse.json() as { id: string; name: string };
    expect(unrelatedPlan.name).toBe(unrelatedName);
    expect(unrelatedPlanId).toBe(unrelatedPlan.id);
    const preservedPlanIds = [...initialPlans.map((plan) => plan.id), unrelatedPlan.id];

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.place-card').first()).toBeVisible();
    expect(blockedMapRequests).toBeGreaterThan(0);

    const pickedNames: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      pickedNames.push(await addExplorePlaceFromCard(page, index));
    }
    const initialDraft = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null') as {
        cityId: string;
        name: string;
        placeIds: string[];
      } | null,
    );
    expect(initialDraft?.cityId).toBe('amsterdam');
    expect(initialDraft?.placeIds).toHaveLength(3);

    const plansNavigation = page.locator('app-main-navigation a[href="/plans"]');
    const firstListRead = page.waitForResponse((response) => isPlansListRead(response));
    await plansNavigation.click();
    await expect(page).toHaveURL(/\/plans$/);
    const plansBeforeCreate = await (await firstListRead).json() as { id: string }[];
    expect(plansBeforeCreate.map((plan) => plan.id)).toEqual(expect.arrayContaining(preservedPlanIds));
    await expect(page.locator('.plans-empty')).toHaveCount(0);

    await page.getByRole('link', { name: 'Create a plan', exact: true }).click();
    await expect(page.locator('#plan-name')).toBeVisible();
    await expect(page.locator('.editor-place')).toHaveCount(3);
    await page.reload();
    await expect(page.locator('#plan-name')).toBeVisible();
    await expect(page.locator('.editor-place')).toHaveCount(3);
    const restoredDraft = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null') as {
        cityId: string;
        name: string;
        placeIds: string[];
      } | null,
    );
    expect({
      cityId: restoredDraft?.cityId,
      name: restoredDraft?.name,
      placeIds: restoredDraft?.placeIds,
    }).toEqual({ cityId: initialDraft!.cityId, name: initialDraft!.name, placeIds: initialDraft!.placeIds });
    await expect(page.locator('.editor-place h3')).toHaveText(pickedNames);
    const savedName = `Amsterdam after the map closed ${randomUUID()}`;
    await page.locator('#plan-name').fill(savedName);
    await page.getByRole('button', { name: `Move ${pickedNames[0]} down` }).click();
    const createdOrder = [initialDraft!.placeIds[1], initialDraft!.placeIds[0], initialDraft!.placeIds[2]];
    await expect(page.getByRole('button', { name: 'Save plan' })).toBeEnabled();

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
    if (postResponse.status() !== 201) {
      throw new Error(`Real plan POST returned ${postResponse.status()}: ${await postResponse.text()}`);
    }
    const created = await postResponse.json() as {
      id: string;
      name: string;
      cityId: string;
      placeIds: string[];
    };
    expect(postResponse.headers()['location']).toBe(`/api/plans/${created.id}`);
    expect(created).toMatchObject({ name: savedName, cityId: 'amsterdam', placeIds: createdOrder });
    expect(postResponse.request().postDataJSON()).toEqual({
      name: savedName,
      cityId: 'amsterdam',
      placeIds: createdOrder,
    });
    await expect(page).toHaveURL(`/plans/${created.id}`);
    await expect(page.locator('.details-stop__copy h3')).toHaveText([
      amsterdamPlaces.find((place) => place.id === createdOrder[0])!.name,
      amsterdamPlaces.find((place) => place.id === createdOrder[1])!.name,
      amsterdamPlaces.find((place) => place.id === createdOrder[2])!.name,
    ]);

    const detailListRead = page.waitForResponse((response) => isPlansListRead(response));
    await page.locator('.details-topbar-link').click();
    const plansWithCreatedRecord = await (await detailListRead).json() as { id: string }[];
    expect(plansWithCreatedRecord.map((plan) => plan.id))
      .toEqual(expect.arrayContaining([...preservedPlanIds, created.id]));
    await page.getByRole('link', { name: `Open ${savedName} in Amsterdam` }).click();
    await page.reload();
    await expect(page.locator('#saved-plan-name')).toHaveValue(savedName);
    await expect(page.locator('.details-stop__copy h3')).toHaveText([
      amsterdamPlaces.find((place) => place.id === createdOrder[0])!.name,
      amsterdamPlaces.find((place) => place.id === createdOrder[1])!.name,
      amsterdamPlaces.find((place) => place.id === createdOrder[2])!.name,
    ]);

    const updatedName = `Amsterdam, one stop at a time ${randomUUID()}`;
    await page.locator('#saved-plan-name').fill(updatedName);
    const updatedOrder = [createdOrder[0], createdOrder[2], createdOrder[1]];
    await page.getByRole('button', {
      name: `Move ${amsterdamPlaces.find((place) => place.id === createdOrder[2])!.name} up`,
    }).click();
    const putResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/plans/${created.id}`,
    );
    await page.getByRole('button', { name: 'Save changes' }).click();
    const putResponse = await putResponsePromise;
    expect(putResponse.status()).toBe(200);
    const updated = await putResponse.json() as { name: string; cityId: string; placeIds: string[] };
    expect(updated).toMatchObject({ name: updatedName, cityId: 'amsterdam', placeIds: updatedOrder });
    await page.reload();
    await expect(page.locator('#saved-plan-name')).toHaveValue(updatedName);
    await expect(page.locator('.details-stop__copy h3')).toHaveText([
      amsterdamPlaces.find((place) => place.id === updatedOrder[0])!.name,
      amsterdamPlaces.find((place) => place.id === updatedOrder[1])!.name,
      amsterdamPlaces.find((place) => place.id === updatedOrder[2])!.name,
    ]);

    const deleteResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'DELETE' && new URL(response.url()).pathname === `/api/plans/${created.id}`,
    );
    const finalListRead = page.waitForResponse((response) => isPlansListRead(response));
    await page.locator('.plan-details-heading__actions .plans-button--danger').click();
    const confirmation = page.locator('#delete-plan-confirmation');
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Delete plan', exact: true }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(204);
    expect(await deleteResponse.text()).toBe('');
    await expect(page).toHaveURL(/\/plans$/);
    const plansAfterDelete = await (await finalListRead).json() as { id: string }[];
    expect(plansAfterDelete.map((plan) => plan.id)).toEqual(expect.arrayContaining(preservedPlanIds));
    expect(plansAfterDelete.some((plan) => plan.id === created.id)).toBe(false);
    await expect(page.locator('.plans-empty')).toHaveCount(plansAfterDelete.length === 0 ? 1 : 0);
    const missingStatus = await page.evaluate(async (id) => (await fetch(`/api/plans/${id}`)).status, created.id);
    expect(missingStatus).toBe(404);
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    await cleanupCreatedPlans(page, testPlanIds, testFailed);
  }
});

test('keeps cross-city drafts separate through explicit keep and replace decisions', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const amsterdamPlaces = await getActualPlaces(page, 'amsterdam');
  const rotterdamPlaces = await getActualPlaces(page, 'rotterdam');
  await page.goto('/');
  const amsterdamName = await addExplorePlaceFromCard(page, 0);
  const originalDraft = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null') as {
      cityId: string;
      name: string;
      placeIds: string[];
    } | null,
  );
  expect(originalDraft?.cityId).toBe('amsterdam');
  expect(originalDraft?.placeIds).toHaveLength(1);

  await page.getByRole('combobox', { name: 'Choose a city' }).selectOption('rotterdam');
  await expect(page.locator('.place-results__heading')).toContainText('ROTTERDAM');
  const rotterdamCard = page.locator('.place-card').first();
  await rotterdamCard.scrollIntoViewIfNeeded();
  const rotterdamName = await rotterdamCard.locator('.place-card__name').innerText();
  await rotterdamCard.click();
  const addRotterdam = page.locator('.place-detail').getByRole('button', { name: 'Add to plan' });
  await addRotterdam.click();
  const conflict = page.getByRole('region', { name: 'Keep the existing draft?' });
  await expect(conflict).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null')))
    .toMatchObject({ cityId: 'amsterdam', placeIds: originalDraft!.placeIds });
  await conflict.getByRole('button', { name: 'Keep existing' }).click();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null')))
    .toMatchObject({ cityId: 'amsterdam', placeIds: originalDraft!.placeIds });

  await addRotterdam.click();
  await expect(conflict).toBeVisible();
  await conflict.getByRole('button', { name: 'Start new for Rotterdam' }).click();
  const replacementDraft = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null') as {
      cityId: string;
      placeIds: string[];
    } | null,
  );
  expect(replacementDraft?.cityId).toBe('rotterdam');
  expect(replacementDraft?.placeIds).toHaveLength(1);
  expect(replacementDraft!.placeIds.every((id) => rotterdamPlaces.some((place) => place.id === id))).toBe(true);
  expect(replacementDraft!.placeIds.some((id) => amsterdamPlaces.some((place) => place.id === id))).toBe(false);
  expect(amsterdamName).not.toBe(rotterdamName);

  const testPlanIds: string[] = [];
  let testFailed = false;
  try {
    const listRead = page.waitForResponse((response) => isPlansListRead(response));
    await page.locator('app-main-navigation a[href="/plans"]').click();
    await listRead;
    await page.getByRole('link', { name: 'Create a plan', exact: true }).click();
    const savedPlanName = `Rotterdam without mixing cities ${randomUUID()}`;
    await page.locator('#plan-name').fill(savedPlanName);
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
    if (postResponse.status() !== 201) {
      throw new Error(`Real plan POST returned ${postResponse.status()}: ${await postResponse.text()}`);
    }
    const created = await postResponse.json() as { id: string; cityId: string; placeIds: string[] };
    expect(postResponse.headers()['location']).toBe(`/api/plans/${created.id}`);
    expect(created.cityId).toBe('rotterdam');
    expect(created.placeIds).toEqual(replacementDraft!.placeIds);
    expect(created.placeIds.every((id) => rotterdamPlaces.some((place) => place.id === id))).toBe(true);
    await expect(page).toHaveURL(`/plans/${created.id}`);
    await deletePlanThroughUi(page);
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    await cleanupCreatedPlans(page, testPlanIds, testFailed);
  }
});

test('keeps all 13 real draft places through refresh and saves after one explicit removal', async ({ page }) => {
  test.setTimeout(60_000);
  const amsterdamPlaces = await getActualPlaces(page, 'amsterdam');
  const thirteenPlaces = amsterdamPlaces.slice(0, 13);
  expect(thirteenPlaces).toHaveLength(13);
  const placeIds = thirteenPlaces.map((place) => place.id);
  await page.goto('/plans');
  const draftName = `Thirteen real stops ${randomUUID()}`;
  await seedTabDraft(page, {
    cityId: 'amsterdam',
    name: draftName,
    placeIds,
    updatedAt: '2026-11-10T12:00:00.000Z',
  });
  await page.goto('/plans/new?city=amsterdam');
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
    const savedName = `Twelve verified stops ${randomUUID()}`;
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
  await page.goto('/plans/new?city=amsterdam');
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
    cityId: 'amsterdam',
    placeIds,
  });
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await expect(page.locator('#plan-name')).toBeDisabled();
  await expect(page.locator('#plan-city')).toBeDisabled();
  const firstRow = page.locator('.editor-place').first();
  await expect(firstRow.locator('.editor-icon-button').nth(1)).toBeDisabled();
  await expect(firstRow.locator('.editor-remove')).toBeDisabled();

  await page.locator('.editor-back').click();
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
  const mobilePlanName = `Mobile quality check ${randomUUID()}`;
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
    await expect(page.locator('.saved-plan-card')).toBeVisible();
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
  const screenshotsDirectory = join(process.cwd(), 'test-results', 'hop004-e-visual-review');
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
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        path: join(screenshotsDirectory, `list-empty-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
        style: 'app-main-navigation .bottom-nav { position: static !important; inset: auto !important; margin-top: 20px !important; }',
      });
    }
    await page.unroute('**/api/plans');

    const places = await getActualPlaces(page, 'amsterdam');
    const planName = 'A quiet day beside the canals';
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
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        path: join(screenshotsDirectory, `list-populated-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
        style: 'app-main-navigation .bottom-nav { position: static !important; inset: auto !important; margin-top: 20px !important; }',
      });
    }

    await seedTabDraft(page, {
      cityId: 'amsterdam',
      name: 'An afternoon of art and architecture',
      placeIds: places.slice(0, 3).map((place) => place.id),
      updatedAt: '2026-11-10T12:00:00.000Z',
    });
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/plans/new?city=amsterdam');
      await expect(page.locator('.editor-place')).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        path: join(screenshotsDirectory, `create-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
        style: 'app-main-navigation .bottom-nav { position: static !important; inset: auto !important; margin-top: 20px !important; }',
      });
    }

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/plans/${created.id}`);
      await expect(page.locator('#saved-plan-name')).toHaveValue(planName);
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        path: join(screenshotsDirectory, `details-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
        style: 'app-main-navigation .bottom-nav { position: static !important; inset: auto !important; margin-top: 20px !important; }',
      });

      await page.locator('#saved-plan-name').fill(`${planName} edited`);
      await page.locator('.details-topbar-link').click();
      const discardDialog = page.locator('#discard-plan-edits');
      await expect(discardDialog).toBeVisible();
      await page.screenshot({
        path: join(screenshotsDirectory, `discard-dialog-${viewport.width}x${viewport.height}.png`),
        fullPage: false,
      });
      await discardDialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
      await expect(discardDialog).toBeHidden();
      await page.locator('#saved-plan-name').fill(planName);

      const deleteButton = page.getByRole('button', { name: 'Delete plan', exact: true });
      await deleteButton.click();
      const deleteDialog = page.locator('#delete-plan-confirmation');
      await expect(deleteDialog).toBeVisible();
      await expect(deleteDialog).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        path: join(screenshotsDirectory, `delete-dialog-${viewport.width}x${viewport.height}.png`),
        fullPage: false,
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

test('keeps search and tab draft usable when the OpenFreeMap style is unavailable', async ({ page }) => {
  test.setTimeout(20_000);
  await page.unroute('**/styles/liberty');
  await page.route(openFreeMapStyleUrl, (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'Map style unavailable in this test' }),
  );

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.place-card').first()).toBeVisible();

  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 800 : width === 390 ? 844 : 900 });
    await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible();
    await expect(page.locator('.map-caption')).toContainText('Map style © OpenFreeMap');
    await expect(page.locator('.map-caption')).toContainText('Map data © OpenStreetMap contributors');

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(width);
    const fallbackBounds = await page.locator('.map-viewport__fallback').boundingBox();
    const caption = page.locator('.map-caption');
    await caption.scrollIntoViewIfNeeded();
    const captionBounds = await caption.boundingBox();
    expect(fallbackBounds).not.toBeNull();
    expect(captionBounds).not.toBeNull();
    expect(captionBounds!.x).toBeGreaterThanOrEqual(0);
    expect(captionBounds!.x + captionBounds!.width).toBeLessThanOrEqual(width);
  }

  const placeName = await page.locator('.place-card__name').first().innerText();
  await page.locator('#place-search').fill(placeName);
  await expect(page.locator('.place-card')).toHaveCount(1);
  const card = page.locator('.place-card').first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.locator('.place-detail').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.locator('.draft-feedback')).toContainText('Added 1 place to the tab draft');
});

test('Map navigation preserves Rotterdam and Utrecht on mobile with a draft and unavailable tiles', async ({ page }) => {
  test.setTimeout(30_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.unroute(openFreeMapStyleUrl);
  await page.route(openFreeMapStyleUrl, (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'Map style unavailable in this test' }),
  );

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible({ timeout: 15_000 });
  const citySelect = page.getByRole('combobox', { name: 'Choose a city' });
  await citySelect.selectOption('rotterdam');
  await expect(page.locator('.place-results__heading')).toContainText('ROTTERDAM');

  const firstPlace = page.locator('.place-card').first();
  await expect(firstPlace).toBeVisible();
  await firstPlace.click();
  await page.locator('.place-detail').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.locator('.draft-feedback')).toContainText('Added 1 place to the tab draft');
  const draftBeforeNavigation = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null'),
  );
  expect(draftBeforeNavigation.cityId).toBe('rotterdam');

  const mapRegion = page.locator('#map-region');
  const mapLink = page.locator('.bottom-nav__item').filter({ hasText: 'Map' });
  await mapLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?city=rotterdam#map-region$/);
  await expect(mapRegion).toBeFocused();
  await expect(mapRegion).toBeInViewport();

  await citySelect.scrollIntoViewIfNeeded();
  await citySelect.selectOption('utrecht');
  await expect(page.locator('.place-results__heading')).toContainText('UTRECHT');
  await expect(page).toHaveURL(/\?city=utrecht$/);
  await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible();

  await mapLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?city=utrecht#map-region$/);
  await expect(mapRegion).toBeFocused();
  await expect(mapRegion).toBeInViewport();
  const draftAfterNavigation = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null'),
  );
  expect(draftAfterNavigation).toEqual(draftBeforeNavigation);
});

test('keeps catalog selection usable after map tiles fail following style load', async ({ page }) => {
  test.setTimeout(30_000);
  let failTiles = false;
  let failedTileRequests = 0;
  const tileFailureBudget = 2;
  await page.unroute(openFreeMapStyleUrl);
  await page.route(openFreeMapStyleUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tileOutageStyle),
    }),
  );
  await page.route('**/__e2e/tiles/**', async (route) => {
    if (failTiles && failedTileRequests < tileFailureBudget) {
      failedTileRequests += 1;
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Synthetic tile outage' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'image/png', body: transparentTile });
  });

  await page.goto('/');
  await expect(page.locator('.map-viewport__canvas canvas')).toBeVisible();
  await expect(page.locator('.map-viewport__loading')).toHaveCount(0);
  await expect(page.locator('.map-viewport__fallback')).toHaveCount(0);

  failTiles = true;
  await page.getByRole('combobox', { name: 'Choose a city' }).selectOption('rotterdam');
  await expect(page.locator('.place-results__heading')).toContainText('ROTTERDAM');
  await expect.poll(() => failedTileRequests).toBeGreaterThan(0);
  await expect(page.locator('.map-viewport__fallback')).toHaveCount(0);

  const firstCard = page.locator('.place-card').first();
  await expect(firstCard).toBeVisible();
  const placeName = await firstCard.locator('.place-card__name').innerText();
  await firstCard.click();
  await expect(page.locator('.place-detail')).toContainText(placeName);
  await page.locator('.place-detail').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.locator('.draft-feedback')).toContainText('Added 1 place to the tab draft');
});

test('fits mobile, tablet and desktop targets without horizontal overflow or covered attribution', async ({ page }) => {
  test.setTimeout(240_000);
  const screenshotsDirectory = join(process.cwd(), 'test-results', 'hop004-e-visual-review');
  await mkdir(screenshotsDirectory, { recursive: true });
  await page.goto('/');
  await expect(page.locator('.map-viewport__canvas canvas')).toBeVisible();

  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('combobox', { name: 'Choose a city' })).toBeVisible();
    await expect(page.locator('.filter-row')).toBeVisible();
    await expect(page.locator('.map-caption')).toContainText('Map style');
    await expect.poll(async () => page.locator('.map-viewport__canvas').evaluate((mapHost) => {
      const canvas = mapHost.querySelector('canvas');
      return canvas === null ? 0 : Math.abs(mapHost.clientWidth - canvas.clientWidth);
    })).toBeLessThanOrEqual(2);

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewport.width);

    const caption = page.locator('.map-caption');
    await caption.scrollIntoViewIfNeeded();
    const captionBox = await caption.boundingBox();
    const navigationBox = await page.locator('.bottom-nav').boundingBox();
    if (captionBox !== null && navigationBox !== null) {
      expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(navigationBox.y);
    }

    const viewportLabel = `${viewport.width}x${viewport.height}`;
    await page.screenshot({
      path: join(screenshotsDirectory, `explore-amsterdam-${viewportLabel}.png`),
      fullPage: true,
      style: 'app-main-navigation .bottom-nav { position: static !important; inset: auto !important; margin-top: 20px !important; }',
    });

    const citySelect = page.getByRole('combobox', { name: 'Choose a city' });
    await citySelect.selectOption('rotterdam');
    await expect(page.locator('.place-results__heading')).toContainText('ROTTERDAM');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: join(screenshotsDirectory, `explore-rotterdam-${viewportLabel}.png`),
      fullPage: true,
      style: 'app-main-navigation .bottom-nav { position: static !important; inset: auto !important; margin-top: 20px !important; }',
    });

    await citySelect.selectOption('amsterdam');
    await expect(page.locator('.place-results__heading')).toContainText('AMSTERDAM');
    const firstCard = page.locator('.place-card').first();
    await firstCard.scrollIntoViewIfNeeded();
    await firstCard.click();
    await expect(page.locator('.place-detail')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: join(screenshotsDirectory, `selected-poi-${viewportLabel}.png`),
      fullPage: false,
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('.place-detail')).toHaveCount(0);

    await page.getByRole('button', { name: 'Architecture Hunt' }).click();
    await expect(page.locator('.discover-pick').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: join(screenshotsDirectory, `discover-active-${viewportLabel}.png`),
      fullPage: true,
      style: 'app-main-navigation .bottom-nav { position: static !important; inset: auto !important; margin-top: 20px !important; }',
    });

    await page.unroute(openFreeMapStyleUrl);
    await page.route(openFreeMapStyleUrl, (route) =>
      route.fulfill({ status: 503, contentType: 'text/plain', body: 'Map unavailable for visual review' }),
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: join(screenshotsDirectory, `map-unavailable-${viewportLabel}.png`),
      fullPage: true,
      style: 'app-main-navigation .bottom-nav { position: static !important; inset: auto !important; margin-top: 20px !important; }',
    });
    await page.unroute(openFreeMapStyleUrl);
    await page.route(openFreeMapStyleUrl, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isolatedStyle) }),
    );
    await page.unroute('**/__e2e/glyphs/**');
    await page.route('**/__e2e/glyphs/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) }),
    );
    await page.reload();
    await expect(page.locator('.map-viewport__canvas canvas')).toBeVisible();
  }
});

async function useIsolatedMapStyle(page: Page): Promise<void> {
  await page.route(openFreeMapStyleUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(isolatedStyle),
    }),
  );
  await page.route('**/__e2e/glyphs/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) }),
  );
}

type TabDraftSeed = Readonly<{
  cityId: string;
  name: string;
  placeIds: readonly string[];
  updatedAt: string;
}>;

async function seedTabDraft(page: Page, draft: TabDraftSeed): Promise<void> {
  await page.evaluate((value) => {
    sessionStorage.setItem('hopon:draft:v1', JSON.stringify({ schemaVersion: 1, ...value }));
  }, { ...draft, placeIds: [...draft.placeIds] });
}

async function cleanupCreatedPlans(
  page: Page,
  planIds: readonly string[],
  preservePrimaryFailure: boolean,
): Promise<void> {
  const failures: string[] = [];
  for (const planId of [...new Set(planIds)].reverse()) {
    try {
      const response = await page.request.delete(`http://127.0.0.1:4300/api/plans/${planId}`);
      if (![204, 404].includes(response.status())) {
        failures.push(`DELETE ${planId} returned ${response.status()}.`);
      }
    } catch (error) {
      failures.push(`DELETE ${planId} failed: ${String(error)}.`);
    }
  }
  if (failures.length === 0) {
    return;
  }

  const message = `Test-plan cleanup also failed: ${failures.join(' ')}`;
  if (preservePrimaryFailure) {
    console.error(message);
    return;
  }
  throw new Error(message);
}

function planIdFromLocation(location: string | undefined): string | null {
  if (location === undefined) {
    return null;
  }
  try {
    const pathname = new URL(location, 'http://hopon.local').pathname;
    return /^\/api\/plans\/([0-9a-f-]{36})$/i.exec(pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

type ActualPlace = Readonly<{ id: string; cityId: string; name: string }>;

async function getActualPlaces(page: Page, cityId: string): Promise<ActualPlace[]> {
  const response = await page.request.get(
    `http://127.0.0.1:4300/api/places?cityId=${encodeURIComponent(cityId)}`,
  );
  expect(response.status()).toBe(200);
  const places = await response.json() as ActualPlace[];
  expect(places.length).toBeGreaterThanOrEqual(13);
  expect(places.every((place) => place.cityId === cityId && place.id.length > 0)).toBe(true);
  return places;
}

async function addExplorePlaceFromCard(page: Page, index: number): Promise<string> {
  const card = page.locator('.place-card').nth(index);
  await expect(card).toBeVisible();
  const placeName = await card.locator('.place-card__name').innerText();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.locator('.place-detail').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.locator('.draft-feedback')).toContainText(/Added 1 place to the tab draft/);
  return placeName;
}

function isPlansListRead(response: Response): boolean {
  return response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/plans'
    && !new URL(response.url()).search;
}

async function deletePlanThroughUi(page: Page): Promise<void> {
  const planId = new URL(page.url()).pathname.split('/').at(-1);
  if (!planId) {
    throw new Error('Expected a saved plan details route before deleting the plan.');
  }
  const deleteResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'DELETE'
      && new URL(response.url()).pathname === `/api/plans/${planId}`,
  );
  await page.getByRole('button', { name: 'Delete plan', exact: true }).click();
  const confirmation = page.locator('#delete-plan-confirmation');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Delete plan', exact: true }).click();
  expect((await deleteResponsePromise).status()).toBe(204);
  await expect(page).toHaveURL(/\/plans$/);
}
