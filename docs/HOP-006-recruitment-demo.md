# HopOn Netherlands — Recruitment Demo

**90-second outline; not yet rehearsed or timed.** The timings are targets, not measured results. Rehearse on the actual screen-share setup and adjust rather than claiming the sequence has been proven to fit 90 seconds.

## Before the demo

- Use the current user-owned working tree. Start Spring with `.\.tools\run-backend.ps1` from the repository root and Angular with `npm.cmd start` from `frontend/`; open <http://localhost:4200>. Playwright uses port 4300, not the demo URL.
- Check <http://localhost:8080/api/health> before sharing. Confirm that Spring is bound to loopback. The current pre-existing process must be safely restarted to apply the working-tree loopback setting; restarting Spring resets in-memory H2 plans. Do not stop it until any plans that matter have been accounted for.
- Use a current desktop browser around 1440×900, with a working internet connection for OpenFreeMap tiles. If tiles are unavailable, use the fallback described below.
- Create only a disposable plan named `HopOn demo YYYYMMDD HHmm`. Do not reuse a saved-plan ID from an earlier run: H2 data is reset when Spring restarts. Do not clear or delete plans that are not part of this demo.

## Run of show

| Time | Click-by-click | What to say |
| --- | --- | --- |
| 0–10s | Open Explore and show the city selector; briefly switch Amsterdam → Rotterdam → Utrecht, then return to Amsterdam. | “HopOn is a guide to three Dutch cities, built around a curated place catalog.” |
| 10–25s | Search for “Royal Palace”, choose the Architecture category, then select one Discover by Vibe theme. | “Search and Discover use the catalog; Discover is deterministic, not AI.” |
| 25–40s | Show the map clusters, open Royal Palace from its place card, point to the selected marker and photo credit. | “MapLibre displays OpenFreeMap tiles over OpenStreetMap data. The map is an external service; the catalog still works if it is unavailable.” |
| 40–65s | Add two places to the draft, open plan review, enter the disposable name, save, and show the saved detail page. | “The tab draft is temporary. Saving sends a real request to Spring and stores the plan in in-memory H2.” |
| 65–80s | Reorder one stop, save changes, refresh the detail route to show the saved order, then delete only the disposable demo plan. | “The API validates city and stop IDs and preserves the selected order. H2 survives refresh while Spring remains running.” |
| 80–90s | Point to the app and explain its Angular/Spring boundary; finish on the test evidence in the release ledger. | “Angular 22 handles the interface; Spring Boot exposes the REST API; services and repositories back the H2 persistence. Backend, frontend and Playwright checks are recorded in the evidence ledger.” |

## Map-unavailable fallback

If the basemap is missing, do not describe it as loaded and do not spend the demo repeatedly retrying it. Show the map-unavailable message, continue with catalog search, photo details, the draft and saved-plan flow, and explain that the public OpenFreeMap service is external. Do not claim offline tiles, transit routing, hosted uptime, accounts, or AI recommendations.

## Rehearsal notes

- The create, reorder, refresh and delete sequence may take longer than the target timings. Rehearse it with the actual browser and screen-sharing delay; keep every persistence check visible.
- Use only the disposable demo plan and its runtime-generated ID. If a save result is uncertain, inspect Saved Plans before retrying to avoid a duplicate.
- The current automated evidence is not a timed rehearsal, a physical-phone test, or a production deployment.
