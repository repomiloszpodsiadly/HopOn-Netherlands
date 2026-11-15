[CmdletBinding()]
param(
    [switch]$SetupOnly,
    # Internal worker mode: tools and dependencies have already been prepared.
    [ValidateSet('Setup', 'Backend', 'Frontend')][string]$Service,
    [string]$RunDirectory,
    [string]$RunId
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repoRoot = Split-Path -Parent $PSScriptRoot

# Check and prepare local tools before starting either service.
$hopOnRoot = Split-Path -Parent $PSScriptRoot
$hopOnTools = $PSScriptRoot
$hopOnPackage = Get-Content -Raw -LiteralPath (Join-Path $hopOnRoot 'frontend/package.json') | ConvertFrom-Json
$hopOnNodeVersion = '24.20.0'
$hopOnNpmVersion = $hopOnPackage.packageManager -replace '^npm@', ''

function Test-HopOnJavaHome {
    param([string]$Directory)
    if ([string]::IsNullOrWhiteSpace($Directory)) { return $false }
    foreach ($file in @('bin/java.exe', 'bin/javac.exe', 'release')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Directory $file) -PathType Leaf)) { return $false }
    }
    if ((Get-Content -Raw -LiteralPath (Join-Path $Directory 'release')) -notmatch 'JAVA_VERSION="27(?:[.+-]|")') {
        return $false
    }
    try {
        $version = & (Join-Path $Directory 'bin/javac.exe') --version 2>$null
        return $LASTEXITCODE -eq 0 -and "$version" -match '^javac 27(?:[.+-]|$)'
    }
    catch { return $false }
}

function Test-HopOnNodeVersion {
    param([string]$Version)
    if ($Version -notmatch '^v?(\d+\.\d+\.\d+)$') { return $false }
    $actual = [version]$Matches[1]
    foreach ($range in ($hopOnPackage.engines.node -split '\s*\|\|\s*')) {
        if ($range -notmatch '^\^(\d+\.\d+\.\d+)$') {
            throw "Update the launcher to handle this Node.js engine range: $range"
        }
        $minimum = [version]$Matches[1]
        if ($actual.Major -eq $minimum.Major -and $actual -ge $minimum) { return $true }
    }
    return $false
}

function Test-HopOnNodeHome {
    param([string]$Directory)
    if ([string]::IsNullOrWhiteSpace($Directory)) { return $false }
    $node = Join-Path $Directory 'node.exe'
    $npm = Join-Path $Directory 'node_modules/npm/bin/npm-cli.js'
    if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or
        -not (Test-Path -LiteralPath $npm -PathType Leaf)) { return $false }
    try {
        $version = & $node --version 2>$null
        if ($LASTEXITCODE -ne 0 -or -not (Test-HopOnNodeVersion "$version")) { return $false }
        $npmVersion = & $node $npm --version 2>$null
        return $LASTEXITCODE -eq 0 -and "$npmVersion" -eq $hopOnNpmVersion
    }
    catch { return $false }
}

function Find-HopOnJava {
    $candidates = @($env:JAVA_HOME, (Join-Path $hopOnTools 'jdk-27'))
    $command = Get-Command java.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { $candidates += Split-Path -Parent (Split-Path -Parent $command.Source) }
    # IntelliJ's downloaded SDKs and common Windows JDK installations.
    foreach ($directory in @(
        (Join-Path $env:USERPROFILE '.jdks'),
        (Join-Path $env:ProgramFiles 'Eclipse Adoptium'),
        (Join-Path $env:ProgramFiles 'Java'),
        (Join-Path $env:ProgramFiles 'Microsoft')
    )) {
        $candidates += @(Get-ChildItem -LiteralPath $directory -Directory -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty FullName)
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-HopOnJavaHome $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
    }
}

function Find-HopOnNode {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    $candidates = @((Join-Path $hopOnTools "node-v$hopOnNodeVersion"))
    if ($command) { $candidates = @((Split-Path -Parent $command.Source)) + $candidates }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-HopOnNodeHome $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
    }
}

