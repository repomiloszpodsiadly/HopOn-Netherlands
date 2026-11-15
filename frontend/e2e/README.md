# Frontend E2E

Start the API on **127.0.0.1:8080** in a separate terminal using the
[backend commands](../../README.md#run-manually-with-the-tools-in-tools).
If using the portable Node.js from `.tools/`, select it in the E2E terminal
at the repository root first:

```powershell
$env:Path = (Resolve-Path .\.tools\node-v24.20.0).Path + ';' + $env:Path
cd frontend
```

With a supported Node.js/npm and frontend dependencies installed, run from `frontend/`:

```powershell
npx playwright install chromium
npm.cmd run test:e2e
```

Playwright starts its own frontend on **127.0.0.1:4300** and uses the real API
and in-memory H2. Tests run with one worker and clean up only their own plans.
Use a development session with free plan slots for capacity scenarios. Do not
restart an API holding plans you need to keep; stopping it clears H2.

Explore loads Amsterdam, Rotterdam and Utrecht together. Responsive scenarios
cover the catalog, map and plan controls across desktop, tablet and mobile
layouts, including the absence of the removed Discover by vibe section.

Map tests intercept the OpenFreeMap style URL with deterministic local fixtures.
They cover readiness, reconnect, HTTP 503, aborted style requests and controlled
tile failures. Catalog and plan workflows are checked when the map is unavailable.
No external map service or environment flag is needed. The suite does not verify
live map tiles.

To run only the map scenarios:

```powershell
npm.cmd run test:e2e -- e2e/map.spec.ts
```
