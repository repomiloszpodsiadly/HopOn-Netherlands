import { expect, test } from '@playwright/test';
import {
  prepareExplorePage,
  waitForMapReady,
  getActualPlaces,
  openExplorePlaceByName,
  openFreeMapStyleUrl,
  tileOutageStyle,
  transparentTile,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareExplorePage(page);
});

test('keeps successful city catalogs searchable during a delayed city and recovers a failed city on retry', async ({ page }) => {
  const [amsterdamPlaces, rotterdamPlaces, utrechtPlaces] = await Promise.all([
    getActualPlaces(page, 'amsterdam'),
    getActualPlaces(page, 'rotterdam'),
    getActualPlaces(page, 'utrecht'),
  ]);
  let releaseUtrecht: () => void = () => undefined;
  const utrechtGate = new Promise<void>((resolve) => {
    releaseUtrecht = resolve;
  });
  let rotterdamRequests = 0;
  let utrechtRequests = 0;
  await page.route('**/api/places?*', async (route) => {
    const cityId = new URL(route.request().url()).searchParams.get('cityId');
    if (cityId === 'amsterdam') {
      await route.fulfill({ json: amsterdamPlaces });
      return;
    }
    if (cityId === 'rotterdam') {
      rotterdamRequests += 1;
      if (rotterdamRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 503, detail: 'Rotterdam catalog fixture unavailable' }),
        });
      } else {
        await route.fulfill({ json: rotterdamPlaces });
      }
      return;
    }
    if (cityId === 'utrecht') {
      utrechtRequests += 1;
      if (utrechtRequests === 1) {
        await utrechtGate;
      }
      await route.fulfill({ json: utrechtPlaces });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await expect(page.locator('.place-card')).toHaveCount(40);
  await expect(page.locator('.city-catalog-status')).toContainText('Places unavailable for Rotterdam');
  await expect(page.locator('.city-catalog-status')).toContainText('Loading places for Utrecht');
  await expect(page.locator('.map-viewport__canvas')).toHaveAttribute('data-map-places-ready', 'true');
  await expect(page.locator('.place-card__city').first()).toHaveText('Amsterdam');
  await page.locator('#place-search').fill('Royal Palace');
  await expect(page.locator('.place-card__name')).toHaveText(['Royal Palace']);

  releaseUtrecht();
  await expect(page.locator('.city-catalog-status')).not.toContainText('Loading places for Utrecht');
  await expect(page.locator('.city-catalog-status')).toContainText('Places unavailable for Rotterdam');
  await page.locator('#place-search').fill('Dom Tower');
  await expect(page.locator('.place-card__name')).toHaveText(['Dom Tower']);
  await expect(page.locator('.place-card__city')).toHaveText(['Utrecht']);

  await page.locator('.city-catalog-status__item--error button').click();
  await expect(page.locator('.city-catalog-status')).toHaveCount(0);
  expect(rotterdamRequests).toBe(2);
  expect(utrechtRequests).toBe(2);
  await page.locator('#place-search').fill('Erasmus Bridge');
  await expect(page.locator('.place-card__name')).toHaveText(['Erasmus Bridge']);
  await expect(page.locator('.place-card__city')).toHaveText(['Rotterdam']);
  await expect(page.locator('.map-viewport__canvas')).toHaveAttribute('data-map-places-ready', 'true');
});

test('shows a city-specific hub failure and distinguishes recovery from a successful empty catalog', async ({ page }) => {
  let utrechtHubRequests = 0;
  await page.route('**/api/stops?*', async (route) => {
    const cityId = new URL(route.request().url()).searchParams.get('cityId');
    if (cityId !== 'utrecht') {
      await route.continue();
      return;
    }
    utrechtHubRequests += 1;
    if (utrechtHubRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 503, detail: 'Utrecht hub fixture unavailable' }),
      });
      return;
    }
    await route.fulfill({ json: [] });
  });

  await page.goto('/');
  await openExplorePlaceByName(page, 'Dom Tower');
  await expect(page.locator('.place-detail')).toContainText('Hub information unavailable for Utrecht');
  await expect(page.locator('.place-detail')).not.toContainText('No curated nearby hub listed.');

  await page.locator('.nearby-error').getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.nearby-error')).toHaveCount(0);
  await expect(page.locator('.nearby-message')).toContainText('No curated nearby hub listed in the loaded Utrecht catalog.');
  expect(utrechtHubRequests).toBe(2);
});

