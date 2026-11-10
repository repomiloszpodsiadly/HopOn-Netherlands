# Local development tools

This directory tracks the startup helper and its instructions. Downloaded SDKs,
archives, and generated scaffolds stay local and are ignored by Git.

From the repository root, start the backend with:

```powershell
.\.tools\run-backend.ps1
```

The script downloads Java 27 and Gradle 9.8.2 into `.tools/` when needed, then
runs Spring Boot on port 8080. For Angular, use a supported Node.js range from
`frontend/package.json`, then run `npm ci` and `npm start` in `frontend/`.
