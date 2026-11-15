# HopOn Netherlands

**Discover places. Make the day your own.**

HopOn is a local city guide and sightseeing planner for Amsterdam, Rotterdam and Utrecht. Explore 2,707 places on a shared map, view photos and nearby mobility hubs, and build a personal plan with stops from all three cities.

The application has an Angular frontend, a Spring Boot API and an embedded H2 database. It needs no API key, user account or separate database installation.

[Demo GIF](HopOn-in-action.gif) · [Start](#run-locally) · [Stop](#stop-the-application) · [Checks](#checks) · [Technical approach](#technical-approach)

## Run locally

These instructions use **Windows PowerShell** and work in IntelliJ's Terminal too. All commands below assume you opened the repository root first. IntelliJ is optional.

If you already cloned it, open `HopOn-Netherlands` in IntelliJ and open its Terminal, or open PowerShell in that directory. You should see `backend`, `frontend` and `.tools`.

### Variant A: JDK and Node.js are already configured

Use this variant when **JDK 27** and a supported **Node.js with npm 11.19.0** are available in your terminals. Local verification uses Node.js **24.20.0**; other supported versions are listed in [frontend/package.json](frontend/package.json). The Gradle wrapper is included in the repository.

**1. Start the backend in terminal 1.** From the repository root:

```powershell
cd backend
.\gradlew.bat bootRun
```

Leave this terminal open. Wait until Spring reports that `HopOnApplication` has started. The API is available on **http://127.0.0.1:8080**; [API health](http://127.0.0.1:8080/api/health) should report `UP`.

**2. Open a second terminal at the repository root and start the frontend:**

```powershell
cd frontend
npm.cmd ci
npm.cmd start
```

`npm ci` installs the dependencies from the committed lockfile. Run it after cloning and after dependency changes. On later launches, `cd frontend` and `npm.cmd start` are enough. In IntelliJ, use a new terminal tab and check that it starts at the repository root, not inside `backend/`.

**3. Open http://localhost:4200.** Angular forwards `/api` requests to the backend; no environment file or API key is needed. Keep both terminals open.

### Variant B: prepare missing tools and start with a script

Use this variant if JDK/Node.js are missing or incompatible, or if you want the script to prepare and start everything. Automatic setup supports **Windows x64 with Windows PowerShell**. It needs internet access for downloads and the first dependency installation.

**1. In one terminal at the repository root, run:**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.tools\run-app.ps1
```

**The script downloads missing tools automatically.** The first run may download several hundred megabytes and take several minutes. `ExecutionPolicy Bypass` applies only to this PowerShell process; it does not change the machine's policy.

Here is what happens, in order:

1. **Checks the checkout and ports.** Only one launcher can use a checkout at a time. Ports **8080** and **4200** must be free. An occupied port stops startup; the script leaves existing processes running.
2. **Looks for compatible runtimes.** It checks `JAVA_HOME`, `PATH`, `.tools/` and common JDK locations, including IntelliJ's default `%USERPROFILE%/.jdks`. Existing compatible tools are reused.
3. **Downloads and extracts missing tools into `.tools/`.** Portable ZIP distributions of **Eclipse Temurin JDK 27** and **Node.js 24.20.0 with npm 11.19.0** are verified with SHA-256 checksums, then extracted into `.tools/jdk-27` and `.tools/node-v24.20.0`. Java and Node/npm run directly from those directories. No administrator access or global installation is needed.
4. **Installs frontend dependencies with `npm ci`.** It uses `frontend/package-lock.json`. Later runs reuse unchanged dependencies; package files, the selected Node/npm version or missing Angular CLI files trigger a new installation.
5. **Starts the backend using the Gradle wrapper.** Gradle **9.8.2** and backend dependencies are downloaded to the normal Gradle user cache as needed. The launcher waits for API health on **http://127.0.0.1:8080**.
6. **Starts Angular on http://localhost:4200.** The script prints **HopOn is ready** when both services respond.

**2. Open http://localhost:4200 after the ready message. Keep the launcher terminal open.** Both services run as its child processes. Setup, backend and frontend logs are saved separately under `.tools/runtime/run-*/`. Failures print recent log lines and stop the workers started by that launch.

The script changes `JAVA_HOME` and `PATH` only for itself and its children. It does not configure your other terminals or IntelliJ. Downloads, runtime state and logs are ignored by Git. Later launches use the same command and reuse compatible tools and unchanged dependencies.

**3. Stop this instance using the command below.** You can then reuse the extracted tools in two terminals as shown in [Run manually with the tools in .tools](#run-manually-with-the-tools-in-tools).

## Stop the application

For an application started with `run-app.ps1`, open **another PowerShell terminal at the repository root**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.tools\stop-app.ps1
```

**Stopping the API clears all saved plans in H2.**

## Run manually with the tools in .tools

After Variant B has downloaded and extracted the runtimes, **stop its application instance first**. Then open two new terminal tabs at the **repository root**. Use the local runtimes explicitly:

**Terminal 1 — select the local JDK and start the backend:**

```powershell
$env:JAVA_HOME = (Resolve-Path .\.tools\jdk-27).Path
cd backend
.\gradlew.bat bootRun
```

**Terminal 2 — select the local Node.js/npm and start the frontend:**

```powershell
$env:Path = (Resolve-Path .\.tools\node-v24.20.0).Path + ';' + $env:Path
cd frontend
npm.cmd start
```

Setup already installed the frontend dependencies. After dependency changes, run `npm.cmd ci` before `npm.cmd start` in terminal 2. The environment selections apply only to the current terminal, so repeat them in new tabs. If setup reused an installed runtime instead of downloading it, substitute the path printed by the script.

Wait for both services, then open **http://localhost:4200**. Stop these manually started services with **Ctrl+C in each terminal**. Stop the current instance before switching between scripts, manual commands and IntelliJ's Run button.

If you only want to download tools and install dependencies without starting the app, use this optional preparation command from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.tools\run-app.ps1 -SetupOnly
```

It performs the same automatic setup, prints the runtime paths and exits. Application ports must still be free because setup may reinstall frontend dependencies.

To try the app on a phone connected to the same trusted Wi-Fi, use the two-terminal setup with `npm.cmd run start:lan` in place of `npm.cmd start` and open `http://<PC-LAN-IP>:4200`. The API stays on loopback; the frontend proxy forwards requests. Allow the frontend through the Windows Private-network firewall if prompted.

## Using HopOn and keeping plans

Search and filter architecture, museums, culture, parks and nature, or landmarks. Select a card or map marker for details, photo credits and curated nearby hubs. The catalog, map and plan controls are available across desktop, tablet and mobile layouts.

For a short first journey:

1. Search for **Royal Palace**, open the place and add it to your plan.
2. Search for **Erasmus Bridge** and add it too. A plan can combine cities.
3. Open **Review current plan**, edit its name or description and reorder stops, then choose **Save changes**.
4. Open **Saved plans** and choose **Use this plan** to continue adding places.

The API allows **6 saved plans**, each with **0–12 places**, a **30-character name** and an optional **500-character description**. A plan's starting city does not restrict the cities of its stops. Duplicate names receive the first available numbered suffix, such as `My day out-1`.

Adding places automatically saves the current plan. Name, description, removal and ordering edits in the saved-plan editor use **Save changes**. Plans belong to the running API instance and survive browser refresh. They disappear when that API stops. Drafts and the current-plan selection use tab-scoped `sessionStorage`; a failed autosave keeps the draft available for retry.

## Checks

Use the same Java and Node.js versions as application startup. The examples below select the downloaded tools from `.tools/`; substitute installed paths if setup reused existing runtimes.

### Backend

Stop the API before `clean` (this clears saved plans). From the repository root:

```powershell
$env:JAVA_HOME = (Resolve-Path .\.tools\jdk-27).Path
cd backend
.\gradlew.bat clean test bootJar
```

### Frontend

With dependencies installed, from the repository root:

```powershell
$env:Path = (Resolve-Path .\.tools\node-v24.20.0).Path + ';' + $env:Path
cd frontend
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

### Browser workflows

Start the API in a separate terminal with the backend commands above. In another terminal at the repository root (substitute your installed Node.js path if needed):

```powershell
$env:Path = (Resolve-Path .\.tools\node-v24.20.0).Path + ';' + $env:Path
cd frontend
npx playwright install chromium
npm.cmd run test:e2e
```

Playwright starts its own frontend on **port 4300**, uses the real API/H2 and runs one worker. Tests clean up only their own plans; use a development session with free plan slots for capacity scenarios. Map styles and failures use deterministic fixtures without live OpenFreeMap dependencies. The suite does not verify live tile delivery. See [the E2E guide](frontend/e2e/README.md).

## Technical approach

| Area | Implementation |
| --- | --- |
| Frontend | Angular 22, TypeScript 6, standalone components, signals and RxJS |
| UI and map | Tailwind CSS 4, MapLibre GL JS 6 and OpenFreeMap |
| API | Java 27, Spring Boot 4.1.2, Bean Validation and Spring Data JPA |
| Storage | In-memory H2 for saved plans; tab-scoped browser drafts |
| Verification | Gradle wrapper, JUnit/Spring tests, ESLint, Vitest and Playwright |

Catalog cities, places and mobility hubs are loaded from checked-in JSON without catalog validation at startup. Cities load independently so partial failures retain usable results. Autosave uses a persisted UUID and idempotent `PUT /api/plans/{id}/autosave`; synchronized creation protects plan capacity and numbered names. Controllers map HTTP contracts, application services own validation/transactions and repositories preserve place order and timestamps.

Nearby hubs use approximate straight-line distances. The application does not provide AI recommendations, live transit schedules, route optimization or turn-by-turn directions. Catalog search and planning remain usable when map loading fails.

| Path | Contents |
| --- | --- |
| `frontend/src/app/core/` | API clients, shared types and tab state |
| `frontend/src/app/features/` | Explore, map, plans and shared UI |
| `frontend/e2e/` | Browser scenarios and deterministic fixtures |
| `backend/src/main/java/com/hopon/` | Catalog, health, transit and plan packages |
| `backend/src/main/resources/catalog/` | City, place and mobility-hub JSON snapshots |
| `.tools/` | Start/stop scripts and ignored local runtimes/logs |

## Data, attribution and license

The OpenStreetMap catalog contains **2,707 places and 18 curated mobility hubs**. The [provenance manifest](backend/src/main/resources/catalog/provenance.json) records sources, selection rules and the ODbL 1.0 license. The application loads `cities.json`, `places.json` and `stops.json` directly; the manifest is reference metadata. Adding or removing cities, places or hubs does not require matching fixed counts, city lists, coverage, bounds or ordering rules.

Map resources use OpenFreeMap with OpenMapTiles and OpenStreetMap attribution. They need internet access; the fallback is not an offline map. Featured photos retain sources, authors, licenses and change notices in the [photo attribution manifest](frontend/public/assets/catalog/assets-attribution.json).

Application code is available under the [MIT license](LICENSE). Catalog data and third-party photos retain their respective licenses.
