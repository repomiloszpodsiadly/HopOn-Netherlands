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

test('uses automatic scrolling for the map Browse Places action with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, options?: ScrollIntoViewOptions): void {
      if (this instanceof HTMLElement && this.classList.contains('place-results')) {
        sessionStorage.setItem('hopon:test-browse-scroll-options', JSON.stringify(options ?? null));
      }
      scrollIntoView.call(this, options);
    };
  });
  await page.unroute(openFreeMapStyleUrl);
  await page.route(openFreeMapStyleUrl, (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'Controlled map outage' }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Browse places' }).click();
  await expect(page.locator('.place-results')).toBeFocused();
  expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem('hopon:test-browse-scroll-options')))
    .toBe(JSON.stringify({ behavior: 'auto', block: 'start' }));
});

test('keeps the shared draft CTA before the catalog and opens the selected POI city', async ({ page }) => {
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
  await page.locator('.place-detail').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.locator('.draft-count')).toContainText('1 stop');
  await expect(page.locator('.draft-panel')).toContainText('Temporary tab draft for Rotterdam');
  const reviewLink = page.getByRole('link', { name: 'Review and save draft' });
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
  await expect(page).toHaveURL(/\/plans\/new(?:\?.*)?$/);
  await expect(page.locator('#plan-name')).toHaveValue('Rotterdam plan');
  await expect(page.locator('#plan-city')).toHaveValue('rotterdam');
  await expect(page.locator('.editor-place h3')).toHaveText([placeName]);
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

    const mapCaption = page.locator('.map-caption');
    await mapCaption.scrollIntoViewIfNeeded();
    const captionBounds = await mapCaption.boundingBox();
    if (viewport.width <= 760) {
      const navigationBounds = await page.locator('app-main-navigation .bottom-nav').boundingBox();
      expect(captionBounds).not.toBeNull();
      expect(navigationBounds).not.toBeNull();
      expect(captionBounds!.y + captionBounds!.height).toBeLessThanOrEqual(navigationBounds!.y);
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
    const visualBounds = await detail.locator('.place-detail__visual').boundingBox();
    const changesBounds = await detail.locator('.place-detail__changes').boundingBox();
    expect(visualBounds).not.toBeNull();
    expect(changesBounds).not.toBeNull();
    expect(changesBounds!.y).toBeGreaterThanOrEqual(visualBounds!.y + visualBounds!.height);
    const detailAddButton = detail.getByRole('button', { name: 'Add to plan' });
    await detailAddButton.scrollIntoViewIfNeeded();
    await expect(detailAddButton).toBeInViewport();
    await assertRealViewportGeometry(page, viewport);
    await page.screenshot({ path: join(screenshotsDirectory, `selected-place-detail-${size}.png`) });
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);

    await addExplorePlaceFromCard(page, 0);
    await expect(page.locator('.draft-count')).toContainText('1 stop');
    const draftPanel = page.locator('.draft-panel');
    await draftPanel.scrollIntoViewIfNeeded();
    const draftReviewLink = page.getByRole('link', { name: 'Review and save draft' });
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
    await page.evaluate(() => sessionStorage.removeItem('hopon:draft:v1'));
  }
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

test('adds each city’s Discover picks once and restores the tab draft at tablet and mobile widths', async ({ page }) => {
  const cityIds = [
    { id: 'amsterdam', name: 'Amsterdam' },
    { id: 'rotterdam', name: 'Rotterdam' },
    { id: 'utrecht', name: 'Utrecht' },
  ] as const;
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const city of cityIds) {
      await page.goto('/');
      await expect(page.locator('.discover-panel')).toBeVisible();
      await page.getByRole('button', { name: 'Architecture Hunt' }).click();
      const group = page.getByRole('region', { name: `Discover picks in ${city.name}` });
      const picks = group.locator('.discover-pick');
      await expect(picks.first()).toBeVisible({ timeout: 15_000 });
      const pickCount = await picks.count();
      expect(pickCount).toBeGreaterThan(0);

      const addCityPicks = group.getByRole('button', { name: `Add ${city.name} picks to plan` });
      await addCityPicks.click();
      await expect(page.locator('.draft-panel')).toContainText(`Temporary tab draft for ${city.name}`);
      const draft = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null') as {
          cityId: string;
          placeIds: string[];
        } | null,
      );
      expect(draft?.cityId).toBe(city.id);
      expect(draft?.placeIds).toHaveLength(pickCount);
      const cityPlaces = await getActualPlaces(page, city.id);
      expect(draft!.placeIds.every((id) => cityPlaces.some((place) => place.id === id))).toBe(true);

      await addCityPicks.click();
      await expect(page.locator('.draft-feedback')).toContainText('Already in plan');
      await expect(page.locator('.draft-count')).toContainText(`${pickCount} ${pickCount === 1 ? 'stop' : 'stops'}`);

      await page.evaluate(() => sessionStorage.removeItem('hopon:draft:v1'));
    }
  }
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

    const [amsterdamPlaces, rotterdamPlaces, utrechtPlaces] = await Promise.all([
      getActualPlaces(page, 'amsterdam'),
      getActualPlaces(page, 'rotterdam'),
      getActualPlaces(page, 'utrecht'),
    ]);
    const allCityPlaces = [...amsterdamPlaces, ...rotterdamPlaces, ...utrechtPlaces];
    const placeNameCounts = new Map<string, number>();
    for (const place of allCityPlaces) {
      placeNameCounts.set(place.name, (placeNameCounts.get(place.name) ?? 0) + 1);
    }
    const uniqueNames = new Set(
      [...placeNameCounts]
        .filter(([, count]) => count === 1)
        .map(([name]) => name),
    );
    const planPlaces = amsterdamPlaces.filter((place) => uniqueNames.has(place.name)).slice(0, 3);
    expect(planPlaces).toHaveLength(3);
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
    for (const place of planPlaces) {
      pickedNames.push(await addExplorePlaceByName(page, place.name));
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
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null')))
      .toMatchObject({ name: savedName, cityId: 'amsterdam', placeIds: createdOrder });
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
    expect(await page.evaluate(() => sessionStorage.getItem('hopon:draft:v1'))).toBeNull();
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
  const amsterdamName = await addExplorePlaceByName(page, 'Royal Palace');
  const originalDraft = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('hopon:draft:v1') ?? 'null') as {
      cityId: string;
      name: string;
      placeIds: string[];
    } | null,
  );
  expect(originalDraft?.cityId).toBe('amsterdam');
  expect(originalDraft?.placeIds).toHaveLength(1);

  const rotterdamName = 'Erasmus Bridge';
  await openExplorePlaceByName(page, rotterdamName);
  await expect(page.locator('.place-detail')).toContainText('Rotterdam');
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
      await page.locator('.details-topbar-link').click();
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
  await expect(page.getByRole('link', { name: 'Review and save draft' })).toBeVisible();
});

test('Map navigation focuses the shared map and keeps the tab draft when tiles are unavailable', async ({ page }) => {
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
    await expect(page.locator('.map-caption')).toContainText('Map style');
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

    const caption = page.locator('.map-caption');
    await caption.scrollIntoViewIfNeeded();
    const captionBox = await caption.boundingBox();
    const navigationBox = await page.locator('.bottom-nav').boundingBox();
    if (captionBox !== null && navigationBox !== null) {
      expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(navigationBox.y);
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
  await page.locator('.place-detail').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.locator('.draft-feedback')).toContainText(/Added 1 place to the tab draft/);
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
