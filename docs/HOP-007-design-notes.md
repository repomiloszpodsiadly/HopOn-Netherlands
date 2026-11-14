# HOP-007 — visual redesign

The current visual reference is `prompts/2262d26e-df13-4e11-bc4f-2b11ca05061b.png`: peach canal scenery, warm ivory surfaces, forest green, sage and a terracotta headline accent. The user explicitly removed the lower-left tulips. The app fills the browser directly. The implementation baseline remains `prompts/plan/MASTERPLAN.md` and the existing three-city explorer and saved-plan flows.

## Final field limits and stable plan cards — 14 November 2026

Plan names now allow at most 30 characters and descriptions 500. Native input/textarea limits, editor save guards, draft/response validation, autosave guards, Spring validation and H2 column lengths use these limits. Generated numbered names reserve room for their suffix. Names of 31 characters and descriptions of 501 are rejected by the API without changing a saved record. The visible description counter omits Optional, and the form summary omits the redundant name-length paragraph while save validation still runs.

Saved-plan titles use at most two lines, retain their full accessible name/title, and reserve consistent space. The illustration/body area and date footer share explicit grid rows, keeping neighboring cards aligned. Current-plan titles wrap within their own column and do not overlap the action or cause horizontal scrolling. The short desktop description minimum was reduced slightly so the complete field remains inside the panel.

At the user's request, the backend was started afresh without restoring prior plans, eliminating the earlier 80-character records. Validation: all 134 frontend unit tests, 19 API tests and one H2 persistence test passed. Five distinct focused browser scenarios passed, covering native 30/500 limits, equal card/date positions and the current-plan banner across five viewports, eight-viewport editor geometry, multiline description CRUD and API rejection, autosave and six-plan capacity. Production build, lint and diff checks passed; desktop and mobile screenshots were inspected.

## Automatic saving, six-plan capacity and warm map states — 14 November 2026

Explore and Discover now save the first selected places automatically and make the confirmed saved plan current. Further map additions update that same plan. Drafts keep their optional autosave UUID in tab storage until the exact submitted content is confirmed. The root autosave service survives SPA navigation, retries interrupted creation with the same UUID, preserves newer edits, and does not replace a different current selection. Failed saves remain recoverable in the tab with an explicit retry action; no automatic retry loop runs after an error.

Both explicit creation and autosave allocate the first available case-insensitive name, appending `-1`, `-2`, … and shortening the base when necessary to stay within 80 characters. Spring enforces a maximum of six saved plans through a creation lock held until transaction commit. A seventh creation returns HTTP 409 Problem Details explaining that the user can use or delete an existing plan. Existing plans remain editable at 6/6 and retain the 12-place limit. The list shows capacity and disables its create action; direct-editor and map failures retain inputs and link to Saved Plans. Retrying autosave for an already created UUID does not consume another slot or rename that plan.

Map initialization, loading and unavailable states use warm ivory and sand backgrounds, with a matching spinner. Real map rendering and attribution remain unchanged. The backend was restarted with the two existing plans restored using their original IDs, contents and timestamps.

Validation: all 132 frontend unit tests passed; 18 backend API tests passed, including concurrent capacity/name allocation and idempotent autosave. Twelve distinct browser scenarios passed across the focused runs, covering real H2 autosave, numbered names, 6/6 rejection and updates, recovery after freeing a slot, three-city additions, Discover, map outages, draft recovery, current selection and viewport screenshots. Production build, lint and diff checks passed. Browser tests clean up only their own saved records; external map failures in outage scenarios are intentional fixtures. Warm loading and mobile fallback screenshots were inspected.

## Draft and saved stop tables — 14 November 2026

Review current plan now renders an unsaved draft's stops in the same compact table style as a saved plan: numbered rows, place and city, type, order controls and an accessible trash button. Both editors use one shared table stylesheet. Draft metadata, ordering, removal, session restoration and save validation are preserved. Short desktop layouts fit all 12 rows; mobile uses wrapped names, hidden type columns and 44 px action targets.

Validation: 32 focused create/details unit tests, a new browser scenario covering 1/12 mixed-city stops across four viewport sizes, the existing eight-viewport editor layout scenario, production build, lint and diff checks passed. Reordering and removing draft stops survive refresh. The browser scenarios did not write saved-plan data. Desktop and phone screenshots were inspected.

## Current plan selection and live API repair — 14 November 2026

