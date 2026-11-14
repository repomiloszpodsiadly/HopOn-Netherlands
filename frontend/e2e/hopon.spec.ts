import { expect, test, type Page, type Response } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const openFreeMapStyleUrl = 'https://tiles.openfreemap.org/styles/liberty';
const isolatedStyle = {
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

test('loads one shared catalog from all three cities without a city picker', async ({ page }) => {
  const requestedCityIds = new Set<string>();
  await page.route('**/api/places?*', async (route) => {
    const cityId = new URL(route.request().url()).searchParams.get('cityId');
    if (cityId !== null) {
      requestedCityIds.add(cityId);
    }
    await route.continue();
  });

  await page.goto('/');
  await expect(page.locator('.place-card').first()).toBeVisible();
  await expect(page.locator('.place-card')).toHaveCount(40);
  await expect(page.locator('.city-scope')).toContainText('Amsterdam');
  await expect(page.locator('.city-scope')).toContainText('Rotterdam');
  await expect(page.locator('.city-scope')).toContainText('Utrecht');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => [...requestedCityIds].sort()).toEqual(['amsterdam', 'rotterdam', 'utrecht']);

  const catalogs = await Promise.all(['amsterdam', 'rotterdam', 'utrecht'].map((cityId) =>
    getActualPlaces(page, cityId),
  ));
  expect(catalogs.map((places) => places.length).every((count) => count > 0)).toBe(true);
});

test('keeps pointer highlights decorative while filtering and keyboard navigation remain functional', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('.place-card').first()).toBeVisible();
  const all = page.locator('.filter-row').getByRole('button', { name: 'All', exact: true });
  await all.hover({ position: { x: 15, y: 15 } });
  await expect.poll(() => all.evaluate((element) => element.style.getPropertyValue('--light-x'))).not.toBe('');
  const firstPosition = await all.evaluate((element) => element.style.getPropertyValue('--light-x'));
  const width = await all.evaluate((element) => element.clientWidth);
  await all.hover({ position: { x: width - 15, y: 15 } });
  await expect.poll(() => all.evaluate((element) => element.style.getPropertyValue('--light-x'))).not.toBe(firstPosition);

  const museums = page.locator('.filter-row').getByRole('button', { name: 'Museums', exact: true });
  await museums.click();
  await expect(museums).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await all.hover();
  await expect.poll(() => all.evaluate((element) => element.style.getPropertyValue('--light-x'))).toBe('');
  await all.focus();
  await page.keyboard.press('Enter');
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.result-count')).toHaveText('2707 places');

  await page.locator('.draft-editor-link').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/plans\/new/);
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

test('searches and filters a known POI from each city, opens details, and restores focus on Escape', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.map-viewport__canvas canvas')).toBeVisible();
  await waitForMapReady(page);
  await expect(page.locator('.map-viewport__fallback')).toHaveCount(0);
  await page.locator('.filter-row').getByRole('button', { name: 'Architecture', exact: true }).click();

  const knownPlaces = [
    { cityId: 'amsterdam', id: 'amsterdam-relation-3580875', name: 'Royal Palace' },
    { cityId: 'rotterdam', id: 'rotterdam-relation-20774225', name: 'Erasmus Bridge' },
    { cityId: 'utrecht', id: 'utrecht-way-262779230', name: 'Dom Tower' },
  ] as const;
  for (const knownPlace of knownPlaces) {
    const cityPlaces = await getActualPlaces(page, knownPlace.cityId);
    expect(cityPlaces.find((place) => place.id === knownPlace.id)?.name).toBe(knownPlace.name);
    await page.locator('#place-search').fill(knownPlace.name);
    await expect(page.locator('.place-card')).toHaveCount(1);
    const card = page.locator('.place-card').first();
    await expect(card.locator('.place-card__name')).toHaveText(knownPlace.name);
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await expect(page.locator('.place-detail')).toContainText(knownPlace.name);
    await expect(page.locator('.place-detail')).toContainText('Nearby transport hubs');
    await page.keyboard.press('Escape');
    await expect(page.locator('.place-detail')).toHaveCount(0);
    await expect(card).toBeFocused();
  }
});

