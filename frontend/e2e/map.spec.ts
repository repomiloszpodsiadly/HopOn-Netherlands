import { expect, test } from '@playwright/test';
import {
  prepareExplorePage,
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

test('keeps the catalog usable when the map style returns HTTP 503', async ({ page }) => {
  await page.unroute(openFreeMapStyleUrl);
  await page.route(openFreeMapStyleUrl, (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'Controlled style outage' }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.place-card').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry map', exact: true })).toBeVisible();
});

test('shows the map fallback when the style request is aborted', async ({ page }) => {
  await page.unroute(openFreeMapStyleUrl);
  await page.route(openFreeMapStyleUrl, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Map unavailable' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.place-card').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry map', exact: true })).toBeVisible();
});
