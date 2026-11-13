# HOP-006 Release Verification

- **Audit date:** 2026-11-12 (Europe/Warsaw)
- **Branch:** `feat/HOP-006-final-qa-demo` (the prompt pack names `chore/HOP-006-final-qa-demo`)
- **HEAD at evidence capture:** `2f886d00c833b0b61928a3168d6406e14ee14f50`
- **Environment:** Windows 10.0.26200.9974; Windows PowerShell 5.1.26100.9818; project JDK 27.0.1.0.2+1; Gradle wrapper 9.8.2; Node 24.20.0; npm 11.19.0; Playwright Chromium 1.64.1.

Every row uses the HEAD at evidence capture as the source baseline; `2f886d0` is its short SHA. The worktree at capture contained README and `backend/src/main/resources/application.properties` changes from A, plus the HOP-002 and HOP-006 documentation updates; those changes were not yet in that HEAD. `debug.log` is an unrelated untracked file and was left untouched. No Git operation had been performed at evidence capture.

| Category | Command / step | Environment | Commit SHA | Status | Evidence, limits and path | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| Project instructions and baseline | Read `AGENTS.md`, `prompts/plan/MASTERPLAN.md`, prompt pack, runtime and app configuration | Windows / PowerShell | `2f886d0` | PASS | `AGENTS.md` points to the sole plan at `prompts/plan/MASTERPLAN.md`. Branch name differs from the pack; no branch operation performed. | Codex |
| Prompt A startup helper | `.\.tools\run-backend.ps1` | JDK 27 / Gradle 9.8.2 | `2f886d0` | BLOCKED | Existing process owned port 8080, so a second backend was not started. It was left running. | Codex |
| Prompt A existing API health | `curl.exe -i http://127.0.0.1:8080/api/health` | Existing local Spring process at historical capture (PID not reusable) | `2f886d0` | PASS, limited | Returned HTTP 200 and `{"status":"UP","service":"hopon-api"}`; this was not a clean startup. | Codex |
| Prompt A isolated bind verification | `backend\gradlew.bat bootRun --args='--server.port=8081'` | JDK 27; disposable H2 | `2f886d0` | PASS | `127.0.0.1:8081` returned health 200; request via the PC Wi-Fi IP failed. Isolated process was stopped. | Codex |
| Backend automated gate | `cd backend; .\gradlew.bat clean test bootJar` | JDK 27.0.1.0.2+1; Gradle 9.8.2 | `2f886d0` | PASS | BUILD SUCCESSFUL; 37 tests, 0 failures/errors/skips; JAR `backend/build/libs/hopon-api-0.1.0-SNAPSHOT.jar`, 54,530,716 bytes. | Codex |
| Backend real HTTP/H2 lifecycle | Create/list/read/update/reorder/delete and restart against isolated JAR on 8081 | Spring Boot 4.1.2; Java 27; H2 | `2f886d0` | PASS | POST 201 with `Location`; GET 200; PUT 200 preserving UUID and order; DELETE 204 then GET 404. After process restart list was `[]`; no port-8080 data was used. | Codex |
| Clean-clone install and startup | `git clone`, clean checkout, `npm ci`, route refresh | Separate clean directory | `2f886d0` | NOT RUN | No clean clone was created; Git/clone work was reserved to the user. Warm-tree `npm ci` passed in Prompt C. | User |
| Angular dependency install | `npm.cmd ci` | Node 24.20.0; npm 11.19.0; warm worktree | `2f886d0` | PASS | 457 packages installed. npm warned that install scripts for `@parcel/watcher`, `esbuild`, `lmdb`, and `msgpackr-extract` were not covered by `allowScripts`; all gates below still passed. | Codex |
| Angular lint | `npm run lint` | Node 24.20.0; npm 11.19.0 | `2f886d0` | PASS | All frontend files passed. | Codex |
| Angular typecheck | `npm run typecheck` | Node 24.20.0; npm 11.19.0 | `2f886d0` | PASS | Development Angular compilation passed. First sandbox attempt hit `Access is denied`; retry in the permitted environment passed. | Codex |
| Angular unit tests | `npm run test` | Node 24.20.0; npm 11.19.0 | `2f886d0` | PASS | 12 files; 102 tests passed. First sandbox attempt hit the same file-access restriction; retry passed. | Codex |
| Angular production build | `npm run build` | Node 24.20.0; npm 11.19.0 | `2f886d0` | PASS | Initial bundle 435.04 kB raw / 100.81 kB estimated transfer, under 500 kB warning budget. Lazy MapLibre 1.07 MB raw / 238.78 kB transfer. No initial or component-style budget warnings. Last run completed in 3.615s; not a runtime performance measure. | Codex |
| Playwright browser availability | `npx playwright install --list` | Playwright 1.64.1 | `2f886d0` | PASS | Chromium and headless shell were already installed; no download needed. | Codex |
| Full browser E2E | `npm run test:e2e` | Chromium; Playwright app on 4300; real Spring/H2 API on 8080 | `2f886d0` | PASS, scoped | 24 passed, 1 skipped in 5.1 minutes. Real H2 CRUD, saved-plan refresh/history, city/search/Discover/draft flows, failures and responsive cases. Skipped test was opt-in live OpenFreeMap smoke; regular E2E uses a deterministic style. | Codex |
| Browser console and local network smoke | Production-configured `ng serve` on loopback; Chromium opened `/`, `/plans`, `/plans/new`, `/api/health`, `/api/plans` | Node 24.20.0; deterministic map-style stub | `2f886d0` | PASS, bounded | All routes and API returned 200; no console/page errors, failed requests or local HTTP >=400. First inline harness invocation failed because PowerShell stripped JS quotes; corrected temporary script passed and was deleted. This was not a full DevTools waterfall. | Codex |
| Responsive screenshot and visual review | Inspect Playwright screenshots at 360×800, 390×844, 768×1024, 1024×768 and 1440×900 | Chromium screenshots | `2f886d0` | PASS, visual scope | Explore, empty plans, create and detail screens reviewed; mobile save controls and delete dialog also inspected. Artifacts: `frontend/test-results/hop004-e-real-viewport/{explore,saved-plans}/`. P2 observation: mobile detail screenshot shows fixed navigation over the route card at the initial fold; content is scrollable and E2E actions passed. Recheck on a phone. | Codex |
| Keyboard, focus and responsive assertions | Tab/focus, Escape, dialog focus, reduced motion, short viewport, landscape and 720 CSS px zoom simulation | Playwright Chromium | `2f886d0` | PASS, automated scope | Document width and interactive state assertions passed. Physical keyboard, 200% browser zoom, safe-area behavior and 44px touch targets were not measured on a device. | Codex |
| Live OpenFreeMap style smoke | `$env:HOPON_LIVE_MAP_SMOKE='1'; npm.cmd run test:e2e -- --grep 'real OpenFreeMap'` | Node 24.20.0; Chromium; local API | `2f886d0` | PASS, style only | 1 passed in 12.7s. Style HTTP 200, canvas visible and MapLibre ready. This smoke does not assert tile delivery. First sandbox attempt was blocked by Angular file access; elevated retry passed. | Codex |
| Real live tile and glyph delivery | Production-configured Angular server; headless Chromium without style interception; mouse pan, wheel zoom and select Royal Palace | 1440×1000 desktop browser; internet; real local API | `2f886d0` | PASS, desktop scope | Style 200 (43,311 bytes), TileJSON 200 (19,254 bytes), 16 non-empty vector PBF responses and 3 non-empty glyph PBF responses all 200; sprite JSON/PNG 200. Visible basemap, clusters, selected marker, detail sheet and attribution. 0 console errors, page errors, failed requests or local HTTP >=400. | Codex |
| Live map screenshots | Review actual output after live tile run | Headless Chromium | `2f886d0` | PASS, visually inspected | `frontend/test-results/hop006-d/live-map.png`; `frontend/test-results/hop006-d/live-selected-place.png`. Desktop evidence only; no physical touch or phone claim. | Codex |
| Browser WebGL fallback | Force canvas WebGL `getContext` to return null; search catalog and retry map | Chromium emulation, 390×844 | `2f886d0` | PASS, simulated | Fallback and Retry visible; `Royal Palace` search returned one result; API health 200. Screenshot: `frontend/test-results/hop006-d/webgl-fallback.png`. Not a real device hardware failure. | Codex |
| Browser metadata and favicon | Inspect title, meta description and request `/favicon.ico` | Production-configured Angular app | `2f886d0` | PASS | Title `HopOn — Find your own way around`; description matches guide capability; favicon HTTP 200. | Codex |
| Map and featured-photo attribution | Review live map, UI links, manifest and exact Wikimedia Commons pages | Live browser; source pages checked 2026-11-12 | `2f886d0` | PASS, scoped | Map showed OpenFreeMap/OpenMapTiles/OSM credit and an app caption naming OSM contributors. Photo records match Royal Palace/Elekes Andor/CC BY-SA 4.0, Erasmus Bridge/acediscovery/CC BY 4.0 and Dom Tower/tED/CC BY 2.0; change notices and redistribution license are recorded in `frontend/public/assets/catalog/assets-attribution.json`. | Codex |
| Local photo sizes and fallback | Inspect local JPEG dimensions/bytes and detail fallback code/test | Windows `System.Drawing`; Angular source | `2f886d0` | PASS | Each image has 640×480 (50–85 kB) and 1280×960 (254–356 kB) variants; total 1,070,418 bytes. Detail fallback has a component test. | Codex |
| Phone over trusted Wi-Fi, proxy and firewall | Follow `docs/HOP-006-manual-qa-checklist.md` on Android Chrome or iOS Safari | Physical device required | `2f886d0` | NOT RUN, release gate | No phone was connected or touched; no firewall rule was changed. Desktop browser results do not satisfy this gate. | User |
| Phone map, touch, keyboard, safe area and landscape | Style response, non-empty glyph/tiles, rendered base map, marker focus, pinch/pan, keyboard and orientation | Physical device required | `2f886d0` | NOT RUN | Capture device, OS, browser, network, date, viewport and screenshots in the manual checklist. | User |
| On-device performance trace | Filter, city change and map pan on an identifiable phone | Physical device and browser performance tooling | `2f886d0` | NOT RUN, P2 | No device trace was available; no FPS, latency or capacity claim is made. | User |
| 44 CSS-pixel touch-target measurement | Measure primary touch targets on a real phone | Physical device required | `2f886d0` | NOT RUN, P2 | No physical touch measurement was recorded. | User |
| Existing Spring process and LAN safety | Inspect port 8080 and identify the owner dynamically; restart only from its confirmed owning terminal after H2 data-loss approval | Existing Windows process at historical capture | `2f886d0` | BLOCKED, P1 | The historical listener was reported on `0.0.0.0:8080` and `[::]:8080`; this is not a statement about the current listener. Do not begin phone/LAN QA until the current owner safely restarts it and loopback is verified. Stopping Spring resets in-memory H2. | User |
| README and current-state documentation | Finalize root `README`; update historical HOP-002 photo note; check `AGENTS.md` plan path | Documentation-only changes | `2f886d0` | PASS | README covers tools, runtimes, ports, data semantics, tests and troubleshooting. HOP-002 now labels the photo fallback as historical and links current manifest. No duplicate masterplan was added. | Codex |
| Manual phone checklist | Create `docs/HOP-006-manual-qa-checklist.md` | Documentation | `2f886d0` | PASS, preparation only | Device status rows remain NOT RUN until the user supplies actual evidence. | Codex |
| Recruitment demo | Create `docs/HOP-006-recruitment-demo.md` with setup, timed outline and map fallback | Documentation; no rehearsal | `2f886d0` | PASS, outline only | Click-by-click target is 90 seconds; no timed rehearsal has been performed. It avoids stale plan IDs and warns that H2 resets on backend restart. | Codex |
| Branch and clean-clone ownership | Compare actual branch with pack target; no branch switch or clone at evidence capture | User-owned branch | `2f886d0` | NOT RUN, P2 | Branch is `feat/HOP-006-final-qa-demo`; pack names `chore/HOP-006-final-qa-demo`. Clean-clone reproduction remains NOT RUN. | User |
| Final documentation integrity | `git diff --check`; trailing-whitespace scan and link-target check for E docs | Windows PowerShell | `2f886d0` | PASS | Checks passed after Prompt E. Prompt E edits are documentation-only; no application source was changed after the last build. | Codex |