test('renders correctly licensed featured-photo fixtures across cities and responsive widths', async ({ page }) => {
  const reviewDirectory = join(process.cwd(), 'test-results', 'hop004-c-featured-review');
  const realViewportDirectory = join(process.cwd(), 'test-results', 'hop004-e-real-viewport', 'explore');
  await mkdir(reviewDirectory, { recursive: true });
  await mkdir(realViewportDirectory, { recursive: true });
  const featuredPlaces = [
    {
      cityId: 'amsterdam', id: 'amsterdam-relation-3580875', name: 'Royal Palace',
      imagePath: '/assets/catalog/royal-palace-amsterdam.jpg', imageAttributionId: 'royal-palace-amsterdam',
      author: 'Elekes Andor', license: 'CC BY-SA 4.0',
    },
    {
      cityId: 'rotterdam', id: 'rotterdam-relation-20774225', name: 'Erasmus Bridge',
      imagePath: '/assets/catalog/erasmus-bridge-rotterdam.jpg', imageAttributionId: 'erasmus-bridge-rotterdam',
      author: 'acediscovery', license: 'CC BY 4.0',
    },
    {
      cityId: 'utrecht', id: 'utrecht-way-262779230', name: 'Dom Tower',
      imagePath: '/assets/catalog/dom-tower-utrecht.jpg', imageAttributionId: 'dom-tower-utrecht',
      author: 'tED', license: 'CC BY 2.0',
    },
  ] as const;
  const placesByCity = Object.fromEntries(
    featuredPlaces.map((place) => [place.cityId, {
      id: place.id,
      cityId: place.cityId,
      name: place.name,
      category: 'ARCHITECTURE',
      latitude: 52,
      longitude: 5,
      tags: ['architecture'],
      shortDescription: `Featured ${place.name}.`,
      imagePath: place.imagePath,
      imageAttributionId: place.imageAttributionId,
    }]),
  );

  await page.route('**/api/places?*', async (route) => {
    const cityId = new URL(route.request().url()).searchParams.get('cityId') ?? 'amsterdam';
    const featured = placesByCity[cityId as keyof typeof placesByCity];
    await route.fulfill({ json: featured === undefined ? [] : [featured] });
  });
  await page.goto('/');
  await waitForMapReady(page);
  await expect(page.locator('.place-card')).toHaveCount(3);
  await expect(page.locator('.result-count')).toHaveText('3 places');
  const viewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.place-card')).toHaveCount(3);
    for (const featured of featuredPlaces) {
      const card = page.locator('.place-card').filter({ hasText: featured.name });
      await expect(card).toHaveCount(1);
      await expect(card).toHaveClass(/place-card--featured/);
      await expect(card).toContainText(featured.name);
      const image = card.locator('img');
      await expect(image).toHaveAttribute('src', featured.imagePath);
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);

      const credit = card.locator('xpath=..').locator('.place-card__credit');
      if (!(await credit.evaluate((element) => (element as HTMLDetailsElement).open))) {
        await credit.locator('summary').click();
      }
      await expect(credit).toContainText(featured.author);
      await expect(credit).toContainText(featured.license);
      await expect(credit).toContainText('Resized and re-encoded from the source; displayed with a crop.');
      await expect(credit.locator('a[href^="https://commons.wikimedia.org/"]')).toBeVisible();
      await expect(credit.locator('a[href^="https://creativecommons.org/licenses/"]')).toBeVisible();
      if (viewport.width <= 390) {
        for (const link of await credit.locator('a').all()) {
          const linkBounds = await link.boundingBox();
          expect(linkBounds?.height).toBeGreaterThanOrEqual(44);
        }
      }

      const layout = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        imageWidth: document.querySelector('.place-card__image')?.getBoundingClientRect().width ?? 0,
        mapWidth: document.querySelector('.map-viewport')?.getBoundingClientRect().width ?? 0,
      }));
      expect(layout.documentWidth).toBeLessThanOrEqual(viewport.width);
      expect(layout.imageWidth).toBeGreaterThan(0);
      expect(layout.mapWidth).toBeGreaterThan(0);

      if (featured.cityId === 'amsterdam') {
        await card.locator('xpath=..').screenshot({
          path: join(reviewDirectory, `featured-card-${viewport.width}.png`),
        });
        await page.screenshot({
          path: join(realViewportDirectory, `featured-place-mocked-${viewport.width}x${viewport.height}.png`),
          fullPage: false,
        });
        if (viewport.width === 1440) {
          await page.locator('.workspace').screenshot({
            path: join(reviewDirectory, 'explore-workspace-1440.png'),
          });
        }
      }
    }
  }
});