Use this plan selects a saved plan for subsequent additions and opens its map. This action uses a blue fill with white text, darker hover/pressed states and a blue keyboard focus ring. The tab remembers only its ID; ordinary Explore navigation and refresh reload that plan from the API. Review current plan opens the tab draft or current saved plan as appropriate. Starting a new draft selects the draft; a confirmed save promotes it to the current saved plan. Removed selections are cleared, and unsaved-edit confirmation still protects changes before switching.

The running backend was an older process still rejecting cross-city places. The latest backend passed 14 API tests and a three-city live POST probe. After a restoration preflight, the user requested a fresh H2 database, so the final backend was started without restoring old plans. The real browser scenario creates its own plans, switches selection, adds Amsterdam/Rotterdam/Utrecht places, checks refresh/navigation and cleans up only its records. The saved-plan list was empty after cleanup.

The create view now aligns the Stops in plan section with A DAY, YOUR WAY. Its top-right Saved Plans link and the list's top-right Your city days note were removed. Validation: 68 focused frontend unit tests, three distinct browser scenarios, 14 backend API tests, production build and lint passed. The browser scenarios include eight viewport layouts and a real Spring/H2 workflow, rather than relying solely on mocked plan responses.

## Compact exploration actions and plan metadata — 14 November 2026

Explore no longer shows Browse freely or a standalone Clear filters action below categories. Saved plans navigation uses the shared warm ivory/beige hover palette and a centered SVG chevron. The create-plan introduction was removed. Saved-plan details omit the Saved plan badge and place Created/Updated just below the action separator with 5 px padding. Explore map includes a small original local globe SVG with blue water and green land; its plan context behavior is unchanged. Saved-plan card arrows also use centered SVGs.

Verification passed: 49 focused unit tests, including a final rerun of the 28 Explore tests; three browser scenarios, with the affected Explore/map scenarios rerun after the last header change; production build, lint and diff checks. Tests cover the globe asset, date spacing, warm hover, centered arrows, plan context, and empty/full plan layouts across eight viewport sizes. Plan writes used fixtures. Desktop and phone screenshots were inspected.

## Readable dialogs and visual details — 14 November 2026

The unsaved-change dialog now uses plain language, **Keep editing** and **Leave without saving**, a small document icon, system typography and 48 px actions. Keyboard focus still starts on Keep editing; Escape cancels and preserves edits. The dialog heading input no longer uses the native `title` attribute, preventing a duplicate browser tooltip. The Saved Plans footer and the requested empty-plan helper texts were removed.

The Explore stop count shares a flex row with its plan action. The plan and place-card chevrons use centered SVGs. Featured-place photo credits are available through an accessible information disclosure; the default view has no text overlay or technical processing paragraph. Source, author, license and a concise change notice remain available there, and the complete catalog attribution metadata remains intact.

Verification: 54 focused unit tests, two deterministic Playwright scenarios, production build, lint and diff checks passed. Browser checks cover 1440, 1280, 390 and 360 px widths, count/chevron geometry, keyboard cancellation and explicit leaving, photo-credit disclosure, Saved Plans and saved-plan map context. API writes use fixtures; existing plans were not changed. Desktop and phone screenshots were inspected.

## Saved plans can span the three cities — 14 November 2026

The latest direction supersedes the earlier one-city-per-plan rule: `cityId` remains the plan's starting/reference city, while ordered POIs in drafts and saved plans may come from Amsterdam, Rotterdam and Utrecht. New drafts and saved plans can add places from all three cities. The saved-plan picker loads all three catalogs, and **Explore map** opens the shared map in the selected plan's context. Adding a place there updates that saved plan while preserving its name and description, enforces unique IDs and the 12-place limit, and reports API failures. The Explore landing's normal appearance stays frozen.

**Use this plan** sits beside **Save changes** and makes this saved plan current. **Explore map** belongs to the right-hand Stops in plan header and opens the map for the current saved plan, with or without existing stops, including a full 12-place plan. Navigation focuses and scrolls to the map; the mobile Map item retains the selected saved plan. Unsaved edits use the existing leave-confirmation dialog, so cancelling retains the edits without saving or leaving. The map action is disabled during save/delete requests or when the plan is unavailable.

