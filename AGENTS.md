# HopOn Netherlands — Project Guide

Welcome to HopOn: a travel guide for Amsterdam, Rotterdam, and Utrecht, with an interactive map and day planner.

## Project at a glance

- The frontend is Angular 22 and TypeScript; the API is Spring Boot with Java 27.
- Places come from a curated catalog. Saved plans use in-memory H2, so they reset when the backend stops.
- The app runs on port 4200, the API on 8080, and Playwright on 4300. The frontend proxies `/api` to the backend.
- The map uses MapLibre with OpenFreeMap styles and OpenStreetMap data. Keep attribution visible and make places and planning usable when the map is unavailable.
- Keep each featured photo's source, author, license, and change notice with its catalog entry.

## Before changing code

- Read prompts in ascending order. Use `prompts/plan/MASTERPLAN.md` as the project plan and follow the active prompt through its handoff.
- Check the current branch and worktree first; preserve unrelated user changes.
- Follow existing Angular and Spring patterns. Keep catalog IDs, API contracts, validation, cancellation, and draft behavior stable unless the prompt calls for a change.
- Prefer the project runtimes in `.tools`; add dependencies only when the task needs them.
- Run focused checks for the change and report the commands and results. Run broader checks when the prompt asks for them.
- The default Playwright map is deterministic. The live OpenFreeMap smoke is opt-in; a successful style response does not prove that map tiles loaded.

## Git

Only stage, commit, or push with the user's explicit authorization. Keep unrelated files out of commits and never force-push unless asked.
