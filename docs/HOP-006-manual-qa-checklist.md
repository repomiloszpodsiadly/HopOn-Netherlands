# HOP-006 Manual Device QA

**Status: NOT RUN — no physical phone has been tested.** This checklist is for a user-run Android Chrome or iOS Safari smoke on the same trusted Wi-Fi as the Windows development PC. Record actual evidence before changing any result to PASS.

## 1. Start the local app safely

Use a private, trusted Wi-Fi network. Do not use guest Wi-Fi, disable Windows Firewall, forward router ports, or expose backend port 8080. The phone opens the Angular page on port 4200; Angular proxies relative `/api/**` calls to Spring on the PC.

Before starting Spring, identify any existing listener on port 8080. These commands discover the current PID and executable; they do not stop a process and must be rerun each time:

~~~powershell
$listeners = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
$listeners | Select-Object LocalAddress, LocalPort, State, OwningProcess
$listeners.OwningProcess | Sort-Object -Unique | ForEach-Object {
    Get-Process -Id $_ -ErrorAction SilentlyContinue |
        Select-Object Id, ProcessName, Path
}
~~~

If a listener belongs to a confirmed HopOn Spring process, use its owning terminal or IDE to stop it. Do not terminate an unknown PID. Stopping Spring resets all saved in-memory H2 plans; confirm that any plans can be discarded before asking the owner to restart it. If the owner is unclear or saved plans must be kept, stop and mark this step **BLOCKED**. If no process is listening, start Spring from the repository root:

~~~powershell
.\.tools\run-backend.ps1
~~~

In another PowerShell window, from the repository root:

~~~powershell
Set-Location .\frontend
$nodeHome = (Resolve-Path ..\.tools\node-v24.20.0).Path
$env:PATH = "$nodeHome;$env:PATH"
node.exe --version       # expected v24.20.0
npm.cmd --version        # expected 11.19.0
npm.cmd run start:lan
~~~

Find the PC's current Wi-Fi IPv4 address with `ipconfig`; do not reuse an old address without checking. After the owner safely restarts Spring, verify its new listener and health:

~~~powershell
netstat -ano -p tcp | Select-String ':8080'
Invoke-RestMethod http://127.0.0.1:8080/api/health
~~~

Expected: the listener address is `127.0.0.1:8080` and health is `UP`. If it listens on `0.0.0.0:8080`, `[::]:8080`, or another non-loopback address, mark the backend/LAN check **BLOCKED** and do not continue to phone testing. A same-PC request to `http://<PC-LAN-IP>:4200` is only a preflight; it does not count as phone verification.

If Windows Firewall prompts, allow the Angular/Node development server on the **Private** profile only. Never allow backend port 8080 on the LAN. If the phone cannot connect, confirm both devices use the same non-guest Wi-Fi, the PC uses the expected Private network profile, and neither device is on a VPN. Some guest networks enable client isolation; ask the network administrator rather than disabling firewall protections.

On the phone, open `http://<PC-LAN-IP>:4200`, not localhost. If remote browser inspection is available, verify API requests use the page origin and relative `/api/...` paths, not `localhost:8080` or `127.0.0.1:8080`. The phone must not call the PC's port 8080 directly.

## 2. Exercise the phone flows

Use a disposable plan name such as `HOP-006 device QA YYYYMMDD`. Do not delete or overwrite an existing plan. H2 plans reset when the backend stops; record the disposable plan ID and remove only that plan after confirming the run is complete.