Verification for the revised action placement: 17 focused details unit tests and two deterministic Playwright scenarios passed. Browser coverage includes desktop and mobile button placement, navigation/focus, Rotterdam and Utrecht additions to an Amsterdam-starting plan, repeated return to the same populated plan, and eight viewport layouts with empty/full plans. At 12 stops the inactive place picker is replaced by the limit message, leaving space for all rows on short desktop screens. Plan API writes in these scenarios use in-memory fixtures; existing H2 plans were untouched. Live user-browser automation was unavailable; Playwright screenshots were inspected instead.

## Plan description and country — 14 November 2026

Plans now have an optional description of up to 1000 characters. Create and details use a multiline textarea with a character counter; phone layouts give it the full row width and 16 px text. Descriptions survive tab-draft restoration and empty-draft city changes, are included in explicit create/update requests, persist in H2 and participate in dirty-state/navigation protection. Blank or omitted API descriptions normalize to an empty string; outside whitespace is trimmed while internal newlines remain. Oversized writes return HTTP 400 without modifying the saved plan. Legacy tab drafts and responses without the field normalize safely.

The earlier one-city-per-plan direction is superseded: `cityId` remains the starting/reference city, while both drafts and saved plans may contain POIs from all three cities. Create still starts with a Country dropdown (one native option: Netherlands) and a City dropdown. Country is fixed application context, so no duplicate country column, service or entity is introduced. The Explore landing source remains unchanged.

Verification passed: production build and lint; 119 frontend unit tests; 15 focused backend API/H2 tests; six browser scenarios covering multiline-description CRUD, clearing and length rejection, Country/City selection, restoration, responsive editors, existing empty-plan CRUD, save failure recovery and mobile keyboard/history. Live port-4200 visuals were inspected at desktop and phone sizes, including 1280×600 and 360×640. Backend changes are running on port 8080. The five old plans were first preserved and verified during rollout, then deleted at the user's explicit request; the final saved-plan list is empty. No Git staging, commit or push was performed.

## Plan description and country — 14 November 2026

Plans now have an optional description of up to 1000 characters. Create and details use a multiline textarea with a character counter; phone layouts give it the full row width and 16 px text. Descriptions survive tab-draft restoration and empty-draft city changes, are included in explicit create/update requests, persist in H2 and participate in dirty-state/navigation protection. Blank or omitted API descriptions normalize to an empty string; outside whitespace is trimmed while internal newlines remain. Oversized writes return HTTP 400 without modifying the saved plan. Legacy tab drafts and responses without the field normalize safely.

The earlier one-city-per-plan direction is superseded: `cityId` remains the starting/reference city, while both drafts and saved plans may contain POIs from all three cities. Create still starts with a Country dropdown (one native option: Netherlands) and a City dropdown. Country is fixed application context, so no duplicate country column, service or entity is introduced. The Explore landing source remains unchanged.

Verification passed: production build and lint; 119 frontend unit tests; 15 focused backend API/H2 tests; six browser scenarios covering multiline-description CRUD, clearing and length rejection, Country/City selection, restoration, responsive editors, existing empty-plan CRUD, save failure recovery and mobile keyboard/history. Live port-4200 visuals were inspected at desktop and phone sizes, including 1280×600 and 360×640. Backend changes are running on port 8080. The five old plans were first preserved and verified during rollout, then deleted at the user's explicit request; the final saved-plan list is empty. No Git staging, commit or push was performed.

## Compact settings and empty-city change — 14 November 2026

The create and saved-plan editors share short horizontal settings rows: labels on the left, wide controls on the right, smaller headings and icons. Desktop controls are 40 px high; touch and narrow layouts retain 44 px controls and 16 px input text. The create settings section is about 156 px high at 1440×720. The Explore landing page is frozen by the user; its 19 source files were hash-checked and unchanged during this update.

Changing a tab draft's starting city preserves its name and every stop. The selected option, stored city and loaded catalogs stay synchronized, including restored cross-city drafts and cancelled requests. Adding places from another city appends to the existing draft without a replacement prompt. This supersedes the earlier keep/replace draft direction.

Validation passed: lint, production build, 40 focused store/create/details unit tests and six Playwright scenarios. Browser checks cover repeated empty-city changes at desktop and phone sizes, restoration, populated-draft decisions, real empty-plan saving in the newly selected city, editor geometry, failure recovery and mobile keyboard/history CRUD. Live port-4200 screenshots were inspected without API writes or a backend restart.

## Compact settings and empty-city change — 14 November 2026

