# HopOn Netherlands

**Discover places. Make the day your own.**

HopOn is a city guide and personal sightseeing planner for Amsterdam, Rotterdam and Utrecht. Browse places on a shared map, find something that interests you, and build a plan that can take you across all three cities.

The project pairs an Angular frontend with a Spring Boot REST API and an embedded H2 database. It runs locally without API keys or a separate database installation.

[Run locally](#run-locally) · [Technical approach](#technical-approach) · [Checks](#checks)

## What you can do

- **Explore three cities together.** Search 2,707 catalog places and filter by architecture, museums, culture, parks and nature, or landmarks.
- **Look closer.** Select a card or map marker to see place details, featured photos with credits, and nearby curated mobility hubs where available.
- **Make a personal plan.** Create, open, rename and delete plans; add notes, reorder stops, and combine places from different cities.
- **Keep building as you explore.** Adding places saves the current plan automatically. Use **Review current plan** to return to it, or **Use this plan** to select another saved plan for map additions.
- **Discover by vibe.** Architecture Hunt, Culture Day and Green Escape offer themed picks in tablet and mobile layouts. The desktop layout prioritizes the shared map and catalog.

The interface includes responsive layouts, keyboard navigation, visible focus states and confirmation before deleting a plan or leaving unsaved edits.

## Run locally

The instructions below use **Windows PowerShell**, the environment used to verify the project.

### 1. Prepare your tools

- Git.
- **Node.js 24.20.0 and npm 11.19.0**, the versions used for local verification. Other supported Node versions are declared in [frontend/package.json](frontend/package.json).
- **JDK 27**. The backend helper can download and cache it if a compatible `JAVA_HOME` or local JDK is not already available.

The committed Gradle wrapper supplies Gradle 9.8.2. The first installation needs internet access to download dependencies; the map also loads external resources during use.

### 2. Clone the repository

```powershell
git clone https://github.com/repomiloszpodsiadly/HopOn-Netherlands.git
cd HopOn-Netherlands
```

### 3. Start the API — terminal 1

From the repository root:

```powershell
.\.tools\run-backend.ps1
```

The helper selects Java 27, uses the Gradle wrapper and starts Spring Boot. Keep this terminal open. The API listens on **http://127.0.0.1:8080**.

Open [the health endpoint](http://127.0.0.1:8080/api/health) to check that startup has finished. Its response is:

```json
{"status":"UP","service":"hopon-api"}
```

If JDK 27 is already configured in your terminal, you can also start the API directly:

```powershell
cd backend
.\gradlew.bat bootRun
```

### 4. Start the frontend — terminal 2

Open another PowerShell terminal at the repository root:

```powershell
cd frontend
npm.cmd ci
npm.cmd start
```

Open **http://localhost:4200**. The Angular development server forwards `/api` requests to the backend on port 8080; no environment file is needed.

### 5. Try a short journey

1. Search for **Royal Palace**, open its card and add it to your plan.
2. Search for **Erasmus Bridge** and add that too. Both cities can belong to the same plan.
3. Open **Review current plan**, give the plan a name, add a description or change the stop order, then choose **Save changes**.
4. Open **Saved plans**. Select **Use this plan** to continue adding places, or delete a plan through its confirmation dialog.

To try the mobile layout on a phone connected to the same trusted Wi-Fi, replace `npm.cmd start` with `npm.cmd run start:lan` and open `http://<PC-LAN-IP>:4200`. The API remains on loopback; the frontend proxy handles its requests. Allow the frontend through the Windows Private-network firewall if prompted.

## Plans and storage

You can save **up to 6 plans**, each containing **0–12 places**. A name can have **30 characters**, and an optional description can have **500**. The starting city is a reference for the plan; it does not restrict which cities its places come from.

Adding the first place from Explore or Discover creates a saved plan. Later additions update that same plan. If a name is already taken, creation uses the first available numbered suffix, such as `My day out-1`. At capacity, existing plans remain editable; creating another requires freeing a slot.

**Saved plans live in in-memory H2. They survive browser refresh but are cleared when the API stops.** Unsaved drafts and the current-plan selection use the browser tab's `sessionStorage`. A failed automatic save keeps the draft available for retry. Changes to a saved plan's name, description, order or removed stops use **Save changes**.

## Technical approach

| Area | Implementation |
| --- | --- |
| Frontend | Angular 22, TypeScript 6, standalone components, signals and RxJS |
| UI and map | Tailwind CSS 4, component CSS, MapLibre GL JS 6 and OpenFreeMap |
| API | Java 27, Spring Boot 4.1.2, Bean Validation and Spring Data JPA |
| Storage | Embedded H2 in memory; tab-scoped browser drafts |
| Build and tests | Gradle wrapper, Angular CLI, JUnit/Spring integration tests, Vitest and Playwright |

A few implementation choices are worth highlighting:

- **A reproducible catalog.** Places and mobility hubs come from checked-in JSON. The backend validates catalog consistency and provenance at startup, so ordinary catalog use does not depend on a live data import.
- **Independent city loading.** Explore shows successful city results while another city is loading or has failed. Request cancellation and stale-response guards protect the current selection and Discover results.
- **Retry-safe automatic saving.** Autosave reuses a tab-persisted UUID through `PUT /api/plans/{id}/autosave`. Retrying an uncertain request updates the same plan instead of creating another one. Creation is synchronized through transaction commit to protect capacity and numbered-name allocation.
- **A small API boundary.** Controllers map HTTP DTOs to application commands and results; the plan service owns validation and transactions. Persistence preserves the exact order of selected places.
- **Explainable discovery.** Discover scores catalog categories and tags, with stable ordering for ties. The same input produces the same picks; it does not call a language model.
- **Graceful map failure.** Place search, the catalog and planning remain usable when map resources are unavailable. The map has an explicit startup-failure fallback and reconnect action.

```text
backend/src/main/java/com/hopon/    REST endpoints, catalog and plan use cases
backend/src/main/resources/        H2 configuration and catalog snapshots
frontend/src/app/                  Angular pages, shared UI and services
frontend/public/assets/            Brand assets, featured photos and credits
frontend/e2e/                      Explore, map, plan and resilience scenarios
.tools/run-backend.ps1             Windows JDK selection and API startup
AGENTS.md                          Instructions used by coding agents
```

## Checks

### Backend

Stop the API before running `clean`; stopping it clears saved H2 plans. Use a terminal with JDK 27 selected. If the startup helper downloaded the JDK, select its cache from the repository root first:

```powershell
# Only needed when using the helper's downloaded JDK:
$env:JAVA_HOME = (Resolve-Path .\.tools\jdk-27).Path
```

Then, from the repository root:

```powershell
cd backend
.\gradlew.bat clean test bootJar
```

### Frontend

With frontend dependencies installed, run from the repository root:

```powershell
cd frontend
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

### Browser workflows

Start the API on port 8080 in a separate terminal. Use a fresh development session: E2E tests create and remove their own plans, and the capacity scenarios need available plan slots. From `frontend/`:

```powershell
npx playwright install chromium
npm.cmd run test:e2e
```

Playwright starts its own frontend on **port 4300** and uses the real API and H2 database. Scenarios run with one worker to keep shared database tests isolated from each other. Coverage includes CRUD, automatic saving, cross-city plans, limits, navigation guards, keyboard use, responsive layouts and failure recovery.

The default suite uses a deterministic map style. The external OpenFreeMap smoke is opt-in; see [the E2E guide](frontend/e2e/README.md). A successful style response or a ready canvas does not, by itself, prove that live map tiles rendered.

## Troubleshooting

| What happens | What to check |
| --- | --- |
| The UI cannot reach the API | Check [API health](http://127.0.0.1:8080/api/health) and keep the backend terminal running. |
| A port is already in use | Check whether HopOn is already running before starting another instance. Use 4200 for development, 8080 for the API and 4300 for E2E. |
| The map is missing or incomplete | Check internet access and WebGL support. Use **Retry map** when the fallback is shown; an isolated tile failure can leave a gap without that control. |
| `npm ci` reports a locked native module on Windows | Stop the Angular development server before reinstalling dependencies. |
| Playwright cannot find its browser | Run `npx playwright install chromium` from `frontend/`. |

## Data, attribution and license

The catalog is an OpenStreetMap snapshot, with **2,707 places and 18 curated mobility hubs**. Its [provenance manifest](backend/src/main/resources/catalog/provenance.json) records sources, selection rules and the ODbL 1.0 license. Nearby-hub distances are approximate straight-line distances; the app does not provide live timetables or turn-by-turn routing.

Map resources are supplied by OpenFreeMap with OpenMapTiles and OpenStreetMap attribution. They require internet access; the fallback is not an offline map. Featured photos retain their individual sources, authors, licenses and change notices in the [photo attribution manifest](frontend/public/assets/catalog/assets-attribution.json).

Application code is available under the [MIT license](LICENSE). Catalog data and third-party photos retain their respective licenses.
