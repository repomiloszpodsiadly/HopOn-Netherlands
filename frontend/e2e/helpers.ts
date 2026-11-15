import { expect, type Page, type Response } from '@playwright/test';

export const openFreeMapStyleUrl = 'https://tiles.openfreemap.org/styles/liberty';
export const isolatedStyle = {
  version: 8,
  name: 'HopOn deterministic E2E style',
  glyphs: 'http://127.0.0.1:4300/__e2e/glyphs/{fontstack}/{range}.pbf',
  sources: {
    'fixture-attribution': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      attribution: 'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f1eee6' },
    },
    { id: 'fixture-attribution', type: 'circle', source: 'fixture-attribution' },
  ],
};
export const tileOutageStyle = {
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
export const transparentTile = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+p5qgoAAAAABJRU5ErkJggg==',
  'base64',
);

export async function prepareExplorePage(page: Page): Promise<void> {
  page.on('requestfailed', (request) => {
    if (request.url().toLowerCase().includes('worker')) {
      console.log(`MapLibre worker request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
    }
  });
  await useIsolatedMapStyle(page);
}

export async function useIsolatedMapStyle(page: Page): Promise<void> {
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

export async function waitForMapReady(page: Page): Promise<void> {
  const mapCanvas = page.locator('.map-viewport__canvas');
  await expect(mapCanvas).toHaveAttribute('data-map-ready', 'true', { timeout: 15_000 });
  await expect(mapCanvas).toHaveAttribute('data-map-places-ready', 'true', { timeout: 15_000 });
}

export async function assertRealViewportGeometry(
  page: Page,
  viewport: Readonly<{ width: number; height: number }>,
): Promise<void> {
  const geometry = await page.evaluate(() => {
    const navigation = document.querySelector('app-main-navigation .bottom-nav');
    const bounds = navigation?.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      navigationPosition: navigation === null ? null : getComputedStyle(navigation).position,
      navigationTop: bounds?.top ?? null,
      navigationBottom: bounds?.bottom ?? null,
    };
  });

  expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width);
  if (viewport.width <= 760) {
    expect(geometry.navigationPosition).toBe('fixed');
    expect(geometry.navigationTop).not.toBeNull();
    expect(geometry.navigationBottom).not.toBeNull();
    expect(geometry.navigationTop!).toBeGreaterThan(viewport.height - 140);
    expect(geometry.navigationBottom!).toBeLessThanOrEqual(viewport.height);
  }
}

export type TabDraftSeed = Readonly<{
  cityId: string;
  name: string;
  description?: string;
  placeIds: readonly string[];
  updatedAt: string;
}>;

export async function seedTabDraft(page: Page, draft: TabDraftSeed): Promise<void> {
  await page.evaluate((value) => {
    sessionStorage.setItem('hopon:draft:v1', JSON.stringify({ schemaVersion: 1, ...value }));
  }, { ...draft, placeIds: [...draft.placeIds] });
}

export async function cleanupCreatedPlans(
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

export function planIdFromLocation(location: string | undefined): string | null {
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

export type ActualPlace = Readonly<{ id: string; cityId: string; name: string; category: string }>;

export async function getActualPlaces(page: Page, cityId: string): Promise<ActualPlace[]> {
  const response = await page.request.get(
    `http://127.0.0.1:4300/api/places?cityId=${encodeURIComponent(cityId)}`,
  );
  expect(response.status()).toBe(200);
  const places = await response.json() as ActualPlace[];
  expect(places.length).toBeGreaterThanOrEqual(13);
  expect(places.every((place) => place.cityId === cityId && place.id.length > 0)).toBe(true);
  return places;
}

export async function addExplorePlaceFromCard(page: Page, index: number): Promise<string> {
  const card = page.locator('.place-card').nth(index);
  await expect(card).toBeVisible();
  const placeName = await card.locator('.place-card__name').innerText();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await confirmMapAddition(page);
  return placeName;
}

export async function openExplorePlaceByName(page: Page, placeName: string) {
  await page.locator('#place-search').fill(placeName);
  const card = page.locator('.place-card').filter({ hasText: placeName });
  await expect(card).toHaveCount(1);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.locator('.place-detail')).toContainText(placeName);
  return card;
}

export async function addExplorePlaceByName(page: Page, placeName: string): Promise<string> {
  await openExplorePlaceByName(page, placeName);
  await confirmMapAddition(page);
  return placeName;
}

export async function confirmMapAddition(page: Page) {
  const saved = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname.startsWith('/api/plans/'));
  await page.locator('.place-detail').getByRole('button', { name: /^Add to (saved )?plan$/ }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const plan = await response.json() as { id: string; name: string; placeIds: string[] };
  await expect(page.getByRole('link', { name: 'Review current plan', exact: true })).toHaveAttribute('href', `/plans/${plan.id}`);
  await expect(page.locator('.draft-count')).toHaveText(`${plan.placeIds.length} / 12`);
  return plan;
}

export function trackAutosavedPlans(page: Page, ids: string[]) {
  page.on('response', response => {
    const match = /^\/api\/plans\/([\da-f-]{36})\/autosave$/i.exec(new URL(response.url()).pathname);
    if (response.request().method() === 'PUT' && response.status() === 200 && match) ids.push(match[1]);
  });
}

export function isPlansListRead(response: Response): boolean {
  return response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/plans'
    && !new URL(response.url()).search;
}

export async function deletePlanThroughUi(page: Page): Promise<void> {
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
