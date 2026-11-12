# HOP-002 map verification

## Automated coverage

Playwright replaces the OpenFreeMap style with a deterministic local style. Its tile-outage case loads that style, then returns HTTP 503 for raster tiles after changing city. These tests verify browser behavior and catalog usability; they do not verify the live OpenFreeMap basemap.

The app loads `https://tiles.openfreemap.org/styles/liberty`, bundles the MapLibre worker as `maplibre-gl-worker.mjs`, and displays `Map style © OpenFreeMap · Map data © OpenStreetMap contributors`. The attribution control is configured to stay expanded. Browser layout tests cover widths 360, 390, 768, 1024 and 1440 px with the map active, and 360, 390 and 1440 px with the map fallback visible.

## Manual online smoke

Start the backend and frontend using the commands in [README](../README), then open `http://localhost:4200` in an online browser. This check is separate from Playwright.

1. Confirm the real Liberty basemap and MapLibre worker load without console errors. Check the map attribution and page caption.
2. In Amsterdam, check visible markers/clusters. Select a distant place from its card and from Discover; confirm its selected marker is visible above the detail panel. Select a marker and confirm matching details open.
3. Switch Amsterdam → Rotterdam → Utrecht while watching for stale markers or delayed camera movement.
4. At 360, 390 and 1440 px, check for horizontal scrolling and verify attribution remains readable.
5. With the map loaded, block the map tile requests in DevTools. Confirm place search, details and the tab draft remain usable. Individual tile errors do not replace the map with a fallback.
6. Separately, block the style request before loading, reload and wait up to 12 seconds for the fallback. Confirm the place list remains usable, restore network access and use **Retry map**.

## Failure behavior and scope boundaries

The current MapLibre resource-error stream is not treated as a reliable total-outage signal: one or more tile, glyph or sprite failures can be partial. There is no post-load tile-outage banner or automatic fallback. The map remains alive after resource errors; a startup that never loads reaches the bounded fallback, and WebGL context loss uses the same fallback. Continue to verify real tile availability with the online smoke above.

At the time of HOP-002, licensed featured photography had not yet been implemented, so the accessible catalog fallback was the expected presentation. HOP-004 later added Commons-sourced featured photos for the three cities; current files, authors, licenses and change notes are recorded in [`assets-attribution.json`](../frontend/public/assets/catalog/assets-attribution.json). The accessible fallback remains in place when an image cannot load. HOP-002 keeps its tab-only draft semantics; the 1–12 place limit applies to persisted plans in HOP-003 only.
