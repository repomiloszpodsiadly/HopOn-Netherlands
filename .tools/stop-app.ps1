[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
$repoRoot = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $PSScriptRoot 'runtime'
$stateFile = Join-Path $runtime 'app-state.json'
$lockFile = Join-Path $runtime 'launcher.lock'

function Read-HopOnState {
    if (-not (Test-Path -LiteralPath $stateFile)) { return $null }
    $state = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
    if ($state.version -ne 1 -or $state.repository -ne $repoRoot -or
        $state.runId -notmatch '^[a-f0-9]{32}$') {
        throw 'The saved HopOn state does not identify this checkout. No processes were stopped. Use Ctrl+C in the original launcher terminal.'
    }
    return $state
}

function Get-HopOnRecordedProcess {
    param($Record)
    $process = $null
    $matched = $false
    try {
        $processId = 0
        $ticks = 0L
        if (-not [int]::TryParse([string]$Record.processId, [ref]$processId) -or $processId -le 0 -or
            -not [long]::TryParse([string]$Record.startedUtcTicks, [ref]$ticks)) { return $null }
        $process = [Diagnostics.Process]::GetProcessById($processId)
        $null = $process.Handle
        if ($process.StartTime.ToUniversalTime().Ticks -eq $ticks -and -not $process.HasExited) {
            $matched = $true
            return $process
        }
    }
    catch [ArgumentException] { <# The recorded process has already exited. #> }
    finally {
        if ($process -and -not $matched) { $process.Dispose() }
    }
    return $null
}

function Test-HopOnWorkerIdentity {
    param($Process, $Record, [string]$RunId)
    if ($Process.ProcessName -ne 'powershell' -or $Record.name -notin @('Setup', 'Backend', 'Frontend')) { return $false }
    $commandLine = (Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($Process.Id)").CommandLine
    $worker = [regex]::Escape((Join-Path $PSScriptRoot 'run-app.ps1'))
    return $commandLine -match ('(?i)(?:^|\s)-File\s+"?' + $worker + '"?(?=\s|$)') -and
        $commandLine -match ('(?i)(?:^|\s)-Service\s+' + $Record.name + '(?=\s|$)') -and
        $commandLine -match ('(?i)(?:^|\s)-RunId\s+' + [regex]::Escape($RunId) + '(?=\s|$)')
}

$launcher = $null
$cleanupLock = $null
try {
    # State appears immediately after the launcher takes its lock. Allow that short startup race.
    for ($attempt = 0; $attempt -lt 10 -and -not (Test-Path -LiteralPath $stateFile); $attempt++) {
        if (-not (Test-Path -LiteralPath $lockFile)) { break }
        try {
            $probe = [IO.File]::Open($lockFile, 'Open', 'ReadWrite', 'None')
            $probe.Dispose()
            break
        }
        catch { Start-Sleep -Milliseconds 100 }
    }
    $state = Read-HopOnState
    if (-not $state) {
        if (Test-Path -LiteralPath $lockFile) {
            try {
                $probe = [IO.File]::Open($lockFile, 'Open', 'ReadWrite', 'None')
                $probe.Dispose()
            }
            catch { throw 'A launcher is starting but has not published its state yet. Retry stop-app.ps1 shortly; no processes were stopped.' }
        }
        Write-Host 'HopOn is not running through run-app.ps1 in this checkout. Nothing to stop.'
        exit 0
    }
    $runId = $state.runId
    $requestFile = Join-Path $runtime ("stop-$runId.request")
    $launcher = Get-HopOnRecordedProcess $state.launcher
    if ($launcher) {
        # The launcher owns its process trees and can also interrupt setup. Never terminate its host shell.
        $request = [IO.File]::Open($requestFile, 'OpenOrCreate', 'Write', 'ReadWrite')
        $request.Dispose()
        Write-Host 'Stopping HopOn. Stopping the API clears saved H2 plans...'
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while ([DateTime]::UtcNow -lt $deadline) {
            $current = Read-HopOnState
            if (-not $current -or $current.runId -ne $runId) {
                Write-Host 'HopOn stopped.'
                exit 0
            }
            if ($launcher.HasExited) { break }
            Start-Sleep -Milliseconds 200
        }
        if (-not $launcher.HasExited) {
            throw 'The stop request was saved, but the launcher has not finished stopping. Retry stop-app.ps1 or use Ctrl+C in its terminal. No unrelated processes were stopped.'
        }
    }

    # A closed/crashed launcher may leave workers behind. Serialize cleanup against a new launch.
    for ($attempt = 0; $attempt -lt 20 -and -not $cleanupLock; $attempt++) {
        try { $cleanupLock = [IO.File]::Open($lockFile, 'OpenOrCreate', 'ReadWrite', 'None') }
        catch { Start-Sleep -Milliseconds 100 }
    }
    if (-not $cleanupLock) { throw 'A launcher currently owns this checkout. Retry stop-app.ps1; no processes were stopped by this cleanup attempt.' }
    $current = Read-HopOnState
    if (-not $current -or $current.runId -ne $runId) {
        Write-Host 'The previous HopOn run has already stopped.'
        exit 0
    }
    $stoppedCount = 0
    foreach ($record in @($current.workers)) {
        $process = Get-HopOnRecordedProcess $record
        if (-not $process) { continue }
        try {
            if (-not (Test-HopOnWorkerIdentity -Process $process -Record $record -RunId $runId)) {
                Write-Host "Ignoring PID $($process.Id): it is not a worker from this HopOn run."
                continue
            }
            & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F 2>$null | Out-Null
            if (-not $process.WaitForExit(5000)) { throw "HopOn worker PID $($process.Id) did not stop. Retry stop-app.ps1." }
            $stoppedCount++
        }
        finally { $process.Dispose() }
    }
    Remove-Item -LiteralPath $stateFile -Force
    Remove-Item -LiteralPath $requestFile -Force -ErrorAction SilentlyContinue
    if ($stoppedCount -gt 0) { Write-Host 'Stopped the HopOn workers left by the previous launcher. Saved H2 plans are cleared when the API stops.' }
    else { Write-Host 'HopOn is not running. Removed stale launcher state; no processes were stopped.' }
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
finally {
    if ($launcher) { $launcher.Dispose() }
    if ($cleanupLock) { $cleanupLock.Dispose() }
}