## Earlier gate record — Prompt C code snapshot

- Captured: 2026-11-13 (Europe/Warsaw)
- Branch: `feat/HOP-006-final-qa-demo`
- Repository HEAD: `5136edd364eb14d7f5b025056632584be2233c32`

**Tested source state:** that HEAD plus the uncommitted Prompt A, B and C frontend changes present at test time. The tests below are evidence for that worktree snapshot, **not for the committed contents of HEAD alone**. Prompt D documentation edits were made after these app checks and have their own documentation checks below. No Git mutation was performed.

At code-test capture, the worktree contained the Explore, map-test, plan-test, navigation-test and E2E changes from Prompts A–C, plus an unrelated untracked `debug.log`; it was preserved. No backend source file was modified in that worktree.

| Area | Exact command / step | Result | Evidence and limits |
| --- | --- | --- | --- |
| Frontend unit suite after Prompt C | From `frontend/`: `npm test` | **PASS** — 12 files, 109 tests | Includes progressive city loading, retry/stale cancellation, hub recovery, Discover partial results and map lifecycle coverage. |
| Lint | From `frontend/`: `npm run lint` | **PASS** | All frontend files passed. |
| Typecheck | From `frontend/`: `npm run typecheck` | **PASS** | Angular development build passed. |
| Production build and CSS budgets | From `frontend/`: `npm run build` | **PASS** | Initial chunks: 443.01 kB raw / 102.57 kB estimated transfer; global styles: 79.08 kB raw. Component-style warning/error budgets remain 18/24 kB; build reported no component-style budget warning. Build output is not a runtime performance measurement. |
| Playwright: delayed city, 503 and city retry | From `frontend/`: `npm run test:e2e -- --grep "delayed city|city-specific hub failure"` | **PASS** — 2 tests | Successful city catalogs remain searchable while another is delayed; failed city and hub requests recover on retry. Failure responses are simulated by the test. |
| Playwright: responsive viewport capture | From `frontend/`: `npm run test:e2e -- --grep "captures real Explore viewport states without screenshot-only styling"` | **PASS** — 1 test | Captured browser viewports 360, 390, 768, 1024 and 1440; this is browser automation, not a physical phone. Selected-place 390×844 and 1440×900 screenshots were visually inspected. |
| Full Playwright suite after Prompt B, before Prompt C | From `frontend/`: `npm run test:e2e` | **PASS, earlier snapshot** — 24 passed, 1 skipped | Run before the Prompt C source changes. The skipped case is opt-in live OpenFreeMap; this is not a full post-C suite result. |
| Backend startup and health | `.\.tools\run-backend.ps1`; then `Invoke-RestMethod -Uri http://127.0.0.1:8080/api/health` | **PASS, local startup** | Returned `status=UP`, `service=hopon-api`. `netstat -ano -p tcp | Select-String ':8080'` showed `127.0.0.1:8080 LISTENING 35816`; `Get-Process -Id 35816` identified Java from `.tools/jdk-27/bin/java.exe`. This helper-started process was loopback-bound. |
| Backend Gradle test/archive gate on this snapshot | `.\gradlew.bat clean test bootJar` | **NOT RUN** | Backend unit/archive gate is not newly evidenced for this snapshot. The old 37-test PASS remains only in the historical `2f886d0` ledger above. |
| Live OpenFreeMap style, tiles/glyphs and rendered basemap | Browser smoke without style interception | **NOT RUN on this snapshot** | Historical live-map checks at `2f886d0` remain historical. Deterministic Playwright maps and style-only responses are not live tile evidence. |
| Phone on trusted Wi-Fi / LAN proxy | Physical Android or iOS device | **NOT RUN** | No phone was connected or tested. Desktop viewport emulation is not device evidence. |
| Clean clone, H2 restart reset, timed demo rehearsal | Separate clean checkout / isolated Spring restart / timed screen-share | **NOT RUN on this snapshot** | No clean clone or timed rehearsal was performed. Never restart a process with saved H2 plans until its owner confirms those plans may be discarded. |
| Title, description, favicon and featured-photo provenance | Source inspection: `frontend/src/index.html`, `frontend/public/favicon.ico`, and `frontend/public/assets/catalog/assets-attribution.json` | **PASS, source inspection** | Current source has the HopOn title/description and favicon path; the three Commons photo entries retain author, license and change notice. This row does not claim a new browser HTTP smoke. |
| Prompt D documentation integrity | `git diff --check`; stale-UI/PID scan returned zero matches; PowerShell local-Markdown-link check | **PASS** | `git diff --check` exited 0. The scan found no hard-coded historical PID or removed city-picker/desktop-Discover instructions in the current README/demo/checklist/map guide. Every local Markdown link in those files and this ledger resolves. |

