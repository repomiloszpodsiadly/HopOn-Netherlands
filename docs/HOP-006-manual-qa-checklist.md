# HOP-006 Manual Device QA

**Status: NOT RUN — no physical phone has been tested.** This checklist is prepared for a user-run Android Chrome or iOS Safari smoke on the same trusted Wi-Fi as the Windows development PC. Record actual evidence before changing any result to PASS.

## 1. Start the local app safely

Use a private, trusted Wi-Fi network. Do not use guest Wi-Fi, disable Windows Firewall, forward router ports, or expose port 8080 publicly. The phone should open only the Angular page on port 4200; Angular proxies relative `/api/**` calls to Spring on the PC.

The current source config binds Spring to `127.0.0.1:8080`. At Prompt D, the pre-existing PID 27232 was still bound to `0.0.0.0:8080` and `[::]:8080`. Stop that process from the terminal or IDE that owns it, only after confirming its in-memory H2 plans can be discarded: stopping Spring resets H2. Do not terminate an unknown PID. Then start Spring from the repository root:

```powershell
.\.tools\run-backend.ps1
```

In another PowerShell window, from the repository root:

```powershell
Set-Location .\frontend
$nodeHome = (Resolve-Path ..\.tools\node-v24.20.0).Path
$env:PATH = "$nodeHome;$env:PATH"
node.exe --version       # expected v24.20.0
npm.cmd --version        # expected 11.19.0
npm.cmd run start:lan
```

Find the PC's current Wi-Fi IPv4 address with `ipconfig`; do not reuse an old address without checking. Confirm Spring is loopback-only and healthy from the PC:

```powershell
netstat -ano | Select-String ':8080'
Invoke-RestMethod http://127.0.0.1:8080/api/health
```

Expected: `127.0.0.1:8080` is listening and the health response is `UP`; no `0.0.0.0:8080` or `[::]:8080` listener. A same-PC request to `http://<PC-LAN-IP>:4200` is only a preflight; it does not count as phone verification.

If Windows Firewall prompts, allow the Angular/Node development server on the **Private** profile only. Never allow backend port 8080 on the LAN. If the phone cannot connect, first confirm both devices are on the same non-guest Wi-Fi, the PC uses the expected Private network profile, and neither device is on a VPN. Some guest networks enable client isolation; ask the network administrator rather than disabling firewall protections.

On the phone, open `http://<PC-LAN-IP>:4200` (not `localhost`). If remote browser inspection is available, verify API requests use the PC page origin and relative `/api/...` paths, not `localhost:8080` or `127.0.0.1:8080`. The phone must not call the PC's port 8080 directly.

## 2. Exercise the phone flows

Use a disposable plan name such as `HOP-006 device QA YYYYMMDD`. Do not delete or overwrite an existing plan. H2 plans reset when the backend stops; record the test plan ID and remove only that disposable plan after confirming the run is complete.

1. **Load and API proxy:** open the app, confirm the city guide appears and the UI reports the local API connected. Record the phone's browser version and CSS viewport if available.
2. **Cities and catalog:** choose Amsterdam, Rotterdam, and Utrecht, including quick consecutive switches. Search for a known place, use a category filter, open and close its details, and confirm the selected place is reflected on the map.
3. **Real map (three separate checks):** (a) record the HTTP status for `https://tiles.openfreemap.org/styles/liberty`; (b) in remote DevTools Network, record successful non-empty glyph and vector-tile responses; (c) visually confirm the basemap, markers/clusters, selected-place focus, and visible attribution. Then pinch/zoom and pan on the phone. A style HTTP 200 alone is not a tile or rendering PASS.
4. **Discover and draft:** try each Discover theme, add a place, and verify the tab draft count. If you can block only the map-style request while keeping the LAN API online, confirm catalog/search/draft remain usable and Retry recovers the map. Otherwise leave that manual outage check NOT RUN; automated fallback evidence is recorded separately.
5. **Saved plan CRUD:** review and save the disposable draft; open it from Saved Plans; refresh its detail route; rename, reorder and save; refresh again and verify the name/order; delete the disposable plan using the confirmation dialog.
6. **Keyboard and phone layout:** open the keyboard while focused in search and the plan-name field. Confirm fields stay usable, Save controls can be reached, and the bottom navigation respects the safe area. Test portrait and landscape. Record the phone's actual CSS viewport; if using DevTools emulation for 360px or 390px, label that evidence as emulated rather than physical-device testing.
7. **Failure/data retention (if safe):** use a disposable unsaved draft. With the LAN API still reachable, simulate one failed save if your browser tooling permits it; confirm the draft and stops remain, restore connectivity, and retry once. If the outcome of a save is uncertain, inspect Saved Plans before retrying to avoid creating a duplicate.

## 3. Record the result

Record one row per check. Use `PASS`, `FAIL`, or `NOT RUN`; attach screenshots or a short screen recording where useful. Do not include Wi-Fi passwords or unrelated personal information. Keep evidence paths local unless the user chooses to share them.

| Date/time and timezone | Device/model | OS/build | Browser/version | Network label (no password) | PC LAN IPv4 | CSS viewport/orientation | Evidence folder |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

| Check | Result | Evidence / notes |
| --- | --- | --- |
| Spring loopback binding and PC health | NOT RUN | |
| Phone reaches Angular on PC port 4200; relative `/api/**` proxy works | NOT RUN | |
| All three cities, search/category, place details and selection | NOT RUN | |
| Style URL HTTP status (a) | NOT RUN | |
| Non-empty live glyph/tile responses (b) | NOT RUN | |
| Visible basemap, markers/clusters, focused selection, attribution and touch gestures (c) | NOT RUN | |
| Discover themes, draft, save/list/open/refresh/rename/reorder/delete | NOT RUN | Disposable plan ID: |
| Keyboard open, 360/390 equivalent, safe-area navigation, portrait/landscape | NOT RUN | Label any desktop emulation separately. |
| Failure behavior and draft retention | NOT RUN | |

The automated desktop browser evidence in `docs/HOP-006-release-verification.md` does not change any phone row above. OpenFreeMap's public map service is an external dependency without an SLA; keep the catalog and plan flows available when its tiles are unavailable.

## Attribution references

- [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright)
- [OpenFreeMap attribution and service information](https://openfreemap.org/)
- [OpenFreeMap terms](https://openfreemap.org/tos/)
- Featured-photo source pages and licenses are recorded in `frontend/public/assets/catalog/assets-attribution.json`.