The create and saved-plan editors share short horizontal settings rows: labels on the left, wide controls on the right, smaller headings and icons. Desktop controls are 40 px high; touch and narrow layouts retain 44 px controls and 16 px input text. The create settings section is about 156 px high at 1440×720. The Explore landing page is frozen by the user; its 19 source files were hash-checked and unchanged during this update.

Changing a tab draft's starting city preserves its name and every stop. The selected option, stored city and loaded catalogs stay synchronized, including restored cross-city drafts and cancelled requests. Adding places from another city appends to the existing draft without a replacement prompt. This supersedes the earlier keep/replace draft direction.

Validation passed: lint, production build, 40 focused store/create/details unit tests and six Playwright scenarios. Browser checks cover repeated empty-city changes at desktop and phone sizes, restoration, populated-draft decisions, real empty-plan saving in the newly selected city, editor geometry, failure recovery and mobile keyboard/history CRUD. Live port-4200 screenshots were inspected without API writes or a backend restart.

## Compact saved-plan table — 14 November 2026

Saved-plan details now use a wider split workspace: settings on the left and a semantic ordered table spanning the full right column. Each place has one row with its number, name, type, move controls and an accessible trash button. The desktop table shows all twelve rows without an internal scrollbar at 1440×900, 1440×720, 1280×600 and 1024×600. Names have full-text hover titles; narrower and touch layouts wrap names, hide the secondary type column and retain 44 px controls. Short desktop mouse layouts use 24–30 px controls.

The left column has a compact city label, a name editor with a character count, a simpler Add a place panel and small inline created/updated dates. The name help, date card, top-right note and detail-page footer were removed at the user's request. Whole-plan deletion uses an icon and the existing confirmation dialog; its destructive action is muted terracotta, while ordinary confirmation uses the shared olive action color. Mobile save actions stay in document flow so they cannot cover the picker or table rows. Saving, cancellation, explicit delete confirmation and the 12-place boundary keep their existing behavior. No backend restart or user-plan changes were needed for the visual checks.

Validation for the compact table and simplified left panel: `npm run lint` and `npm run build` passed; `npm test -- --include=src/app/features/plans/plan-details-page.spec.ts` passed 14/14. Four distinct Playwright scenarios passed across the CRUD run and focused layout rerun: real H2 CRUD during map outage, eight-viewport table/layout checks, empty-plan CRUD, and mobile keyboard/history CRUD. Desktop geometry checks assert all twelve rows fit inside the table viewport. The live screenshots also verify the terracotta delete confirmation (opened and cancelled) and the preserved existing user plan. Two disposable records from an earlier timed-out test were verified by exact ID and name, then removed; user records were retained.

## Plan editor refinement — 14 November 2026

Follow-up navigation polish: Create now has **Back to places** beside its title. Saved-plan details have **Back to Saved Plans** beside the plan name, replacing the lower return link and duplicate header navigation. The native Angular links preserve draft state and existing navigation guards. Details use quiet champagne icon accents, a stop-count pill, a clearer empty state, and the existing pointer highlight on appropriate actions. Focused checks passed: lint, 28 create/details unit tests and four browser scenarios (eight-viewport editor layout with header navigation, empty-plan CRUD, delayed-save exit protection, and mobile keyboard/history CRUD). Live port-4200 screenshots were inspected; the backend was not restarted.

- New drafts use **My day out** consistently, including drafts started from a place or an explicit city replacement. Existing saved names and restored tab drafts keep their names.
- Create gives the plan name its own card, makes city selection secondary, and explains that places can be added later. It reuses the local decorative map and skyline assets.
- Saved-plan settings and stop lists occupy independent desktop columns. The save row has a reserved grid area; shrinking the window scrolls column content instead of allowing the Add place controls to overlap Save changes. Feedback also has its own row. Phones use document flow and a save bar above navigation.
- Browser regression covers 1440×900, 1440×720, 1280×600, 1024×600, 768×1024, 720×480, 390×844 and 360×640, with empty and twelve-stop plans. At 1440×720, empty-plan controls fit without internal clipping. Keyboard focus follows name → place picker → stop actions.
- Validation: lint and production build passed; focused draft/create/details/Explore unit tests passed **65/65**. Seven distinct browser scenarios passed across the initial run and focused reruns: shared draft CTA, three-city draft names, responsive editors, empty-plan CRUD, thirteenth-place rejection, create failure recovery, and mobile keyboard/history CRUD. The keyboard assertion was updated for the new visual and DOM order.
- The live frontend on port 4200 was checked against the existing user plan without API writes or a backend restart. All three existing saved plans were retained.

