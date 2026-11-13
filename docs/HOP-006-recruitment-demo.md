# HopOn Netherlands — Recruitment Demo

**90-second outline; not yet rehearsed or timed.** Timings are targets, not measured results. Rehearse with the actual screen-share setup before describing this as a 90-second demo.

## Before the demo

- Use the current user-owned working tree. Start Spring with `.\.tools\run-backend.ps1` from the repository root and Angular with `npm.cmd start` from `frontend/`; open <http://localhost:4200>. Playwright uses port 4300, not the demo URL.
- Check <http://127.0.0.1:8080/api/health> before sharing. Confirm Spring listens on loopback. Use the safe, dynamic port-owner steps in the [manual QA checklist](HOP-006-manual-qa-checklist.md) if port 8080 is occupied; do not stop an unknown process. Restarting Spring clears in-memory H2 plans.
- Use a current desktop browser around 1440×900 with internet access for OpenFreeMap. Discover by Vibe is hidden at this width; use a supported narrower layout only for an optional Discover side-demo.
- Create only a disposable plan named `HopOn demo YYYYMMDD HHmm`. Do not reuse a saved-plan ID from an earlier run: H2 resets when Spring restarts. Do not clear or delete plans that are not part of this demo.

## Run of show

| Time | Click-by-click | What to say |
| --- | --- | --- |
| 0–10s | Open Explore and show the combined Amsterdam, Rotterdam and Utrecht catalog and map. | “HopOn brings three Dutch cities into one shared place guide.” |
| 10–25s | Pan and zoom the shared map between the city areas. Search for “Royal Palace” and point out Amsterdam on its place card. | “Search and filters work across the three-city catalog, and every card names its city.” |
| 25–40s | Open Royal Palace details; point out the selected map location, photo credit and approximate nearby hub information. | “The map uses MapLibre with OpenFreeMap and OpenStreetMap attribution; hub distances are approximate, not transit directions.” |
| 40–65s | Add two Amsterdam places to the tab draft, open the plan editor, enter the disposable name and save. Show the saved detail page. | “A draft belongs to this tab. A saved plan contains places from one city and is stored by Spring in in-memory H2.” |
| 65–80s | Reorder a stop, save, refresh to confirm the order, then delete only the disposable demo plan. | “The API validates city and place IDs and preserves the chosen order. H2 survives refresh while Spring runs.” |
| 80–90s | Show the Angular/Spring boundary and the current release evidence section. | “Angular 22 handles the interface; Spring Boot exposes the REST API; services and repositories back H2. The evidence ledger separates automated checks from phone and live-map work that has not been run.” |

## Map-resource fallback

An isolated tile, glyph or sprite error may leave gaps on an otherwise active map and may not show Retry. If startup reaches the explicit map fallback, check connectivity and use Retry. Continue with shared catalog search, place details, the draft and saved-plan flow; explain that OpenFreeMap is an external service. Do not claim offline tiles, transit routing, hosted uptime, accounts or AI recommendations.

## Rehearsal notes

- The create, reorder, refresh and delete sequence may take longer than the target timings. Rehearse it with the actual browser and screen-sharing delay; keep each persistence check visible.
- Use only the disposable demo plan and its runtime-generated ID. If a save result is uncertain, inspect Saved Plans before retrying to avoid a duplicate.
- Desktop Discover is not part of this flow. If you demonstrate it separately, use a supported narrower viewport where the control is present and record the viewport.
- Automated evidence is not a timed rehearsal, a physical-phone test or a production deployment.
