# HopOn API

## Requirements

- Java 27

## Run on Windows PowerShell

```powershell
cd backend
.\gradlew.bat bootRun
```

The API is available at `http://localhost:8080/api/health`. It returns `UP` while
the Spring application is running. The database uses in-memory H2; data resets
when the backend process stops.

## Verify

```powershell
cd backend
.\gradlew.bat clean test bootJar
```
