# Local development tools

This directory tracks the startup helper and its instructions. Keep downloaded
JDKs, Node runtimes, archives, and generated scaffolds local and ignored by Git.

From the repository root, start the backend with:

```powershell
.\.tools\run-backend.ps1
```

The script prefers a verified Java 27 in `JAVA_HOME` or `.tools/jdk-27`. If
neither is available, it downloads Java to a temporary folder, validates it, and
caches it locally. It runs the committed `backend/gradlew.bat` wrapper, pinned to
Gradle 9.8.2. For Angular, use a supported Node.js range from
`frontend/package.json`, then run `npm ci` and `npm start` in `frontend/`.