**Status at Prompt C capture:** full post-C Playwright, the backend Gradle gate, live tiles, physical-phone/LAN QA, clean-clone reproduction and demo rehearsal had not yet run. The Prompt E evidence below supersedes this snapshot for the current worktree. Historical PASS rows still do not transfer to another SHA.

## Prompt E final gate — current working tree

- Captured: 2026-11-13 (Europe/Warsaw)
- Branch: `feat/HOP-006-final-qa-demo`
- Repository HEAD: `5136edd364eb14d7f5b025056632584be2233c32`

**Code state:** tests ran against this HEAD plus the uncommitted Prompts A–C frontend changes. Documentation tests also cover the Prompt D edits. Results apply to the tested working tree and SHA together, not the committed contents of HEAD alone and not an already pushed commit. Current changes remain uncommitted; the user must commit/push and rerun the gate on the resulting SHA before requesting review. No Git mutation was performed.

### Fixed findings

| Finding | Current evidence |
| --- | --- |
| HOP6-001 — stale Angular and Playwright contracts | Full unit and E2E suites pass against the current working tree; all-city Explore and current navigation are covered. |
| HOP6-003 / HOP6-006 — per-city hub failure and retry truthfulness | Unit and Playwright recovery scenarios pass; failed and empty hub results are distinguished. |
| HOP6-004 — progressive multi-city loading | Delayed-city/503/retry E2E passes; successful city catalogs stay usable. |
| HOP6-005 — obsolete desktop demo | Desktop demo now uses the shared map and single-city saved plan; Discover is described only at supported narrower widths. |
| HOP6-006 — CSS budgets | Production build passes without component-style budget warnings; the 18/24 kB limits remain unchanged. |
| Prior HOP6-005 — mixed-city card context | Cards show the city name; responsive E2E and screenshot review pass. |
| Prior HOP6-008/009 — stale PID and map-error promises | Manual instructions identify port owners dynamically; README distinguishes isolated resource failures from startup/WebGL fallback. |