test('traces draft-to-catalog keyboard focus and visual positions across viewports', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.place-card')).toHaveCount(40);
  await expect(page.locator('.map-viewport__canvas canvas')).toBeVisible();
  await waitForMapReady(page);
  const traceFocus = async () => page.evaluate(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) {
      return null;
    }
    const bounds = focused.getBoundingClientRect();
    return {
      tag: focused.tagName.toLowerCase(),
      className: typeof focused.className === 'string' ? focused.className : '',
      label: (focused.getAttribute('aria-label') ?? focused.innerText ?? '').trim().replace(/\s+/g, ' '),
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      scrollY: window.scrollY,
    };
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const draftCta = page.getByRole('link', { name: 'Start a day plan' });
    await draftCta.focus();
    await page.keyboard.press('Shift+Tab');
    const beforeDraft = await traceFocus();
    await page.keyboard.press('Tab');
    await expect(draftCta).toBeFocused();
    const draft = await traceFocus();
    const layout = await page.evaluate(() => {
      const draftPanel = document.querySelector('.draft-panel');
      const placeResults = document.querySelector('.place-results');
      const map = document.querySelector('.explore-main');
      if (!(draftPanel instanceof HTMLElement) || !(placeResults instanceof HTMLElement) || !(map instanceof HTMLElement)) {
        return null;
      }
      const draftBounds = draftPanel.getBoundingClientRect();
      const placesBounds = placeResults.getBoundingClientRect();
      const mapBounds = map.getBoundingClientRect();
      return {
        draftTop: draftBounds.top,
        draftBottom: draftBounds.bottom,
        draftLeft: draftBounds.left,
        placesLeft: placesBounds.left,
        placesTop: placesBounds.top,
        mapLeft: mapBounds.left,
        mapBottom: mapBounds.bottom,
      };
    });
    console.log(`Explore keyboard trace ${viewport.width}x${viewport.height}: ${JSON.stringify({ beforeDraft, draft, layout })}`);
    expect(layout).not.toBeNull();
    const firstCard = page.locator('.place-card').first();
    await firstCard.focus();
    await expect(firstCard).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.place-detail')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.place-detail')).toHaveCount(0);
    await expect(firstCard).toBeFocused();
    if (viewport.width <= 900) {
      expect(layout!.draftBottom).toBeLessThanOrEqual(layout!.placesTop);
      expect(layout!.placesLeft).toBeCloseTo(layout!.draftLeft, 0);
    } else {
      expect(layout!.placesLeft).toBeLessThan(layout!.mapLeft);
      expect(layout!.draftLeft).toBeCloseTo(layout!.mapLeft, 0);
      expect(layout!.draftTop).toBeGreaterThanOrEqual(layout!.mapBottom);
    }
  }
});

test('offers one reconnect action and recovers again after the map connection is lost', async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.unroute(openFreeMapStyleUrl);
  await page.route(openFreeMapStyleUrl, (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'Controlled map outage' }),
  );
  await page.goto('/');
  await expect(page.locator('.map-viewport__loading')).toHaveCSS('background-color', 'rgb(251, 244, 233)');
  await page.screenshot({ path: testInfo.outputPath('warm-map-loading.png') });
  await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.map-viewport__fallback')).toHaveCSS('background-color', 'rgb(251, 244, 233)');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.map-viewport__fallback').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('warm-map-fallback-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await expect(page.locator('.map-viewport__fallback-actions button')).toHaveCount(1);
  await page.unroute(openFreeMapStyleUrl);
  await page.route(openFreeMapStyleUrl, route => route.fulfill({ json: isolatedStyle }));
  await page.getByRole('button', { name: 'Retry map', exact: true }).click();
  await waitForMapReady(page);
  await page.locator('.map-viewport__canvas canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible();
  await expect(page.locator('.map-viewport__fallback-actions button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry map', exact: true }).click();
  await waitForMapReady(page);
  await expect(page.locator('.map-viewport__fallback')).toHaveCount(0);
  await expect(page.locator('.place-card').first()).toBeVisible();
});

