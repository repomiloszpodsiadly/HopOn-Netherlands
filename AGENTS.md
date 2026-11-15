# HopOn Netherlands

HopOn is a local city guide and sightseeing planner for Amsterdam, Rotterdam and Utrecht. Users explore a shared place catalog and map, then create personal plans with stops from any of the three cities. See [README.md](README.md) for setup, user flows and technical background.

## Stack and runtime

- Frontend: Angular 22, strict TypeScript, standalone components, signals, RxJS, Tailwind CSS and MapLibre GL JS.
- Backend: Java 27, Spring Boot 4.1.2, Spring Data JPA and embedded H2. Use the committed Gradle wrapper.
- Node.js and npm requirements are declared in `frontend/package.json`; local verification uses Node 24.20.0 and npm 11.19.0.
- Development frontend: port **4200**. API: loopback port **8080**. Playwright frontend: port **4300**. Angular proxies `/api` to Spring.

## Repository layout

| Path | Contents |
| --- | --- |
| `frontend/src/app/core/` | API clients, shared types and browser-tab state services |
| `frontend/src/app/features/explore/` | Catalog, map, place details and Discover |
| `frontend/src/app/features/plans/` | Plan creation, saved-plan list and editing |
| `frontend/src/app/features/shared/` | Navigation, dialogs and shared UI |
| `frontend/e2e/` | Playwright scenarios and deterministic map fixtures |
| `backend/src/main/java/com/hopon/` | Catalog, Discover, health, transit and plan packages |
| `backend/src/main/resources/catalog/` | City, place and mobility-hub snapshots with provenance |
| `backend/src/test/` | Backend unit and integration tests |
| `frontend/public/assets/` | Application imagery and photo attribution |
| `.tools/run-backend.ps1` | Windows JDK selection and API startup |

Plan backend code is organized into `plans/api` for HTTP contracts, `plans/application` for use cases, and `plans/persistence` for JPA entities and repositories.

## Domain and state

- Supported city IDs are `amsterdam`, `rotterdam` and `utrecht`. Explore loads them together. A plan's `cityId` is its starting/reference city; its ordered places may come from all three cities.
- The backend allows **6 saved plans**, each with **0–12 places**, a **30-character name** and an optional **500-character description**. Duplicate names receive the first available numbered suffix on creation.
- Saved plans belong to the running API instance, with no user accounts. H2 is in memory: browser refresh keeps plans, but stopping the backend clears them.
- Drafts and the current-plan ID use tab-scoped `sessionStorage`. H2 is the source of saved-plan content.
- Adding places automatically saves the current plan. Autosave reuses a persisted UUID and the idempotent `PUT /api/plans/{id}/autosave` endpoint. Name, description, removal and ordering edits in the saved-plan editor use **Save changes**.
- Discover ranks catalog categories and tags deterministically. Nearby hubs use approximate straight-line distances. Neither feature provides AI recommendations, live transit schedules or route optimization.

## Code conventions

- Keep UI copy and documentation in English. Angular components are standalone, use `OnPush` change detection and obtain dependencies with `inject()`. Spring services and controllers use constructor injection.
- Use signals and computed values for view state, and RxJS for asynchronous requests. Keep subscriptions tied to the component lifecycle, cancel superseded requests, and retain usable results during partial city failures.
- Keep HTTP mapping at controller boundaries, business validation and transactions in application services, and database access in repositories. Plan creation is synchronized through transaction commit; place order and timestamps are observable API behavior.
- Place frontend unit tests beside their implementation as `*.spec.ts`. Preserve keyboard focus, accessible labels, touch targets and responsive layouts when changing UI components.
- Catalog IDs are stable identifiers, not display names. Validate catalog/provenance consistency and retain map and photo attribution. Catalog and plan workflows must remain usable without a working map.
- Before removing a symbol, check imports, Angular template bindings, API callers and tests. Use existing dependencies and avoid unrelated formatting.

## Verification

Run checks appropriate to the change; commands and prerequisites are documented in [README.md](README.md).

- Backend: `cd backend`, then `.\gradlew.bat test`; the full build gate is `.\gradlew.bat clean test bootJar`.
- Frontend: from `frontend/`, run `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run test` and `npm.cmd run build`.
- Browser: with the API running on 8080, use `npm.cmd run test:e2e` from `frontend/`. Playwright starts its own frontend and runs one worker against the real API/H2. Tests track and clean up only their own plans.
- The normal E2E map style is deterministic. The external OpenFreeMap smoke is opt-in; see [the E2E guide](frontend/e2e/README.md). Style readiness alone does not verify live tile delivery.
- Keep assertions tied to agreed behavior. Update obsolete fixtures or expectations without dropping scenarios or hiding failures. Report which checks actually ran and any remaining limitations.

## Repository hygiene

Inspect the working tree before editing and preserve unrelated user changes. Do not restart the API or clear browser storage without accounting for existing plans and drafts. Keep local runtimes, logs, generated output and credentials out of commits. Stage, commit, push and change repository visibility only with the user's explicit authorization.