No additional proven application regression was found in this gate.

### Test command and result table

| Area | Exact command / step | Result | Evidence and limits |
| --- | --- | --- | --- |
| Runtime and dependency install | From `frontend/`, Node 24.20.0 / npm 11.19.0: `npm.cmd ci` | **PASS**, exit 0 | 457 packages. npm warned that install scripts for `@parcel/watcher`, `esbuild`, `lmdb` and `msgpackr-extract` are not covered by `allowScripts`; following lint, typecheck, unit, build and E2E gates passed. |
| Backend clean test and archive | From `backend/`, set `$env:JAVA_HOME = (Resolve-Path ..\.tools\jdk-27).Path` and prepend `$env:JAVA_HOME\bin` to PATH; run `.\gradlew.bat clean test bootJar` | **PASS**, exit 0 | Gradle 9.8.2; Java 27.0.1. BUILD SUCCESSFUL, 8 actionable tasks. JUnit XML: 37 tests, 0 failures, 0 errors, 0 skipped. Initial sandbox runs could not download Gradle; the successful run used the approved network escalation and the repo JDK. |
| Frontend lint | From `frontend/`: `npm.cmd run lint` | **PASS**, exit 0 | All files passed. |
| Frontend typecheck | From `frontend/`: `npm.cmd run typecheck` | **PASS**, exit 0 after workspace-access escalation | First sandbox run was blocked while Angular tried to read source/CSS directories; escalated retry compiled successfully. |
| Frontend unit suite | From `frontend/`: `npm.cmd run test` | **PASS**, exit 0 | 12 test files; 109 tests passed. |
| Production build | From `frontend/`: `npm.cmd run build` | **PASS**, exit 0 | Initial chunks: 443.01 kB raw / 102.57 kB estimated transfer; global styles: 79.08 kB raw / 10.35 kB estimated transfer; lazy MapLibre: 1.07 MB raw / 238.78 kB transfer. Component CSS budgets remain 18 kB warning / 24 kB error, with no component-style budget warning. These are bundle sizes, not runtime performance measurements. |
| Spring process used by E2E and live map | `netstat -ano -p tcp`; `Invoke-RestMethod http://127.0.0.1:8080/api/health` | **PASS** | Listener was `127.0.0.1:8080 LISTENING`; health returned UP. This is the helper-started local process, not a physical-phone/LAN check. |
| Full real Spring/H2 Playwright suite | From `frontend/`: `npm.cmd run test:e2e` with Spring on loopback port 8080 | **PASS**, exit 0 | 26 passed, 1 skipped in 4.6 minutes. The skipped test is the opt-in live-map smoke, run separately below. Coverage includes shared Explore, city search/selection, Discover at supported widths, desktop Discover absence, failure/retry, cross-city draft choice, 13-item plan behavior, real H2 CRUD, save errors, refresh, map fallback and responsive screens. |
| Opt-in live style smoke | `$env:HOPON_LIVE_MAP_SMOKE='1'; npm.cmd run test:e2e -- --grep 'real OpenFreeMap'` | **PASS**, exit 0 | 1 browser test. Liberty style HTTP 200 (43,311 bytes), visible canvas, MapLibre ready. This test alone does not assert tile/glyph delivery. |
| Live tile/glyph browser probe | Angular `ng serve --host 127.0.0.1 --port 4200`; Chromium at 1440×900, real OpenFreeMap, card selection, pan and wheel zoom | **PASS** | Style: 200, 43,311 bytes. 20 non-empty vector PBF tile responses and 3 non-empty glyph PBF responses all returned 200. Visible basemap, markers, selected Royal Palace details and OpenFreeMap/OpenStreetMap attribution; zero console errors and page errors. Screenshot: `frontend/test-results/hop006-e-live-map.png`. Desktop browser only. |
| Isolated H2 restart reset | On previously free loopback port 8081: `.\gradlew.bat bootRun --args='--server.port=8081'`; POST plan (201); stop only that process; restart built JAR on 8081; GET `/api/plans` | **PASS** | Same-process GET returned 1 saved plan; after isolated process restart GET returned 0. Port 8080 stayed healthy and was not stopped or modified. |
| Responsive screenshots and keyboard | Full E2E screenshot/geometry cases at 360/390/768/1024/1440, saved plans matrix, keyboard/landscape/reflow cases | **PASS**, browser automation; Explore matrix visually reviewed | No horizontal overflow or broken controls observed in reviewed Explore screenshots. The saved-plans viewport matrix and keyboard/reflow checks passed in automation. Captions, map controls, attribution and bottom navigation were visible in reviewed Explore states. This is not physical-device evidence. |
| Release documentation integrity | `git diff --check`; stale-text scan; local Markdown link check | **PASS**, exit 0 | No obsolete city-picker/desktop-Discover instructions or fixed historical PID remain. All checked local Markdown links resolve. |

