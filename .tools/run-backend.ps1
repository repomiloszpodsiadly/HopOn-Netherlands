$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $repoRoot 'backend'
$cachedJavaHome = Join-Path $PSScriptRoot 'jdk-27'
$wrapperPath = Join-Path $backendDirectory 'gradlew.bat'

function Test-Java27Home {
    param([string]$JavaHome)

    if ([string]::IsNullOrWhiteSpace($JavaHome)) {
        return $false
    }

    $javaExecutable = Join-Path $JavaHome 'bin\java.exe'
    $releaseFile = Join-Path $JavaHome 'release'
    if (-not (Test-Path -LiteralPath $javaExecutable -PathType Leaf) -or
        -not (Test-Path -LiteralPath $releaseFile -PathType Leaf)) {
        return $false
    }

    $releaseInfo = Get-Content -Raw -LiteralPath $releaseFile
    return $releaseInfo -match 'JAVA_VERSION="27\.'
}

if (-not (Test-Path -LiteralPath $wrapperPath -PathType Leaf)) {
    throw "Gradle wrapper not found: $wrapperPath"
}

$javaHome = $null
if (Test-Java27Home -JavaHome $env:JAVA_HOME) {
    $javaHome = (Resolve-Path -LiteralPath $env:JAVA_HOME).Path
}
elseif (Test-Path -LiteralPath $cachedJavaHome) {
    if (-not (Test-Java27Home -JavaHome $cachedJavaHome)) {
        throw "The local Java cache is invalid: $cachedJavaHome. Remove that folder or set JAVA_HOME to a valid Java 27 installation."
    }
    $javaHome = (Resolve-Path -LiteralPath $cachedJavaHome).Path
}
else {
    $bootstrapId = [Guid]::NewGuid().ToString('N')
    $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "hopon-jdk27-bootstrap-$bootstrapId"
    $archivePath = Join-Path $temporaryRoot 'jdk-27.zip'
    $extractionRoot = Join-Path $temporaryRoot 'extracted'

    New-Item -ItemType Directory -Path $extractionRoot -Force | Out-Null
    try {
        $downloadUrl = 'https://api.adoptium.net/v3/binary/latest/27/ga/windows/x64/jdk/hotspot/normal/eclipse'
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath
        }
        catch {
            throw "Could not download a Java 27 JDK from Adoptium: $($_.Exception.Message)"
        }

        if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf) -or
            (Get-Item -LiteralPath $archivePath).Length -eq 0) {
            throw 'The Java 27 JDK download was empty.'
        }

        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractionRoot
        $validJdks = @(
            Get-ChildItem -LiteralPath $extractionRoot -Directory -Filter 'jdk-27*' -ErrorAction SilentlyContinue |
                Where-Object { Test-Java27Home -JavaHome $_.FullName }
        )
        if ($validJdks.Count -ne 1) {
            throw "Expected exactly one extracted Java 27 JDK with bin\java.exe and a version 27 release marker; found $($validJdks.Count)."
        }

        if (Test-Path -LiteralPath $cachedJavaHome) {
            if (Test-Java27Home -JavaHome $cachedJavaHome) {
                $javaHome = (Resolve-Path -LiteralPath $cachedJavaHome).Path
            }
            else {
                throw "The Java cache appeared during bootstrap but is invalid: $cachedJavaHome"
            }
        }
        else {
            $sourcePath = [System.IO.Path]::GetFullPath($validJdks[0].FullName).TrimEnd('\')
            $destinationPath = [System.IO.Path]::GetFullPath($cachedJavaHome).TrimEnd('\')
            if ($sourcePath -eq $destinationPath) {
                throw 'Refusing to move the extracted JDK onto itself.'
            }

            Move-Item -LiteralPath $sourcePath -Destination $destinationPath
            if (-not (Test-Java27Home -JavaHome $destinationPath)) {
                throw "The cached JDK failed its Java 27 validation after extraction: $destinationPath"
            }
            $javaHome = $destinationPath
        }
    }
    finally {
        $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
        $resolvedSystemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if ($resolvedTemporaryRoot.StartsWith($resolvedSystemTemp, [System.StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedTemporaryRoot).StartsWith('hopon-jdk27-bootstrap-', [System.StringComparison]::Ordinal)) {
            Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

$env:JAVA_HOME = $javaHome
$env:Path = (Join-Path $javaHome 'bin') + ';' + $env:Path

Push-Location $backendDirectory
try {
    & .\gradlew.bat bootRun
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $exitCode
