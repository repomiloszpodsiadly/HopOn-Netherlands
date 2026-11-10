$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$localJavaHome = Join-Path $PSScriptRoot 'jdk-27'
$localGradle = Join-Path $PSScriptRoot 'gradle-9.8.2\bin\gradle.bat'

if (-not (Test-Path $localGradle)) {
    $gradleArchive = Join-Path $PSScriptRoot 'gradle-9.8.2-bin.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://downloads.gradle.org/distributions/gradle-9.8.2-bin.zip' -OutFile $gradleArchive
    if ((Get-Item -LiteralPath $gradleArchive).Length -eq 0) {
        throw 'The Gradle 9.8.2 download was empty; remove the partial archive and retry.'
    }
    Expand-Archive -LiteralPath $gradleArchive -DestinationPath $PSScriptRoot -Force
    Remove-Item -LiteralPath $gradleArchive
}

if (-not (Test-Path (Join-Path $localJavaHome 'bin\java.exe'))) {
    $javaArchive = Join-Path $PSScriptRoot "jdk-27-$PID.zip"
    Invoke-WebRequest -UseBasicParsing -Uri 'https://api.adoptium.net/v3/binary/latest/27/ga/windows/x64/jdk/hotspot/normal/eclipse' -OutFile $javaArchive
    Expand-Archive -LiteralPath $javaArchive -DestinationPath $PSScriptRoot -Force
    Remove-Item -LiteralPath $javaArchive
    $extractedJdk = Get-ChildItem -LiteralPath $PSScriptRoot -Directory -Filter 'jdk-27*' | Select-Object -First 1
    if ($null -eq $extractedJdk) {
        throw 'The Java 27 archive downloaded, but its extracted JDK folder was not found.'
    }
    Move-Item -LiteralPath $extractedJdk.FullName -Destination $localJavaHome
}

if (Test-Path (Join-Path $localJavaHome 'bin\java.exe')) {
    $env:JAVA_HOME = $localJavaHome
    $env:Path = (Join-Path $localJavaHome 'bin') + ';' + $env:Path
}

if (-not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
    throw 'Java 27 is required. Install it into .tools\jdk-27 or set JAVA_HOME to a Java 27 JDK.'
}

$releaseFile = Join-Path $env:JAVA_HOME 'release'
$releaseInfo = Get-Content -Raw -LiteralPath $releaseFile
if ($releaseInfo -notmatch 'JAVA_VERSION="27\.') {
    throw "Expected Java 27 at JAVA_HOME, found: $releaseFile"
}

& $localGradle -p (Join-Path $repoRoot 'backend') bootRun
exit $LASTEXITCODE
