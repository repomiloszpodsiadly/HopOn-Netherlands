# OpenFreeMap live smoke

The normal `npm.cmd run test:e2e` suite uses a deterministic local MapLibre style. The real OpenFreeMap smoke is explicitly reported as skipped unless `HOPON_LIVE_MAP_SMOKE=1` is set.

Explore shows Amsterdam, Rotterdam, and Utrecht together. Discover is intentionally hidden at desktop widths (1440px); Playwright verifies Discover at supported tablet and mobile widths instead of opening or restoring a desktop control.

## PowerShell opt-in

Run from the repository root:

```powershell
Set-Location frontend
$env:HOPON_LIVE_MAP_SMOKE = '1'
try {
  npm.cmd run test:e2e -- --grep 'real OpenFreeMap'
} finally {
  Remove-Item Env:HOPON_LIVE_MAP_SMOKE -ErrorAction SilentlyContinue
}
```

The smoke fails if the live style request is missing or unsuccessful. It also checks that the MapLibre canvas is visible and reaches the app's map-ready state. It does not assert external tile delivery.

## Manual check

With the API available, run `npm.cmd run start` from `frontend`, open `http://localhost:4200`, and inspect DevTools Network while reloading. Confirm the request to `https://tiles.openfreemap.org/styles/liberty` succeeds and the MapLibre canvas reaches `data-map-ready="true"`. Inspect actual tile requests separately before claiming tile delivery; a missing or failed style response is FAIL/UNVERIFIED, not PASS.