test('keeps search and tab draft usable when the OpenFreeMap style is unavailable', async ({ page }) => {
  await page.route('**/api/plans/*/autosave', route => route.abort('connectionfailed'));
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
    await expect(page.locator('.map-viewport__attribution')).toContainText('OpenFreeMap');
    await expect(page.locator('.map-viewport__attribution')).toContainText('OpenStreetMap contributors');

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(width);
    const fallbackBounds = await page.locator('.map-viewport__fallback').boundingBox();
    const attribution = page.locator('.map-viewport__attribution');
    await attribution.scrollIntoViewIfNeeded();
    const attributionBounds = await attribution.boundingBox();
    expect(fallbackBounds).not.toBeNull();
    expect(attributionBounds).not.toBeNull();
    expect(attributionBounds!.x).toBeGreaterThanOrEqual(0);
    expect(attributionBounds!.x + attributionBounds!.width).toBeLessThanOrEqual(width);

    if (width <= 390) {
      const card = page.locator('.place-card').first();
      const placeName = (await card.locator('.place-card__name').innerText()).trim();
      await card.scrollIntoViewIfNeeded();
      await card.click();
      await expect(page.locator('.place-detail')).toContainText(placeName);
      await page.keyboard.press('Escape');
      await expect(page.locator('.place-detail')).toHaveCount(0);
      await expect(card).toBeFocused();
    }
  }

  const placeName = await page.locator('.place-card__name').first().innerText();
  await page.locator('#place-search').fill(placeName);
  await expect(page.locator('.place-card')).toHaveCount(1);
  const card = page.locator('.place-card').first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.locator('.place-detail').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.locator('.draft-feedback').filter({ hasText: 'Added 1 place to the tab draft' }))
    .toHaveText('Added 1 place to the tab draft.');
  await page.setViewportSize({ width: 390, height: 844 });
  const draftLayout = await page.evaluate(() => {
    const draft = document.querySelector('.draft-panel')!;
    const places = document.querySelector('.place-results')!;
    return {
      draftBottom: draft.getBoundingClientRect().bottom,
      placeListTop: places.getBoundingClientRect().top,
    };
  });
  expect(draftLayout.draftBottom).toBeLessThanOrEqual(draftLayout.placeListTop);
  await expect(page.getByRole('link', { name: 'Review current plan' })).toBeVisible();
});

test('Map navigation focuses the shared map and keeps the tab draft when tiles are unavailable', async ({ page }) => {
  await page.route('**/api/plans/*/autosave', route => route.abort('connectionfailed'));
  test.setTimeout(30_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.unroute(openFreeMapStyleUrl);
  await page.route(openFreeMapStyleUrl, (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'Map style unavailable in this test' }),
  );

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible({ timeout: 15_000 });
  await openExplorePlaceByName(page, 'Erasmus Bridge');
  await expect(page.locator('.place-detail')).toContainText('Rotterdam');
  await page.locator('.place-detail').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.locator('.draft-feedback').filter({ hasText: 'Added 1 place to the tab draft' }))
    .toHaveText('Added 1 place to the tab draft.');
  const draftBeforeNavigation = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null'),
  );
  expect(draftBeforeNavigation.cityId).toBe('rotterdam');

  const mapRegion = page.locator('#map-region');
  const mapLink = page.locator('.bottom-nav__item').filter({ hasText: 'Map' });
  await mapLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/#map-region$/);
  await expect(mapRegion).toBeFocused();
  await expect(mapRegion).toBeInViewport();

  await page.locator('#place-search').fill('Dom Tower');
  const utrechtCard = page.locator('.place-card').filter({ hasText: 'Dom Tower' });
  await expect(utrechtCard).toHaveCount(1);
  await utrechtCard.click();
  await expect(page.locator('.place-detail')).toContainText('Utrecht');
  await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible();

  await mapLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/#map-region$/);
  await expect(mapRegion).toBeFocused();
  await expect(mapRegion).toBeInViewport();
  const draftAfterNavigation = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null'),
  );
  expect(draftAfterNavigation).toEqual(draftBeforeNavigation);
});

test('keeps catalog selection usable after map tiles fail following style load', async ({ page }) => {
  await page.route('**/api/plans/*/autosave', route => route.abort('connectionfailed'));
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
  await waitForMapReady(page);
  await expect(page.locator('.map-viewport__loading')).toHaveCount(0);
  await expect(page.locator('.map-viewport__fallback')).toHaveCount(0);

  failTiles = true;
  await page.locator('.maplibregl-ctrl-zoom-in').click();
  await expect.poll(() => failedTileRequests).toBeGreaterThan(0);
  await expect(page.locator('.map-viewport__fallback')).toHaveCount(0);

  await openExplorePlaceByName(page, 'Erasmus Bridge');
  await expect(page.locator('.place-detail')).toContainText('Rotterdam');
  await page.locator('.place-detail').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.locator('.draft-feedback').filter({ hasText: 'Added 1 place to the tab draft' }))
    .toHaveText('Added 1 place to the tab draft.');
});
