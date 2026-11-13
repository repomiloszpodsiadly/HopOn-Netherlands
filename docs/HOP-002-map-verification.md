# HOP-002 map verification

## Automated coverage

Playwright replaces the OpenFreeMap style with a deterministic local style. Its tile-failure case loads that style, then returns HTTP 503 for raster tiles. These tests verify browser behavior and catalog usability; they do not verify live OpenFreeMap tiles.

The current MapLibre map loads `https://tiles.openfreemap.org/styles/liberty`, bundles the worker as `maplibre-gl-worker.mjs`, and displays OpenFreeMap/OpenStreetMap attribution. The app loads Amsterdam, Rotterdam and Utrecht together; cards identify their city, and the shared map pans/zooms across all three. Browser layout tests cover 360, 390, 768, 1024 and 1440px with the map active, and 360, 390 and 1440px with map fallback visible.

## Manual online smoke

Start the backend and frontend using the commands in [README](../README), then open <http://localhost:4200> in an online browser. This check is separate from Playwright.

1. Confirm the real Liberty basemap and MapLibre worker load without console errors. Check visible map attribution and caption.
2. Check visible markers/clusters across all three city areas. Select a place from each city's card and, where Discover is available at a supported narrower viewport, from a Discover result. Confirm the selected marker is revealed and matching details open.
3. Pan and zoom the shared map between Amsterdam, Rotterdam and Utrecht; there is no city selector or city-scoped map mode.
4. At 360, 390 and 1440px, check horizontal overflow and readable attribution. Include tablet widths 768 and 1024px where practical.
5. With the map loaded, block tile requests in DevTools. Confirm place search, details and the tab draft remain usable. Individual tile errors can leave the map partially rendered and do not necessarily display Retry or a fallback.
6. Separately, block the style request before map startup, reload and wait for the documented fallback. Confirm place cards remain usable, restore network access and use Retry.

## Failure behavior and scope boundaries

The MapLibre resource-error stream is not a reliable signal for total outage: isolated tile, glyph or sprite failures can leave gaps while the map stays active. A failed individual resource does not promise a banner or Retry action. A startup that does not load reaches the bounded fallback, and WebGL context loss uses the same fallback. Catalog search, place details and plan flows remain separate from map-resource availability. Verify actual delivery with the live smoke; a successful style response alone is not proof that tiles, glyphs or a visible basemap loaded.

At the time of HOP-002, licensed featured photography had not yet been implemented, so the accessible catalog fallback was expected. HOP-004 later added Commons-sourced featured photos for the three cities; current files, authors, licenses and change notes are recorded in [assets-attribution.json](../frontend/public/assets/catalog/assets-attribution.json). The accessible fallback remains when an image cannot load. Saved plans are single-city; a cross-city draft addition requires an explicit keep/replace choice.