test('keeps the shared draft CTA before the catalog and opens the selected POI city', async ({ page }) => {
  const owned: string[] = [];
  let failed = false;
  trackAutosavedPlans(page, owned);
  try {
  await page.goto('/');
  await expect(page.locator('.place-card').first()).toBeVisible();
  await expect(page.locator('.place-card')).toHaveCount(40);
  await expect(page.getByRole('combobox')).toHaveCount(0);

  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const layout = await page.evaluate(() => {
      const draft = document.querySelector('.draft-panel');
      const places = document.querySelector('.place-results');
      if (!(draft instanceof HTMLElement) || !(places instanceof HTMLElement)) {
        return null;
      }
      const draftBounds = draft.getBoundingClientRect();
      const placeBounds = places.getBoundingClientRect();
      return {
        draftBottom: draftBounds.bottom,
        placeListTop: placeBounds.top,
        documentWidth: document.documentElement.scrollWidth,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout!.draftBottom).toBeLessThanOrEqual(layout!.placeListTop);
    expect(layout!.documentWidth).toBeLessThanOrEqual(viewport.width);
    await expect(page.getByRole('link', { name: 'Start a day plan' })).toBeVisible();
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopLayout = await page.evaluate(() => {
    const map = document.querySelector('.explore-main')!.getBoundingClientRect();
    const draft = document.querySelector('.draft-panel')!.getBoundingClientRect();
    const places = document.querySelector('.place-results')!.getBoundingClientRect();
    return {
      mapLeft: map.left,
      mapBottom: map.bottom,
      draftLeft: draft.left,
      draftTop: draft.top,
      placesLeft: places.left,
    };
  });
  expect(desktopLayout.mapLeft).toBeGreaterThan(desktopLayout.placesLeft);
  expect(desktopLayout.draftLeft).toBeCloseTo(desktopLayout.mapLeft, 0);
  expect(desktopLayout.draftTop).toBeGreaterThanOrEqual(desktopLayout.mapBottom);

  await page.setViewportSize({ width: 390, height: 844 });
  const placeName = 'Erasmus Bridge';
  await openExplorePlaceByName(page, placeName);
  await expect(page.locator('.place-detail')).toContainText('Rotterdam');
  const saved = await confirmMapAddition(page);
  await expect(page.locator('.draft-count')).toHaveText('1 / 12');
  await expect(page.locator('.draft-panel')).toContainText(saved.id ? 'CURRENT PLAN' : '');
  await expect(page.locator('.draft-panel')).not.toContainText('Temporary');
  const reviewLink = page.getByRole('link', { name: 'Review current plan' });
  await reviewLink.focus();
  await expect(reviewLink).toBeFocused();

  const populatedLayout = await page.evaluate(() => {
    const draft = document.querySelector('.draft-panel')!;
    const places = document.querySelector('.place-results')!;
    return {
      draftBottom: draft.getBoundingClientRect().bottom,
      placeListTop: places.getBoundingClientRect().top,
      placeCards: document.querySelectorAll('.place-card').length,
    };
  });
  expect(populatedLayout.draftBottom).toBeLessThanOrEqual(populatedLayout.placeListTop);
  expect(populatedLayout.placeCards).toBe(1);

  await reviewLink.scrollIntoViewIfNeeded();
  await reviewLink.click();
  await expect(page).toHaveURL(`/plans/${saved.id}`);
  await expect(page.locator('#saved-plan-name')).toHaveValue(saved.name);
  await expect(page.locator('.details-city-label')).toHaveText('Starts in Rotterdam');
  await expect(page.locator('.details-stop__copy')).toContainText(placeName);
  } catch (error) { failed = true; throw error; }
  finally { await cleanupCreatedPlans(page, owned, failed); }
});

test('captures the actual initial Explore viewport on compact phones', async ({ page }) => {
  const screenshotsDirectory = join(process.cwd(), 'test-results', 'hop004-b-mobile-review');
  await mkdir(screenshotsDirectory, { recursive: true });
  await page.goto('/');
  await expect(page.locator('.map-viewport__canvas canvas')).toBeVisible();
  await waitForMapReady(page);

  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const layout = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
      };
      return {
        search: bounds('#place-search'),
        filters: bounds('.filter-row'),
        discover: bounds('.discover-panel'),
        map: bounds('.map-viewport__canvas'),
        draft: bounds('.draft-editor-link'),
        navigation: bounds('.bottom-nav'),
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    console.log(`HOP004_B_MOBILE ${viewport.width}x${viewport.height} ${JSON.stringify(layout)}`);
    expect(layout.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(layout.search).not.toBeNull();
    expect(layout.filters?.height).toBeGreaterThan(0);
    expect(layout.discover?.height).toBeGreaterThan(0);
    expect(layout.map?.y).toBeLessThan(layout.navigation!.y);
    expect(layout.map?.y).toBeLessThan(viewport.height * 0.67);
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await page.screenshot({
      path: join(screenshotsDirectory, `explore-initial-${viewport.width}x${viewport.height}.png`),
      fullPage: false,
    });
    for (const selector of ['.filter-row', '.discover-panel']) {
      const section = page.locator(selector);
      await section.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const sectionBounds = await section.boundingBox();
      const navigationBounds = await page.locator('.bottom-nav').boundingBox();
      expect(sectionBounds).not.toBeNull();
      expect(navigationBounds).not.toBeNull();
      expect(sectionBounds!.y).toBeGreaterThanOrEqual(0);
      expect(sectionBounds!.y + sectionBounds!.height).toBeLessThanOrEqual(navigationBounds!.y);
    }
  }
});

test('keeps Explore search usable with a shortened keyboard viewport, landscape and zoom reflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const search = page.locator('#place-search');
  await expect(search).toBeVisible();
  await search.focus();
  await page.keyboard.press('Tab');
  const keyboardFocus = await page.evaluate(() => ({
    isCategoryFilter: document.activeElement?.classList.contains('filter-chip') ?? false,
    outlineWidth: getComputedStyle(document.activeElement!).outlineWidth,
  }));
  expect(keyboardFocus.isCategoryFilter).toBe(true);
  expect(keyboardFocus.outlineWidth).toBe('3px');
  await search.focus();

  // Playwright desktop Chromium has no phone keyboard; reducing the viewport simulates its visible area.
  await page.setViewportSize({ width: 390, height: 480 });
  await expect(search).toBeFocused();
  const keyboardLayout = await page.evaluate(() => {
    const input = document.querySelector('#place-search')!.getBoundingClientRect();
    const nav = document.querySelector('.bottom-nav')!.getBoundingClientRect();
    return {
      visibleHeight: window.visualViewport?.height ?? window.innerHeight,
      inputBottom: input.bottom,
      navigationTop: nav.top,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(keyboardLayout.inputBottom).toBeLessThan(keyboardLayout.visibleHeight);
  expect(keyboardLayout.inputBottom).toBeLessThan(keyboardLayout.navigationTop);
  expect(keyboardLayout.documentWidth).toBeLessThanOrEqual(390);
  await search.fill('Royal');
  await expect(search).toHaveValue('Royal');

  await page.setViewportSize({ width: 844, height: 390 });
  await search.scrollIntoViewIfNeeded();
  const landscapeLayout = await page.evaluate(() => ({
    inputBottom: document.querySelector('#place-search')!.getBoundingClientRect().bottom,
    visibleHeight: window.visualViewport?.height ?? window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(landscapeLayout.inputBottom).toBeLessThan(landscapeLayout.visibleHeight);
  expect(landscapeLayout.documentWidth).toBeLessThanOrEqual(844);

  // A 720 CSS-pixel layout viewport represents a 1440px desktop at 200% browser zoom.
  await page.setViewportSize({ width: 720, height: 900 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const zoomLayout = await page.evaluate(() => {
    const intro = document.querySelector('.intro')!;
    return {
      documentWidth: document.documentElement.scrollWidth,
      introWidth: intro.clientWidth,
      introContentWidth: intro.scrollWidth,
      headingWidth: document.querySelector('#welcome-title')!.getBoundingClientRect().width,
    };
  });
  expect(zoomLayout.documentWidth).toBeLessThanOrEqual(720);
  expect(zoomLayout.introContentWidth).toBeLessThanOrEqual(zoomLayout.introWidth);
  expect(zoomLayout.headingWidth).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotionDuration = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.animation = 'map-spin .8s linear infinite';
    document.body.append(probe);
    const duration = getComputedStyle(probe).animationDuration;
    probe.remove();
    return Number.parseFloat(duration);
  });
  expect(reducedMotionDuration).toBeLessThan(0.001);
});

test('captures real Explore viewport states without screenshot-only styling', async ({ page }) => {
  const owned: string[] = [];
  let failed = false;
  trackAutosavedPlans(page, owned);
  try {
  test.setTimeout(180_000);
  const screenshotsDirectory = join(process.cwd(), 'test-results', 'hop004-e-real-viewport', 'explore');
  const viewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ];
  await mkdir(screenshotsDirectory, { recursive: true });

  for (const viewport of viewports) {
    const size = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.place-card').first()).toBeVisible();
    await expect(page.locator('.city-scope')).toContainText('Amsterdam');
    await expect(page.locator('.city-scope')).toContainText('Rotterdam');
    await expect(page.locator('.city-scope')).toContainText('Utrecht');
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await waitForMapReady(page);
    await assertRealViewportGeometry(page, viewport);
    await page.screenshot({ path: join(screenshotsDirectory, `explore-initial-${size}.png`) });

    const mapAttribution = page.locator('.maplibregl-ctrl-attrib');
    await mapAttribution.scrollIntoViewIfNeeded();
    const attributionBounds = await mapAttribution.boundingBox();
    if (viewport.width <= 760) {
      const navigationBounds = await page.locator('app-main-navigation .bottom-nav').boundingBox();
      expect(attributionBounds).not.toBeNull();
      expect(navigationBounds).not.toBeNull();
      expect(attributionBounds!.y + attributionBounds!.height).toBeLessThanOrEqual(navigationBounds!.y);
    }

    await page.goto('/');
    await waitForMapReady(page);
    if (viewport.width < 1101) {
      await expect(page.locator('.discover-panel')).toBeVisible();
      await page.getByRole('button', { name: 'Architecture Hunt' }).click();
      await expect(page.locator('.discover-city-group')).toHaveCount(3);
      await expect(page.locator('.discover-pick').first()).toBeVisible({ timeout: 15_000 });
      await assertRealViewportGeometry(page, viewport);
      await page.screenshot({ path: join(screenshotsDirectory, `discover-active-${size}.png`) });
    } else {
      await expect(page.locator('.discover-panel')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Architecture Hunt' })).toBeHidden();
    }

    await page.goto('/');
    await waitForMapReady(page);
    const firstCard = page.locator('.place-card').first();
    await firstCard.scrollIntoViewIfNeeded();
    await firstCard.click();
    const detail = page.locator('.place-detail');
    await expect(detail).toBeVisible();
    await detail.locator('.place-detail__close').scrollIntoViewIfNeeded();
    await expect(detail.locator('.place-detail__close')).toBeInViewport();
    const photoCredits = detail.locator('.place-detail__credit');
    await expect(photoCredits.locator('.place-detail__credit-content')).toBeHidden();
    await photoCredits.locator('summary').click();
    await expect(photoCredits.locator('a').first()).toBeVisible();
    await expect(photoCredits).toContainText('Resized and re-encoded from the source; displayed with a crop.');
    await photoCredits.locator('summary').click();
    const detailAddButton = detail.getByRole('button', { name: 'Add to plan' });
    await detailAddButton.scrollIntoViewIfNeeded();
    await expect(detailAddButton).toBeInViewport();
    await assertRealViewportGeometry(page, viewport);
    await page.screenshot({ path: join(screenshotsDirectory, `selected-place-detail-${size}.png`) });
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);

    await addExplorePlaceFromCard(page, 0);
    await expect(page.locator('.draft-count')).toHaveText('1 / 12');
    const draftPanel = page.locator('.draft-panel');
    await draftPanel.scrollIntoViewIfNeeded();
    const draftReviewLink = page.getByRole('link', { name: 'Review current plan' });
    await expect(draftReviewLink).toBeInViewport();
    await assertRealViewportGeometry(page, viewport);
    if (viewport.width <= 760) {
      const draftLinkBounds = await draftReviewLink.boundingBox();
      const navigationBounds = await page.locator('app-main-navigation .bottom-nav').boundingBox();
      expect(draftLinkBounds).not.toBeNull();
      expect(navigationBounds).not.toBeNull();
      expect(draftLinkBounds!.y + draftLinkBounds!.height).toBeLessThanOrEqual(navigationBounds!.y);
    }
    await page.screenshot({ path: join(screenshotsDirectory, `draft-with-pois-${size}.png`) });

    await page.unroute(openFreeMapStyleUrl);
    await page.route(openFreeMapStyleUrl, (route) =>
      route.fulfill({ status: 503, contentType: 'text/plain', body: 'Map unavailable for visual evidence' }),
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible({ timeout: 15_000 });
    await assertRealViewportGeometry(page, viewport);
    await page.locator('.map-viewport__fallback').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotsDirectory, `map-unavailable-mocked-${size}.png`) });
    await page.unroute(openFreeMapStyleUrl);
    await page.route(openFreeMapStyleUrl, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isolatedStyle) }),
    );
    await cleanupCreatedPlans(page, owned.splice(0), false);
    await page.evaluate(() => { sessionStorage.removeItem('hopon:draft:v1'); sessionStorage.removeItem('hopon:active-plan:v1'); });
  }
  } catch (error) { failed = true; throw error; }
  finally { await cleanupCreatedPlans(page, owned, failed); }
});

test('real OpenFreeMap live style smoke [live-map]', async ({ page }) => {
  test.skip(
    process.env.HOPON_LIVE_MAP_SMOKE !== '1',
    'Set HOPON_LIVE_MAP_SMOKE=1 to run this external-service smoke.',
  );
  test.setTimeout(30_000);
  await page.unroute(openFreeMapStyleUrl);
  const styleResponsePromise = waitForOpenFreeMapStyleResponse(page);

  await page.goto('/');
  const styleResponse = await styleResponsePromise;
  assertSuccessfulOpenFreeMapStyleResponse(styleResponse);
  await expect(page.locator('.map-viewport__canvas canvas')).toBeVisible();
  await waitForMapReady(page);
  console.log(
    `HOP004_REAL_OPENFREEMAP_SMOKE PASS: style HTTP ${styleResponse.status()}, canvas visible, MapLibre ready. `
    + 'External tile delivery is not asserted by this smoke.',
  );
});

test('fails the OpenFreeMap smoke check on a simulated HTTP 503', async ({ page }) => {
  await page.unroute(openFreeMapStyleUrl);
  await page.route(openFreeMapStyleUrl, (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'Controlled style outage' }),
  );
  const styleResponsePromise = waitForOpenFreeMapStyleResponse(page);
  await page.goto('/');

  const styleResponse = await styleResponsePromise;
  expect(() => assertSuccessfulOpenFreeMapStyleResponse(styleResponse)).toThrow('HTTP 503');
});

