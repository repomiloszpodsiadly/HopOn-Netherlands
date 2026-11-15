import { expect, test } from '@playwright/test';
import {
  prepareExplorePage,
  waitForOpenFreeMapStyleResponse,
  assertSuccessfulOpenFreeMapStyleResponse,
  waitForMapReady,
  openFreeMapStyleUrl,
  isolatedStyle,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await prepareExplorePage(page);
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