## Layout and interaction

| Screen | Composition |
| --- | --- |
| Desktop, 1101 px and wider | One viewport: compact discovery column, internally scrolling results, large live map, draft summary below it. Brand and Saved plans link sit inside the discovery column. |
| Tablet | Two columns where readable; a single column below 901 px. Map, filters and plans stay usable without squeezing cards. |
| Phone, 360–430 px | Short headline and search, horizontally scrolling categories, shared map, draft summary, Discover and results. The document scrolls naturally. Explore / Map / Plans stays at the bottom. |
| Place details | Docked desktop panel; phone sheet above the bottom navigation with its own scroll and a visible Add to plan action. |

Search, category filters and selection continue to use the same three-city catalog. The Map navigation focuses the existing map and receives its own active navigation state. The map refits the overview after a width change and preserves selected-place focus without recreating the instance. Desktop Discover remains hidden, and it remains available at narrower widths. All states for partial city loading, hub errors, draft conflicts and CRUD are retained.

## Artwork and photography

The later header refinement uses two words per heading: **Discover places** and **Browse freely**. The redundant count above the map is removed. Category filters use individual ivory tiles, sage icon badges and a warm champagne selected state with dark olive text, with the compact label **Categories**. The grid uses up to three equal columns and adapts to two in a narrow sidebar; phone filters scroll horizontally. The shared SVG icon component is also used by result cards. Keyboard focus and pressed-state announcements remain available.

- `frontend/public/assets/brand/hopon-tulip.svg`: local vector mark, reused on Explore and all plan pages.
- `frontend/public/assets/brand/netherlands-panorama-v2.jpg`: active generated decorative Dutch canal composite, 1672 × 941, JPEG quality 85, 121,819 bytes. Peach light, canal houses and a windmill; the lower-left corner contains water and a stone quay with no tulips. It is not a photograph of a single real viewpoint or a catalog image. The earlier `netherlands-panorama.jpg` is retained as the first iteration.
- `frontend/public/assets/brand/day-plan-glass-map.png`: generated decorative glass pin and ceramic map, 240 × 240 with alpha, 67,395 bytes; displayed at 88 px in the desktop plan panel. It replaces the earlier calendar decoration, which remains available as `day-plan-calendar.svg`. The original `day-plan-skyline.svg` stays behind the real draft state and actions.
- Existing Royal Palace, Erasmus Bridge and Dom Tower photos remain tied to their real catalog entries and `assets-attribution.json`. Cards use larger desktop thumbnails, warm featured badges and a selection arrow. The 44 px information control on each photo opens Photo credits with source, author, license and change notice; it does not consume a separate row while closed.
- Other places use category icons and readable text. The full catalog remains available without downloading a photo for every place.
- Existing MapLibre clustering and the live OpenFreeMap basemap remain functional; counts reflect API data. The reference's decorative connection lines and feature labels do not define new product features.

