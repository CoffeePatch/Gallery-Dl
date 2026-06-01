# Filename: auto.ps1

Param (
    [string] $UsersFile = ".\users.txt",
    [string] $ConfigPath = ".\config.json",
    [string] $CookiesPath = ".\cookies.txt",
    [switch] $UseRunId,
    [switch] $IgnoreArchive
)

$ScriptRoot = $PSScriptRoot
if (-not $ScriptRoot) {
    $ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$UsersFile = Join-Path $ScriptRoot $UsersFile
$ConfigPath = Join-Path $ScriptRoot $ConfigPath
$CookiesPath = Join-Path $ScriptRoot $CookiesPath

# Enable UTF-8 output
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

Write-Host "Starting tweet download at $(Get-Date)" -ForegroundColor Green

if (-not (Test-Path $CookiesPath)) {
    Write-Host "Warning: Cookies file '$CookiesPath' not found. Twitter/X often requires authenticated cookies; you may see 'AuthRequired' or 'No results'." -ForegroundColor Yellow
}

# Validate users.txt
if (-not (Test-Path $UsersFile)) {
    Write-Host "Error: Users file '$UsersFile' not found!" -ForegroundColor Red
    exit 1
}
if ((Get-Item $UsersFile).Length -eq 0) {
    Write-Host "Error: Users file '$UsersFile' is empty!" -ForegroundColor Red
    exit 1
}

# Read users
$users = Get-Content -Path $UsersFile | Where-Object { $_.Trim().Length -gt 0 }
if ($users.Count -eq 0) {
    Write-Host "No valid lines found in $UsersFile" -ForegroundColor Yellow
    exit 1
}

# Validate config.json
if (-not (Test-Path $ConfigPath)) {
    Write-Host "Error: Config file '$ConfigPath' not found!" -ForegroundColor Red
    exit 1
}

# By default, download directly into ./Tweets/<username>/
# Use -UseRunId to group each run under ./Tweets/<timestamp>/<username>/
if ($UseRunId) {
    $runId = Get-Date -Format 'yyyyMMdd_HHmmss'
    $runBaseDir = Join-Path $ScriptRoot (Join-Path 'Tweets' $runId)
} else {
    $runBaseDir = Join-Path $ScriptRoot 'Tweets'
}
New-Item -ItemType Directory -Force -Path $runBaseDir | Out-Null

$runBaseDirGdl = $runBaseDir -replace '\\', '/'

$archivePath = Join-Path $ScriptRoot (Join-Path 'Tweets' 'archive.sqlite3')
$archivePathGdl = $archivePath -replace '\\', '/'

# create a log file (in the run folder, or in ./Tweets when -NoRunId is set)
$logPath = Join-Path $runBaseDir "gallerydl_run.log"
Write-Host "Output folder: $runBaseDir" -ForegroundColor Green
Write-Host "Logging to $logPath"

foreach ($user in $users) {
    $userTrim = $user.Trim()
    if ($userTrim -eq "") { continue }

    Write-Host "`nProcessing user: $userTrim" -ForegroundColor Cyan

    # Build gallery-dl command
    $args = @()
    # Ignore any global/user gallery-dl config (e.g. download=false)
    $args += "--config-ignore"
    # Load our workspace config explicitly as JSON
    $args += "--config-json"
    $args += $ConfigPath
    $args += "-o"
    $args += "extractor.base-directory=$runBaseDirGdl"
    if ($IgnoreArchive) {
        # Override any archive setting to avoid skipping downloads
        $args += "-o"
        $args += "extractor.archive=null"
    } else {
        $args += "-o"
        $args += "extractor.archive=$archivePathGdl"
    }
    # Safety override: ensure Twitter extractor actually downloads media
    $args += "-o"
    $args += "extractor.twitter.download=true"
    if (Test-Path $CookiesPath) {
        $args += "--cookies"
        $args += $CookiesPath
    }
    $args += $userTrim

    # Run gallery-dl
    & gallery-dl @args 2>&1 | Tee-Object -FilePath $logPath -Append

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Successfully processed $userTrim" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Error / skipped $userTrim (exit code $LASTEXITCODE)" -ForegroundColor Red
    }
}

Write-Host "`nAll done at $(Get-Date)" -ForegroundColor Green