function Install-HopOnArchive {
    param([string]$Url, [string]$Checksum, [string]$Destination, [scriptblock]$Validate)
    if ($Checksum -notmatch '^[a-fA-F0-9]{64}$' -or -not $Url.StartsWith('https://')) {
        throw 'The download source did not provide an HTTPS archive and SHA-256 checksum.'
    }
    if (Test-Path -LiteralPath $Destination) {
        throw "Invalid local tool cache: $Destination. Rename it or configure a valid installed tool before retrying."
    }
    $runtime = [IO.Path]::GetFullPath($hopOnBootstrapRoot)
    $staging = Join-Path $runtime ('bootstrap-' + [guid]::NewGuid().ToString('N'))
    $archive = Join-Path $staging 'download.zip'
    $extracted = Join-Path $staging 'extracted'
    New-Item -ItemType Directory -Path $extracted -Force | Out-Null
    try {
        Write-Host "Downloading $Url"
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $archive -TimeoutSec 1200
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $Checksum) {
            throw 'Archive checksum verification failed. The downloaded tool was not installed.'
        }
        Expand-Archive -LiteralPath $archive -DestinationPath $extracted
        $homes = @(Get-ChildItem -LiteralPath $extracted -Directory | Where-Object { & $Validate $_.FullName })
        if ($homes.Count -ne 1) { throw 'The archive did not contain exactly one compatible tool installation.' }
        $source = [IO.Path]::GetFullPath($homes[0].FullName)
        $target = [IO.Path]::GetFullPath($Destination)
        if (-not $source.StartsWith($extracted + '\', [StringComparison]::OrdinalIgnoreCase) -or
            (Split-Path -Parent $target) -ne [IO.Path]::GetFullPath($hopOnTools)) {
            throw 'Tool installation paths are outside the expected project directories.'
        }
        Move-Item -LiteralPath $source -Destination $target
        return $target
    }
    finally {
        $resolved = [IO.Path]::GetFullPath($staging)
        if ($resolved.StartsWith($runtime + '\', [StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolved) -match '^bootstrap-[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Initialize-HopOnEnvironment {
    $javaHome = Find-HopOnJava
    $nodeHome = Find-HopOnNode
    $missing = @()
    if (-not $javaHome) { $missing += '- JDK 27 (Eclipse Temurin, Windows x64)' }
    if (-not $nodeHome) {
        $missing += "- Node.js $hopOnNodeVersion with npm $hopOnNpmVersion (Windows x64)"
    }
    if ($missing.Count -gt 0) {
        $architecture = $env:PROCESSOR_ARCHITECTURE
        if ($env:PROCESSOR_ARCHITEW6432) { $architecture = $env:PROCESSOR_ARCHITEW6432 }
        if ($architecture -ne 'AMD64') { throw 'Automatic tool downloads support Windows x64. Configure compatible tools manually on this architecture.' }
        Write-Host ('Downloading missing tools automatically: ' + ($missing -join ', '))
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        if (-not $javaHome) {
            $assets = @(Invoke-RestMethod -Uri 'https://api.adoptium.net/v3/assets/latest/27/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse' -TimeoutSec 60)
            $package = $assets[0].binary.package
            $javaHome = Install-HopOnArchive -Url $package.link -Checksum $package.checksum `
                -Destination (Join-Path $hopOnTools 'jdk-27') -Validate { param($homePath) Test-HopOnJavaHome $homePath }
        }
        if (-not $nodeHome) {
            $filename = "node-v$hopOnNodeVersion-win-x64.zip"
            $baseUrl = "https://nodejs.org/dist/v$hopOnNodeVersion"
            $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt" -TimeoutSec 60).Content
            $pattern = '(?m)^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($filename) + '\r?$'
            if ($sums -notmatch $pattern) { throw "No SHA-256 checksum found for $filename." }
            $nodeHome = Install-HopOnArchive -Url "$baseUrl/$filename" -Checksum $Matches[1] `
                -Destination (Join-Path $hopOnTools "node-v$hopOnNodeVersion") -Validate { param($homePath) Test-HopOnNodeHome $homePath }
        }
    }
    $env:JAVA_HOME = $javaHome
    $env:Path = (Join-Path $javaHome 'bin') + ';' + $env:Path
    Write-Host "JDK: $javaHome"
    $env:Path = $nodeHome + ';' + $env:Path
    Write-Host "Node.js/npm: $nodeHome"
    return $nodeHome
}

function Install-HopOnFrontendDependencies {
    param([string]$NodeHome)
    $frontend = Join-Path $hopOnRoot 'frontend'
    $stamp = Join-Path $frontend 'node_modules/.hopon-install'
    $node = Join-Path $NodeHome 'node.exe'
    $npm = Join-Path $NodeHome 'node_modules/npm/bin/npm-cli.js'
    $fingerprint = (@(
        (Get-FileHash -LiteralPath (Join-Path $frontend 'package.json') -Algorithm SHA256).Hash,
        (Get-FileHash -LiteralPath (Join-Path $frontend 'package-lock.json') -Algorithm SHA256).Hash,
        (& $node --version), $hopOnNpmVersion
    ) -join ':')
    if ((Test-Path -LiteralPath $stamp) -and
        (Test-Path -LiteralPath (Join-Path $frontend 'node_modules/@angular/cli/bin/ng.js')) -and
        (Get-Content -Raw -LiteralPath $stamp).Trim() -eq $fingerprint) {
        Write-Host 'Frontend dependencies are up to date.'
        return
    }
    # Never retain a successful stamp when npm ci fails or is interrupted.
    if (Test-Path -LiteralPath $stamp) { Remove-Item -LiteralPath $stamp -Force }
    Write-Host 'Installing frontend dependencies from package-lock.json (npm ci)...'
    Push-Location $frontend
    try {
        & $node $npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE). Check the output above and retry." }
        Set-Content -LiteralPath $stamp -Value $fingerprint -Encoding Ascii
    }
    finally { Pop-Location }
}

function Assert-HopOnPortsAvailable {
    foreach ($port in @(8080, 4200)) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::IPv6Any, $port)
        try {
            $listener.Server.DualMode = $true
            $listener.Server.ExclusiveAddressUse = $true
            $listener.Start()
        }
        catch { throw "Port $port is already in use. Stop the existing service yourself before launching HopOn. Existing processes and plans were left untouched." }
        finally { $listener.Stop() }
    }
}

function Start-HopOnService {
    param([string]$Name, [string]$LogDirectory)
    $worker = Join-Path $hopOnTools 'run-app.ps1'
    $stdout = Join-Path $LogDirectory "$Name.stdout.log"
    $stderr = Join-Path $LogDirectory "$Name.stderr.log"
    $process = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $worker + '"'), '-Service', $Name,
            '-RunDirectory', ('"' + $LogDirectory + '"'), '-RunId', $hopOnRunId) `
        -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    # Retain the OS handle so Windows PowerShell can read ExitCode after a fast failure.
    $null = $process.Handle
    Add-Member -InputObject $process -NotePropertyName ServiceName -NotePropertyValue $Name
    return $process
}

function Assert-HopOnServicesRunning {
    param([object[]]$Processes)
    foreach ($process in $Processes) {
        if ($process.HasExited) { throw "A HopOn service exited (PID $($process.Id), exit $($process.ExitCode)). See the logs below." }
    }
}

function Wait-HopOnUrl {
    param([string]$Url, [object[]]$Processes, [switch]$Health)
    $deadline = [DateTime]::UtcNow.AddMinutes(10)
    while ([DateTime]::UtcNow -lt $deadline) {
        Assert-HopOnContinue
        Assert-HopOnServicesRunning $Processes
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                if (-not $Health) { return }
                $body = $response.Content | ConvertFrom-Json
                if ($body.status -eq 'UP' -and $body.service -eq 'hopon-api') { return }
            }
        }
        catch { <# A refused connection is normal while the service starts. #> }
        Start-Sleep -Seconds 1
    }
    throw "Timed out waiting for $Url. Check the startup logs."
}

function Assert-HopOnContinue {
    if (Test-Path -LiteralPath $stopRequestFile) {
        throw [OperationCanceledException]::new('HopOn stop requested.')
    }
}

function Save-HopOnState {
    $state = [ordered]@{
        version = 1
        repository = $repoRoot
        runId = $hopOnRunId
        launcher = @{ processId = $PID; startedUtcTicks = $launcherStartedUtcTicks }
        workers = @($processes | ForEach-Object {
            @{ processId = $_.Id; startedUtcTicks = $_.StartTime.ToUniversalTime().Ticks.ToString(); name = $_.ServiceName }
        })
    }
    $temporaryState = $stateFile + '.' + $hopOnRunId + '.tmp'
    try {
        [IO.File]::WriteAllText($temporaryState, ($state | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $stateFile) {
            [IO.File]::Replace($temporaryState, $stateFile, [System.Management.Automation.Language.NullString]::Value)
        }
        else { [IO.File]::Move($temporaryState, $stateFile) }
    }
    finally {
        if (Test-Path -LiteralPath $temporaryState) { Remove-Item -LiteralPath $temporaryState -Force }
    }
}

function Stop-HopOnOwnedProcesses {
    $stopped = $true
    foreach ($process in $processes) {
        try {
            if (-not $process.HasExited) {
                & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F 2>$null | Out-Null
                if (-not $process.WaitForExit(5000)) { $stopped = $false }
            }
        }
        catch {
            if (-not $process.HasExited) {
                $stopped = $false
                Write-Host "Could not stop HopOn worker PID $($process.Id). Run stop-app.ps1 to retry." -ForegroundColor Red
            }
        }
    }
    return $stopped
}

if ($Service) {
    try {
        if ($Service -eq 'Setup') {
            $hopOnBootstrapRoot = Join-Path $RunDirectory 'bootstrap'
            $nodeHome = Initialize-HopOnEnvironment
            Install-HopOnFrontendDependencies $nodeHome
            exit 0
        }
        if ($Service -eq 'Backend') {
            Set-Location (Join-Path $repoRoot 'backend')
            & .\gradlew.bat --no-daemon --console=plain bootRun
        }
        else {
            Set-Location (Join-Path $repoRoot 'frontend')
            & npm.cmd start
        }
        exit $LASTEXITCODE
    }
    catch { Write-Error $_ -ErrorAction Continue; exit 1 }
}

$processes = @()
$lock = $null
$logs = $null
$stateWritten = $false
$runtime = Join-Path $PSScriptRoot 'runtime'
$stateFile = Join-Path $runtime 'app-state.json'
$hopOnRunId = [guid]::NewGuid().ToString('N')
$stopRequestFile = Join-Path $runtime ("stop-" + $hopOnRunId + '.request')
$launcherStartedUtcTicks = [Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString()
try {
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    try {
        $lock = [IO.File]::Open((Join-Path $runtime 'launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    }
    catch { throw 'Another HopOn launcher is using this checkout. Use stop-app.ps1 before starting it again.' }
    if (Test-Path -LiteralPath $stateFile) {
        throw 'Previous HopOn launcher state is still present. Run stop-app.ps1 before starting again so recorded workers can be checked and cleaned up.'
    }
    Save-HopOnState
    $stateWritten = $true
    Assert-HopOnContinue
    Assert-HopOnPortsAvailable
    $logs = Join-Path $runtime ('run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $hopOnRunId)
    New-Item -ItemType Directory -Path $logs | Out-Null
    Write-Host "Logs: $logs"
    Write-Host 'Preparing JDK, Node.js/npm and dependencies. Missing tools are downloaded automatically; first setup can take several minutes.'
    $processes += Start-HopOnService -Name Setup -LogDirectory $logs
    Save-HopOnState
    while (-not $processes[0].HasExited) {
        Assert-HopOnContinue
        Start-Sleep -Milliseconds 200
    }
    Assert-HopOnContinue
    if ($processes[0].ExitCode -ne 0) { throw "Tool/dependency setup failed (exit $($processes[0].ExitCode))." }
    $processes[0].Dispose()
    $processes = @()
    Save-HopOnState
    # Setup ran in an interruptible worker; select its now-available runtimes for the services.
    $hopOnBootstrapRoot = Join-Path $logs 'bootstrap'
    $nodeHome = Initialize-HopOnEnvironment
    Assert-HopOnContinue
    if ($SetupOnly) {
        Write-Host 'Setup complete. The paths above can also be selected in IntelliJ. No application services were started.'
        exit 0
    }
    Write-Host 'Starting the API on http://127.0.0.1:8080...'
    $processes += Start-HopOnService -Name Backend -LogDirectory $logs
    Save-HopOnState
    Wait-HopOnUrl -Url 'http://127.0.0.1:8080/api/health' -Processes $processes -Health
    Write-Host 'Starting the frontend on http://localhost:4200...'
    $processes += Start-HopOnService -Name Frontend -LogDirectory $logs
    Save-HopOnState
    Wait-HopOnUrl -Url 'http://localhost:4200' -Processes $processes
    Write-Host "`nHopOn is ready: http://localhost:4200" -ForegroundColor Green
    Write-Host 'Keep this terminal open. Use Ctrl+C here or stop-app.ps1 in another terminal to stop both services.'
    Write-Host 'Stopping the API clears saved H2 plans.'
    while ($true) {
        Assert-HopOnContinue
        Assert-HopOnServicesRunning $processes
        Start-Sleep -Milliseconds 200
    }
}
catch [OperationCanceledException] {
    Write-Host 'Stopping HopOn...'
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($logs) {
        foreach ($file in (Get-ChildItem -LiteralPath $logs -Filter '*.log')) {
            Write-Host "--- $($file.Name) ---"
            Get-Content -LiteralPath $file.FullName -Tail 20
        }
    }
    exit 1
}
finally {
    $allStopped = Stop-HopOnOwnedProcesses
    foreach ($process in $processes) { $process.Dispose() }
    if ($logs) {
        $bootstrap = [IO.Path]::GetFullPath((Join-Path $logs 'bootstrap'))
        $expectedParent = [IO.Path]::GetFullPath($logs)
        if ((Split-Path -Parent $bootstrap) -eq $expectedParent -and
            $expectedParent.StartsWith([IO.Path]::GetFullPath($runtime) + '\', [StringComparison]::OrdinalIgnoreCase) -and
            (Test-Path -LiteralPath $bootstrap)) {
            Remove-Item -LiteralPath $bootstrap -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    if ($stateWritten -and $allStopped) {
        Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $stopRequestFile -Force -ErrorAction SilentlyContinue
    }
    if ($lock) { $lock.Dispose() }
}