1. **Load and API proxy:** open the app, confirm the shared three-city Explore appears and the UI reports the local API connected. Confirm the phone uses relative `/api/**` requests through the PC's Angular server, never direct backend localhost. Record browser version and CSS viewport if available.
2. **Shared catalog and map:** verify Amsterdam, Rotterdam and Utrecht appear together. Search for a known place, use a category filter, confirm cards name their city, open and close details, and select places from different cities. Pan/zoom between city areas and confirm selection is reflected on the shared map.
3. **Real map — three separate checks:** (a) record the HTTP status for `https://tiles.openfreemap.org/styles/liberty`; (b) in remote DevTools Network, record successful non-empty glyph and vector-tile responses; (c) visually confirm basemap, markers/clusters, selected-place focus and visible attribution. Then pinch/zoom and pan. A style HTTP 200 alone is not a tile or rendering PASS.
4. **Discover and autosave:** at a supported narrower viewport (up to 1100px), try each Discover theme if the panel is available; desktop absence is expected. Add the first place and confirm it is automatically saved. Add places from different cities and confirm the current plan keeps them together without a replace/keep prompt or another manual save. If you can block map resources while keeping the LAN API online, confirm catalog/search/planning remain usable. Isolated tile errors may not show Retry; test Retry only if the explicit startup fallback appears. Otherwise leave this outage check NOT RUN.
5. **Mixed-city plan CRUD and limits:** use Review current plan or open the disposable plan from Saved Plans; use Explore map to add a place from the remaining city; confirm all places remain in that same plan. Refresh its detail route; rename, edit its description, reorder and save; refresh again and verify the data. Names allow 30 characters, descriptions 500, and each plan 0–12 places. At 6/6 saved plans, verify updates still work and a seventh creation explains how to use or delete an existing plan. Delete only the disposable plans using the confirmation dialog.
6. **Keyboard and phone layout:** open the keyboard while focused in search and the plan-name field. Confirm fields stay usable, Save controls can be reached and bottom navigation respects the safe area. Test portrait and landscape. Record actual CSS viewport; if using DevTools emulation for 360px or 390px, label it as emulated, not physical-device testing.
7. **Failure and data retention (if safe):** use a disposable unsaved draft. With the LAN API still reachable, simulate one failed save if browser tooling permits; confirm draft and stops remain, restore connectivity and retry once. If a save outcome is uncertain, inspect Saved Plans before retrying to avoid a duplicate.

## 3. Record the result

Record one row per check. Use **PASS**, **FAIL**, **NOT RUN** or **BLOCKED**; attach screenshots or a short recording where useful. Do not include Wi-Fi passwords or unrelated personal information. Keep evidence paths local unless you choose to share them.

| Date/time and timezone | Device/model | OS/build | Browser/version | Network label (no password) | PC LAN IPv4 | CSS viewport/orientation | Evidence folder |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

| Check | Result | Evidence / notes |
| --- | --- | --- |
| Identify any existing port 8080 owner; safe restart decision | NOT RUN | Do not stop an unknown process. |
| Spring loopback binding and PC health after safe start/restart | NOT RUN | |
| Phone reaches Angular on PC port 4200; relative `/api/**` proxy works | NOT RUN | |
| Three cities together, shared search/filter, city labels, details and map selection | NOT RUN | |
| Style URL HTTP status (a) | NOT RUN | |
| Non-empty live glyph/tile responses (b) | NOT RUN | |
| Visible basemap, markers/clusters, focused selection, attribution and touch gestures (c) | NOT RUN | |
| Discover at supported narrower viewport; cross-city draft and saved-plan CRUD | NOT RUN | Disposable plan ID: |
| Keyboard, safe-area navigation, portrait/landscape; label emulation separately | NOT RUN | |
| Failure behavior and draft retention | NOT RUN | |

The automated desktop browser evidence in [the release ledger](HOP-006-release-verification.md) does not change any phone row above. OpenFreeMap is an external service without an SLA; keep catalog and plan flows available when map resources fail.

## Attribution references

- [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright)
- [OpenFreeMap attribution and service information](https://openfreemap.org/)
- [OpenFreeMap terms](https://openfreemap.org/tos/)
- Featured-photo source pages, authors, licenses and change notes are recorded in [assets-attribution.json](../frontend/public/assets/catalog/assets-attribution.json).
