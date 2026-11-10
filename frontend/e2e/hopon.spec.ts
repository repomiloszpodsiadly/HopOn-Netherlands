import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
  await expect(page.locator('.draft-panel .section-heading span')).toHaveText(`${pickCount} PLACES`);

  await page.reload();
  await expect(page.locator('.draft-panel .section-heading span')).toHaveText(`${pickCount} PLACES`);

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
  await expect(page.locator('.draft-panel .section-heading span')).toHaveText('1 PLACE');
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
  const screenshotsDirectory = join(tmpdir(), 'hopon-visual-check');
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

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewport.width);

    const caption = page.locator('.map-caption');
    await caption.scrollIntoViewIfNeeded();
    const captionBox = await caption.boundingBox();
    const navigationBox = await page.locator('.bottom-nav').boundingBox();
    if (captionBox !== null && navigationBox !== null) {
      expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(navigationBox.y);
    }

    await page.screenshot({
      path: join(screenshotsDirectory, `viewport-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
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