Native responsive image selection follows [MDN's responsive image guidance](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images). Navigation and sheets retain [safe-area padding](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env). The map keeps its [GeoJSON clustering](https://maplibre.org/maplibre-style-spec/sources/#geojson).

## Soft light treatments

The existing scenic page background remains unchanged. Following user review, `explore-atmosphere.css` uses soft peach and champagne light behind the workspace and along the map edge; the mint background wash is removed. Selected categories use champagne highlights and dark olive text. The plan action uses a muted olive gradient with a restrained warm reflection and a small neutral shadow, replacing the saturated green glow. Decorative pseudo-elements cannot intercept pointer input. The initial colour wash runs once for 4.8 seconds, then settles; it is disabled with reduced motion. Hover and focus provide later changes without continuous animation. Forced-colour mode removes the decorative layers. No animation library or new dependency is needed.

The redundant caption beneath the map is removed. MapLibre keeps its native in-map source attribution; the unavailable-map state includes source links inside the map frame. The full map-region focus rectangle is replaced by an underline on its heading for keyboard focus. Pointer focus does not draw a panel outline, while the region remains a navigation/focus destination.

## Interaction polish

Search, category tiles, saved plans, result cards and the plan action share a cursor-following copper edge reflection. `PointerLightDirective` only tracks a mouse on a fine-pointer device with motion enabled. It coalesces updates to one animation frame, works outside Angular change detection, resets when the pointer leaves or preferences change, and removes its listeners and pending frame on destruction. It does not handle clicks or alter navigation. The reflection is confined to the border, preserving text contrast.

The plan action has a round arrow and one short highlight sweep on hover or keyboard focus. Category icons lift slightly on hover. Cards lift two pixels and gently zoom their photos inside a clipped media frame. Touch uses a restrained press response; the mobile navigation has a champagne active pill. The initial reveal is short and only the first three result cards are staggered. These movements are disabled with reduced motion; keyboard focus, native actions, photo credits and source attribution remain accessible. No new imagery or animation dependency is required.

## Verification — 13 November 2026

### Saved collection refinement — 14 November 2026

Saved plans now use illustrated city cards with original local SVG artwork: `city-amsterdam.svg`, `city-rotterdam.svg` and `city-utrecht.svg` under `frontend/public/assets/brand/`. These are decorative city illustrations, separate from licensed catalog photography. Each card keeps the real city, place count, name and both API timestamps, with its whole surface linking to the saved plan. A collection summary uses the loaded plan data without extra catalog requests. The keyboard-accessible **Back to places** link sits beside the heading, including on compact phone layouts. Desktop viewport containment and internal list scrolling remain intact.

The Explore summary no longer displays the technical Temporary/not-saved paragraph after places are added. The draft name, count and Review and save draft action remain; saving still requires the existing explicit action.

`npm.cmd run lint`, production build and all 112 unit tests PASS. `npm.cmd run test:e2e -- --grep "shared draft CTA|adds each city|keeps saved plans usable" --output=.angular/collection-e2e`: all 3 PASS. Read-only Chromium review covered 360, 390, 768, 1024, 1280 and 1440 px with city/count/long-name fixtures, empty state, visible illustrations, keyboard Back navigation and a one-stop draft. Screenshots: `frontend/test-results/hop007-collection/`. The live frontend was refreshed to pick up the current source; the backend and its two user plans were retained.

### Plan workflow and recovery refinement

The user-approved contract is now **0–12 places** for both creating and updating saved plans. Empty plans have an intentional state and can receive places later. A thirteenth new draft place or oversized batch is rejected without changing existing selections; API requests over the limit return HTTP 400. Previously restored oversized drafts remain intact for explicit removal. Names, supported cities, duplicate/cross-city validation, ordered IDs, safe errors and uncertain-save recovery remain enforced. This override is also recorded at the top of the local masterplan.

Create and Saved Plans use a shared rounded workspace that fits desktop viewports from 1000 px wide; long lists scroll internally. Mobile reflows naturally with a compact sticky save bar and space above the bottom navigation. Result cards have additional hover/focus clearance. Detail actions, map points and clusters use the muted palette. Map failure exposes only Retry map; the removed Browse places event and handler have been deleted, with recovery tested across repeated failures.

- `npm.cmd run lint`: PASS.
- `npm.cmd test`: PASS, 112 tests in 13 files. Three obsolete Browse places handler cases were removed with that action; reconnect and empty-plan coverage remain.
- Backend: `gradlew.bat test --no-daemon --tests com.hopon.plans.api.PlanApiIntegrationTest --tests com.hopon.plans.persistence.PlanPersistenceIntegrationTest`: PASS, 12 tests. Covers empty create/read/update, exact upper boundary and rejecting 13 without changing an existing plan.
- `npm.cmd run build`: PASS without budget warnings, 461.18 KB initial output.
- Targeted E2E: empty save/add/remove/reload, blocked thirteenth place with API ProblemDetail, restored 13-place draft, repeated map reconnect, compact Explore and mobile saved-plan navigation: all six scenarios PASS. The mobile check initially found insufficient bottom reserve; restoring 102 px corrected it and its focused rerun passed.
- Live browser review: desktop containment, mobile reflow and a real disposable empty-plan save/reload; long-list scrolling uses 24 response fixtures rather than database records. Screenshots: `frontend/test-results/hop007-plans/` and `frontend/test-results/hop007-interactions/`. Browser emulation is not physical-phone validation.

### Earlier design iterations

- `npm.cmd run lint`: PASS.
- `npm.cmd test`: PASS, 110 tests across 12 files. Includes responsive map lifecycle and navigation-state regression coverage.
- `npm.cmd run build`: PASS after the peach-reference refinement with the existing budgets and no component-style warning; initial output 450.40 KB, estimated transfer 104.38 KB. Static imagery is separate from this bundle figure.
- Initial redesign revision, `npm.cmd run test:e2e`: 24 passed, 2 responsive failures and 1 expected opt-in live-map skip. Both failures identified the map caption extending under the phone navigation; root scroll padding was corrected.
- `npm.cmd run test:e2e -- --grep "captures real Explore viewport states|checks responsive geometry|Map navigation focuses"`: PASS, all 3 scenarios after that correction, including the five-viewport screenshot matrix. The earlier broad run also exercised real Spring/H2 CRUD and API/map failure recovery.
- Separate Chromium review against the running app and live basemap: PASS at 360, 390, 768, 1024 and 1440 px; no horizontal overflow; 1440 × 900 fits one desktop viewport; detail sheet and map attribution clear the phone controls; selection, Escape focus restoration, Map navigation and Plans remain usable. Screenshots: `frontend/test-results/hop007/`.
- `git diff --check`: PASS. Physical-phone validation is not part of these browser checks.
- Header/filter refinement: lint, all 110 existing unit tests and production build PASS. The separate live browser review was rerun across all five widths, including the short headings, absence of the map count, category selection/reset, detail sheet, keyboard focus and navigation.
- Peach-reference refinement: lint, all 110 unit tests and production build PASS. `npm.cmd run test:e2e -- --grep "renders correctly licensed|actual initial Explore viewport|draft-to-catalog"`: all 3 PASS. The live browser review also passed at all five widths, including opening/closing photo credits. Current screenshots are in `frontend/test-results/hop007-v2/`.
- Category tile refinement: `npm.cmd run lint` and `npm.cmd run build` PASS, with no build budget warning. `npm.cmd run test:e2e -- --grep "searches and filters|actual initial Explore viewport|keeps Explore search usable"`: all 3 PASS. Live Chromium review passed at 360, 390, 768, 1024, 1101, 1280 and 1440 px, including category selection/reset, label overflow checks and desktop viewport containment. The initial review found a cramped label at 1101 px; the responsive two-column grid corrected it. No new dependencies or raster assets.
- Light-treatment refinement: lint and production build PASS without budget warnings. `npm.cmd run test:e2e -- --grep "draft-to-catalog|automatic scrolling for the map|keeps Explore search usable"`: all 3 PASS. Live Chromium review passed at the same seven widths, including asset loading, pointer interaction, detail-sheet focus restoration, finite animation duration and disabled animation under reduced motion. The draft action stays vertically centered when its adjacent title wraps. Latest screenshots: `frontend/test-results/hop007-light/`. The unchanged backdrop and new 67 KB illustration are separate from the application bundle.

Latest caption/palette/focus refinement: `npm.cmd run lint` PASS. `npm.cmd run test:e2e -- --grep "checks responsive geometry|keeps search and tab draft usable|keeps Explore search usable"`: all 3 PASS (production compilation included). The deterministic style now exposes attribution through a fixture source, so the checks exercise the actual MapLibre attribution control instead of the removed caption. Live Chromium review passed at seven widths, including absent captions, pointer focus without an outline and keyboard focus with the heading underline. Desktop attribution is inset from the map's rounded corner. Latest screenshots: `frontend/test-results/hop007-champagne/`.

Final control-colour refinement: `npm.cmd run lint` PASS. Live Chromium review passed at seven widths, including category selection/reset, focus, navigation and default/hover screenshots. Category labels retain at least 5.62:1 contrast across the new gradient endpoints; the plan label retains at least 4.83:1 even under a conservative full-strength warm-reflection calculation. This refinement only changes the two control treatments and adds no new assets or dependencies.

Interaction verification: `npm.cmd run lint` PASS; `npm.cmd test` PASS (113 tests in 13 files); `npm.cmd run build` PASS without budget warnings (460.84 KB initial output, 106.26 KB estimated transfer). `npm.cmd run test:e2e -- --grep "pointer highlights|renders correctly licensed|draft-to-catalog"`: all 3 PASS, covering moving pointer highlights, native filtering/navigation, reduced motion, photo credits and keyboard geometry. The live Chromium review checks seven widths, a touch-enabled mobile context, clipped photo zoom, preference changes, navigation and map availability. Screenshots: `frontend/test-results/hop007-interactions/`.

## Travel illustration generation

Generated with the built-in `image_gen` tool on 13 November 2026 with transparent background enabled. The original PNG is preserved in the generated-images directory. The project copy is resized to 240 × 240 PNG with alpha preserved; only resolution and encoding changed. The asset is a decorative imagined object, not catalog photography. Final path: `frontend/public/assets/brand/day-plan-glass-map.png`.

Final prompt:

```text
Use case: stylized-concept. Asset type: small premium 3D travel illustration used as a decorative detail in the day-plan card of a Netherlands travel app. Primary request: a beautifully crafted folded ivory travel map with a single sculptural translucent emerald-glass location pin rising above it, and one tiny warm apricot route dot on the map. Three-quarter isometric studio view. The map has a few very simple sage route lines, not a real geographic map and no words. Material quality is the hero: softly rounded ceramic ivory folds, polished frosted green glass pin, refined mint edge light, subtle warm amber reflections. Calm, sophisticated, modern travel product design; restrained, tangible, not a toy or a gaming badge. Compact single-object composition, centered, object fills about 85% of a square canvas; very clear silhouette readable at 80 pixels. Tiny soft contact shadow immediately below the object, no surrounding glow that fills the canvas. Genuinely transparent background, preserve alpha. No flowers, tulips, buildings, suitcase, people, extra objects, frame, badge container, typography, logo, watermark, background plane or scenery. Artwork only.
```

## Current background generation — peach reference

Generated with the built-in `image_gen` tool on 13 November 2026; the original PNG is retained in the tool's generated-images directory. The project consumes the versioned JPEG above. The skyline and calendar are code-native SVGs. Two-word headings remain **Discover places** and **Browse freely**; the reference's longer headline is not copied.

Final v2 prompt:

```text
Use case: illustration-story. Asset type: full-bleed decorative background artwork for a premium Netherlands travel web app, to sit behind a large warm ivory application panel. Primary request: a serene Dutch canal at golden hour, in the delicate creamy peach and pale apricot palette of an elegant travel editorial. Wide 16:9 landscape. The central 80% and upper 75% of the image must be extremely quiet luminous pale peach sky and misty cream negative space; the website UI will cover this area. Confine a few Amsterdam canal houses with warm stone and reddish-brown gables to the extreme lower-left edge, reflected in calm water at the bottom. A traditional Dutch windmill and a few distant canal houses occupy the extreme lower-right edge. Small soft tree branches enter from the far left edge around mid-height. Soft warm directional sunlight, airy pastel atmosphere, natural believable materials, polished editorial photography with delicate painterly softness. A very small out-of-focus orange tulip may enter at the extreme bottom-right corner ONLY. Crucial: the entire lower-left corner must contain plain calm water and stone quay, with NO tulips, NO flowers, NO flower beds, NO green foreground leaves or plants. No flowers anywhere on the left half of the image. Keep the architectural edge details understated, not saturated or busy; cream, peach, honey, sage reflections. This is a decorative imagined Dutch city composite, not a documentary location photograph. No laptop, phone, browser, interface, buttons, map, cards, panels, lettering, logos, typography, watermark or frame. Artwork only, full bleed.
```

## First background generation record

Generated with the built-in `image_gen` tool on 13 November 2026. The original generated PNG remains in the tool's generated-images directory. The application uses the locally encoded JPEG above.

Final prompt:

```text
Use case: illustration-story. Asset type: decorative panoramic website background for the HopOn Netherlands travel explorer. Create a polished, warm, editorial travel panorama inspired by Dutch city breaks. A calm Amsterdam canal with elegant historic narrow canal houses on the far left, Rotterdam's Erasmus Bridge and modern riverside skyline on the far right, a distant Utrecht Dom Tower in the skyline, warm late-afternoon sunlight, pale cream and powder-blue sky, subtle soft clouds, small orange and coral tulips growing naturally in the extreme lower corners. Horizontal 16:9 landscape. The central 65 percent of the composition is very quiet, bright, low-detail sky and soft water haze, because a functional cream UI will sit over it; concentrate architecture and flowers near the outer edges. Sophisticated cinematic editorial photography aesthetic, natural materials and believable light, restrained saturation, forest-green/coral accents, inviting and airy, no people in focus. This is a decorative composite evoking the three cities, not a documentary single viewpoint. Absolutely no laptop, computer, phone, screen, device frame, app interface, map, browser, lettering, text, logos, watermark, buttons or icons. Full bleed artwork only.
```