### Blockers and manual owner checklist

- **Commit SHA review:** all working-tree changes remain uncommitted. The user owns commit/push; rerun the final gate against the resulting SHA before asking for independent PR review.
- **Physical phone on trusted Wi-Fi:** **NOT RUN.** Follow [the manual phone checklist](HOP-006-manual-qa-checklist.md); verify Angular port 4200 and the relative `/api/**` proxy, actual touch/keyboard/orientation, and live map on-device. Do not expose backend port 8080.
- **Clean Windows clone:** **NOT RUN.** Reproduce install, startup and routes from a genuinely clean checkout.
- **90-second rehearsal:** **NOT RUN.** Time the current desktop flow with the real screen share.
- The live map check passed in desktop Chromium, but public tile availability can change; the physical phone row remains NOT RUN.

### Deferred aesthetic feedback

No visual redesign was made. The existing responsive layout scrolls vertically on compact/tablet screens; that is expected. Visual review found no new control collision or inaccessible control. Device-specific touch sizing, safe-area behavior and performance timing remain unmeasured.

### Decision

**CONDITIONAL GO for independent review only after the user commits/pushes and the gate is rerun on the new SHA. NO-GO for release sign-off until the user-owned phone, clean-clone and timed-demo checks are complete.** No merge was performed or requested.

## Historical decision at `2f886d0`

**Historical NO-GO for LAN or release.** At that evidence capture, the physical-phone gate was NOT RUN and the existing process on port 8080 was reported bound to all interfaces. The PID and address in the historical rows above describe that old machine snapshot only; never reuse them as current process instructions. Close current phone/LAN gates using the dynamic owner-identification steps in the manual checklist. P2 follow-ups at that historical review included mobile detail/navigation overlap, unmeasured device performance/touch targets, and clean-clone reproduction. The demo outline was not timed or rehearsed.

OpenFreeMap and OpenStreetMap attribution references: [OpenFreeMap](https://openfreemap.org/), [OpenStreetMap copyright](https://www.openstreetmap.org/copyright), [OpenFreeMap terms](https://openfreemap.org/tos/). Photo-source pages: [Royal Palace](https://commons.wikimedia.org/wiki/File:Royal_Palace_Amsterdam.jpg), [Erasmus Bridge](https://commons.wikimedia.org/wiki/File:ErasmusBridge-Rotterdam.jpg), [Dom Tower](https://commons.wikimedia.org/wiki/File:Domtoren_vanaf_de_Maartensbrug.jpg).
