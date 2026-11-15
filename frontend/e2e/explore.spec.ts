import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  prepareExplorePage,
  waitForMapReady,
  assertRealViewportGeometry,
  cleanupCreatedPlans,
  getActualPlaces,
  addExplorePlaceFromCard,
  openExplorePlaceByName,
  confirmMapAddition,
  trackAutosavedPlans,
  openFreeMapStyleUrl,
  isolatedStyle,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareExplorePage(page);
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
  await expect(page.locator('.city-scope')).toHaveCount(0);
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
  const selectedCard = await openExplorePlaceByName(page, placeName);
  await expect(page.locator('.place-detail')).toContainText('Rotterdam');
  const saved = await confirmMapAddition(page);
  await expect(page.locator('.draft-count')).toHaveText('1 / 12');
  await expect(page.locator('.draft-panel')).toContainText(saved.id ? 'CURRENT PLAN' : '');
  await expect(page.locator('.draft-panel')).not.toContainText('Temporary');
  await page.getByRole('button', { name: 'Close place details', exact: true }).click();
  await expect(selectedCard).toBeFocused();
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
    await expect(page.locator('.discover-panel')).toHaveCount(0);
    expect(layout.map?.y).toBeLessThan(layout.navigation!.y);
    expect(layout.map?.y).toBeLessThan(viewport.height * 0.67);
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await page.screenshot({
      path: join(screenshotsDirectory, `explore-initial-${viewport.width}x${viewport.height}.png`),
      fullPage: false,
    });
    for (const selector of ['.filter-row', '.draft-panel']) {
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
    await expect(page.locator('.city-scope')).toHaveCount(0);
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
    await expect(page.locator('.discover-panel')).toHaveCount(0);

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

test('keeps the same catalog controls and content at every viewport', async ({ page }) => {
  const discoverRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/discover') discoverRequests.push(request.url());
  });
  await page.goto('/');
  for (const width of [360, 390, 768, 900, 901, 1024, 1100, 1101, 1440, 1536, 1920]) {
    await page.setViewportSize({ width, height: width <= 900 ? 844 : 900 });
    await expect(page.locator('.discover-panel, .discover-theme, .discover-results, .city-scope')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Discover by vibe', exact: true })).toHaveCount(0);
    await expect(page.locator('.control-note, .footer-note, .place-card__tags')).toHaveCount(0);
    await expect(page.locator('.intro')).toBeVisible();
    await expect(page.locator('.saved-plans-link')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Architecture Hunt|Culture Day|Green Escape/ })).toHaveCount(0);
    await expect(page.locator('.map-viewport__canvas canvas')).toBeVisible();
    await waitForMapReady(page);
    await openExplorePlaceByName(page, 'Royal Palace');
    await expect(page.locator('.place-detail')).toContainText('Amsterdam');
    await page.keyboard.press('Escape');
    await expect(page.locator('.place-detail')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect(discoverRequests).toEqual([]);
});

test('autosaves catalog places once for each starting city at tablet and mobile widths', async ({ page }) => {
  test.setTimeout(90_000);
  const owned: string[] = [];
  let failed = false;
  try {
    for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const city of [
        { id: 'amsterdam', place: 'Royal Palace' },
        { id: 'rotterdam', place: 'Erasmus Bridge' },
        { id: 'utrecht', place: 'Dom Tower' },
      ]) {
        await page.goto('/plans/new?city=' + city.id);
        await page.locator('.editor-cancel').click();
        await openExplorePlaceByName(page, city.place);
        const plan = await confirmMapAddition(page);
        owned.push(plan.id);
        expect(plan.placeIds).toHaveLength(1);
        await page.locator('.place-detail').getByRole('button', { name: 'Already added', exact: true }).click();
        await expect(page.locator('.draft-feedback')).toHaveText('Those places are already in this plan.');
        await page.reload();
        await expect(page.getByRole('link', { name: 'Review current plan', exact: true })).toHaveAttribute('href', '/plans/' + plan.id);
        await expect(page.locator('.draft-count')).toHaveText('1 / 12');
        const saved = await page.request.get('/api/plans/' + plan.id);
        const persisted = await saved.json() as { cityId: string; placeIds: string[] };
        expect(persisted.cityId).toBe(city.id);
        expect(persisted.placeIds).toEqual(plan.placeIds);
        expect((await page.request.delete('/api/plans/' + plan.id)).status()).toBe(204);
      }
    }
  } catch (error) { failed = true; throw error; }
  finally { await cleanupCreatedPlans(page, owned, failed); }
});

test('checks responsive geometry and captures the actual shared-city interface', async ({ page }) => {
  test.setTimeout(240_000);
  const screenshotsDirectory = join(process.cwd(), 'test-results', 'hop004-e-editorial-review');
  await mkdir(screenshotsDirectory, { recursive: true });
  await page.goto('/');
  await expect(page.locator('.map-viewport__canvas canvas')).toBeVisible();

  const expectMapAndPlanTogether = async () => {
    const layout = await page.evaluate(() => {
      const map = document.querySelector('.explore-main')!.getBoundingClientRect();
      const plan = document.querySelector('.draft-panel')!.getBoundingClientRect();
      return { gap: plan.top - map.bottom, leftDifference: Math.abs(plan.left - map.left), widthDifference: Math.abs(plan.width - map.width) };
    });
    expect(layout.gap, 'The plan panel should sit directly below the map').toBeGreaterThanOrEqual(0);
    expect(layout.gap, 'The plan panel should stay close to the map').toBeLessThanOrEqual(24);
    expect(layout.leftDifference).toBeLessThanOrEqual(1);
    expect(layout.widthDifference).toBeLessThanOrEqual(1);
  };

  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 901, height: 700 },
    { width: 1024, height: 768 },
    { width: 1100, height: 860 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.city-scope')).toHaveCount(0);
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.locator('.filter-row')).toBeVisible();
    await expect(page.locator('.place-results__heading h2')).toHaveText('Places to explore');
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenFreeMap');
    if (viewport.width <= 390) {
      for (const selector of ['.search-box', '.filter-chip', '.draft-editor-link', '.bottom-nav__item']) {
        const bounds = await page.locator(selector).first().boundingBox();
        expect(bounds?.width, `${selector} width at ${viewport.width}px`).toBeGreaterThanOrEqual(44);
        expect(bounds?.height, `${selector} height at ${viewport.width}px`).toBeGreaterThanOrEqual(44);
      }
    }
    await expect.poll(async () => page.locator('.map-viewport__canvas').evaluate((mapHost) => {
      const canvas = mapHost.querySelector('canvas');
      return canvas === null ? 0 : Math.abs(mapHost.clientWidth - canvas.clientWidth);
    })).toBeLessThanOrEqual(2);

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewport.width);
    await expectMapAndPlanTogether();

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
      { width: 901, name: 'Royal Palace' },
      { width: 1024, name: 'Royal Palace' },
      { width: 1100, name: 'Dom Tower' },
      { width: 1440, name: 'Erasmus Bridge' },
      { width: 1536, name: 'Royal Palace' },
      { width: 1920, name: 'Erasmus Bridge' },
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

    await expect(page.locator('.discover-panel')).toHaveCount(0);
    await expectMapAndPlanTogether();

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