test('does not pass when the OpenFreeMap style response is missing', async ({ page }) => {
  await page.unroute(openFreeMapStyleUrl);
  await page.route(openFreeMapStyleUrl, (route) => route.abort());
  const styleRequestPromise = page.waitForRequest((request) => request.url() === openFreeMapStyleUrl);
  const styleResponsePromise = waitForOpenFreeMapStyleResponse(page, 1_000);
  await page.goto('/');
  await styleRequestPromise;

  await expect(styleResponsePromise).rejects.toThrow();
});

test('keeps desktop Discover hidden while the map and catalog remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.place-card').first()).toBeVisible();
  await expect(page.locator('.map-viewport__canvas canvas')).toBeVisible();
  await waitForMapReady(page);
  // HOP6-002 intentionally hides Discover on desktop; retain coverage at narrower widths below.
  await expect(page.locator('.discover-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Architecture Hunt' })).toBeHidden();

  const desktopGeometry = await page.evaluate(() => ({
    mapWidth: document.querySelector('.map-viewport__canvas')!.getBoundingClientRect().width,
    mapHeight: document.querySelector('.map-viewport__canvas')!.getBoundingClientRect().height,
    documentWidth: document.documentElement.scrollWidth,
    catalogHeading: document.querySelector('.place-results__heading h2')?.textContent?.trim(),
  }));
  expect(desktopGeometry.documentWidth).toBeLessThanOrEqual(1440);
  expect(desktopGeometry.mapWidth).toBeGreaterThan(0);
  expect(desktopGeometry.mapHeight).toBeGreaterThan(0);
  expect(desktopGeometry.catalogHeading).toBe('Places to explore');
  await expect(page.locator('#place-search')).toBeVisible();
  await expect(page.locator('app-main-navigation a[href="/plans"]')).toHaveCount(1);

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.discover-panel')).toBeVisible();
  const mapBefore = await page.locator('.map-viewport__canvas').boundingBox();
  await page.getByRole('button', { name: 'Architecture Hunt' }).click();
  await expect(page.locator('.discover-city-group')).toHaveCount(3);
  for (const cityName of ['Amsterdam', 'Rotterdam', 'Utrecht']) {
    await expect(page.getByRole('region', { name: `Discover picks in ${cityName}` })).toBeVisible();
  }
  const mapAfter = await page.locator('.map-viewport__canvas').boundingBox();
  expect(mapBefore).not.toBeNull();
  expect(mapAfter).not.toBeNull();
  expect(Math.abs(mapAfter!.x - mapBefore!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(mapAfter!.y - mapBefore!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(mapAfter!.width - mapBefore!.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(mapAfter!.height - mapBefore!.height)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
});

test('autosaves each city’s Discover picks once at tablet and mobile widths', async ({ page }) => {
  test.setTimeout(90_000);
  const owned: string[] = [];
  let failed = false;
  try {
    for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const city of [{ id: 'amsterdam', name: 'Amsterdam' }, { id: 'rotterdam', name: 'Rotterdam' }, { id: 'utrecht', name: 'Utrecht' }]) {
        await page.goto('/plans/new?city=' + city.id);
        await page.locator('.editor-cancel').click();
        await page.getByRole('button', { name: 'Architecture Hunt', exact: true }).click();
        const group = page.getByRole('region', { name: 'Discover picks in ' + city.name });
        await expect(group.locator('.discover-pick').first()).toBeVisible();
        const count = await group.locator('.discover-pick').count();
        const save = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/autosave'));
        const add = group.getByRole('button', { name: 'Add ' + city.name + ' picks to plan', exact: true });
        await add.click();
        const response = await save;
        expect(response.status()).toBe(200);
        const plan = await response.json() as { id: string; cityId: string; placeIds: string[] };
        owned.push(plan.id);
        expect(plan.cityId).toBe(city.id);
        expect(plan.placeIds).toHaveLength(count);
        await expect(page.locator('.draft-count')).toHaveText(count + ' / 12');
        await add.click();
        await expect(page.locator('.draft-feedback')).toContainText('already in this plan');
        await page.reload();
        await expect(page.getByRole('link', { name: 'Review current plan', exact: true })).toHaveAttribute('href', '/plans/' + plan.id);
        expect((await page.request.delete('/api/plans/' + plan.id)).status()).toBe(204);
      }
    }
  } catch (error) { failed = true; throw error; }
  finally { await cleanupCreatedPlans(page, owned, failed); }
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
    await expect(page.locator('.details-city-label > span')).toHaveCount(0);
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
    await expect(page.locator('.details-empty')).toContainText('Your plan is saved');
    await page.reload();
    await expect(page.locator('.details-empty')).toContainText('Your plan is saved');
    await expect(page.locator('#add-saved-stop option')).not.toHaveCount(1);
    await page.locator('#add-saved-stop').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Add place', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('.details-stop')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await page.locator('.details-remove-button').click();
    await expect(page.locator('.details-empty')).toContainText('Save changes to update this plan');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.locator('.details-empty')).toContainText('Your plan is saved');
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
  const mobilePlanName = `Mobile quality check ${randomUUID().slice(0, 8)}`;
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
      await assertRealViewportGeometry(page, viewport);
      await page.screenshot({
        path: join(screenshotsDirectory, `list-populated-${viewport.width}x${viewport.height}.png`),
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
  await expect(page.locator('.draft-feedback')).toContainText('Added 1 place to the tab draft');
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
  await expect(page.locator('.draft-feedback')).toContainText('Added 1 place to the tab draft');
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
  await expect(page.locator('.draft-feedback')).toContainText('Added 1 place to the tab draft');
});

test('checks responsive geometry and captures the actual shared-city interface', async ({ page }) => {
  test.setTimeout(240_000);
  const screenshotsDirectory = join(process.cwd(), 'test-results', 'hop004-e-editorial-review');
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
    await page.goto('/');
    await expect(page.locator('.city-scope')).toContainText('Amsterdam');
    await expect(page.locator('.city-scope')).toContainText('Rotterdam');
    await expect(page.locator('.city-scope')).toContainText('Utrecht');
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.locator('.filter-row')).toBeVisible();
    await expect(page.locator('.place-results__heading h2')).toHaveText('Places to explore');
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenFreeMap');
    if (viewport.width <= 390) {
      for (const selector of ['.search-box', '.filter-chip', '.discover-theme', '.bottom-nav__item']) {
        const bounds = await page.locator(selector).first().boundingBox();
        expect(bounds?.width, `${selector} width at ${viewport.width}px`).toBeGreaterThanOrEqual(44);
        expect(bounds?.height, `${selector} height at ${viewport.width}px`).toBeGreaterThanOrEqual(44);
      }
      await expect(page.locator('.discover-panel')).toBeVisible();
    } else if (viewport.width >= 1101) {
      await expect(page.locator('.discover-panel')).toBeHidden();
    }
    await expect.poll(async () => page.locator('.map-viewport__canvas').evaluate((mapHost) => {
      const canvas = mapHost.querySelector('canvas');
      return canvas === null ? 0 : Math.abs(mapHost.clientWidth - canvas.clientWidth);
    })).toBeLessThanOrEqual(2);

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewport.width);

    const attribution = page.locator('.maplibregl-ctrl-attrib');
    await attribution.scrollIntoViewIfNeeded();
    const attributionBox = await attribution.boundingBox();
    const navigationBox = await page.locator('.bottom-nav').boundingBox();
    if (attributionBox !== null && navigationBox !== null) {
      expect(attributionBox.y + attributionBox.height).toBeLessThanOrEqual(navigationBox.y);
    }

    const viewportLabel = `${viewport.width}x${viewport.height}`;
    await page.screenshot({
      path: join(screenshotsDirectory, `editorial-explore-three-cities-${viewportLabel}.png`),
      fullPage: false,
    });

    const featuredForViewport = [
      { width: 360, name: 'Royal Palace' },
      { width: 390, name: 'Erasmus Bridge' },
      { width: 768, name: 'Dom Tower' },
      { width: 1024, name: 'Royal Palace' },
      { width: 1440, name: 'Erasmus Bridge' },
    ].find((place) => place.width === viewport.width)!;
    await page.locator('#place-search').fill(featuredForViewport.name);
    const firstCard = page.locator('.place-card').filter({ hasText: featuredForViewport.name });
    await expect(firstCard).toHaveCount(1);
    await firstCard.scrollIntoViewIfNeeded();
    await firstCard.click();
    const detail = page.locator('.place-detail');
    await expect(detail).toContainText(featuredForViewport.name);
    if (viewport.width <= 390) {
      const closeBounds = await detail.locator('.place-detail__close').boundingBox();
      expect(closeBounds?.width).toBeGreaterThanOrEqual(44);
      expect(closeBounds?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: join(screenshotsDirectory, `editorial-selected-poi-${viewportLabel}.png`) });
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);

    if (viewport.width < 1101) {
      await page.getByRole('button', { name: 'Architecture Hunt' }).click();
      await expect(page.locator('.discover-city-group')).toHaveCount(3);
      await expect(page.locator('.discover-pick').first()).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: join(screenshotsDirectory, `editorial-discover-active-${viewportLabel}.png`) });
    } else {
      await expect(page.locator('.discover-panel')).toBeHidden();
    }

    await page.unroute(openFreeMapStyleUrl);
    await page.route(openFreeMapStyleUrl, (route) =>
      route.fulfill({ status: 503, contentType: 'text/plain', body: 'Map unavailable for visual review' }),
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: join(screenshotsDirectory, `editorial-map-unavailable-${viewportLabel}.png`),
      fullPage: false,
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

function waitForOpenFreeMapStyleResponse(page: Page, timeout = 15_000): Promise<Response> {
  return page.waitForResponse(
    (response) => response.url() === openFreeMapStyleUrl,
    { timeout },
  );
}

function assertSuccessfulOpenFreeMapStyleResponse(response: Response): void {
  expect(response.ok(), `Expected a successful live style response, received HTTP ${response.status()}.`)
    .toBe(true);
}

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

async function waitForMapReady(page: Page): Promise<void> {
  const mapCanvas = page.locator('.map-viewport__canvas');
  await expect(mapCanvas).toHaveAttribute('data-map-ready', 'true', { timeout: 15_000 });
  await expect(mapCanvas).toHaveAttribute('data-map-places-ready', 'true', { timeout: 15_000 });
}

async function assertRealViewportGeometry(
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

type TabDraftSeed = Readonly<{
  cityId: string;
  name: string;
  description?: string;
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

type ActualPlace = Readonly<{ id: string; cityId: string; name: string; category: string }>;

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
  await confirmMapAddition(page);
  return placeName;
}

async function openExplorePlaceByName(page: Page, placeName: string) {
  await page.locator('#place-search').fill(placeName);
  const card = page.locator('.place-card').filter({ hasText: placeName });
  await expect(card).toHaveCount(1);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.locator('.place-detail')).toContainText(placeName);
  return card;
}

async function addExplorePlaceByName(page: Page, placeName: string): Promise<string> {
  await openExplorePlaceByName(page, placeName);
  await confirmMapAddition(page);
  return placeName;
}

async function confirmMapAddition(page: Page) {
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

function trackAutosavedPlans(page: Page, ids: string[]) {
  page.on('response', response => {
    const match = /^\/api\/plans\/([\da-f-]{36})\/autosave$/i.exec(new URL(response.url()).pathname);
    if (response.request().method() === 'PUT' && response.status() === 200 && match) ids.push(match[1]);
  });
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
