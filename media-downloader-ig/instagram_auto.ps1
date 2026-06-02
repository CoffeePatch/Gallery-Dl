Param (
    [string] $UsersFile = ".\\instagram_users.txt",
    [string] $ConfigPath = ".\\instagram_config.json",
    [string] $CookiesPath = ".\\instagram_cookies.txt",
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

Write-Host "Starting Instagram download at $(Get-Date)" -ForegroundColor Green

if (-not (Test-Path $CookiesPath)) {
    Write-Host "Warning: Instagram cookies file '$CookiesPath' not found. Instagram often blocks anonymous requests; export cookies and re-run if you see errors." -ForegroundColor Yellow
}

# Validate users file
if (-not (Test-Path $UsersFile)) {
    Write-Host "Error: Users file '$UsersFile' not found!" -ForegroundColor Red
    exit 1
}
if ((Get-Item $UsersFile).Length -eq 0) {
    Write-Host "Error: Users file '$UsersFile' is empty!" -ForegroundColor Red
    exit 1
}

# Validate config
if (-not (Test-Path $ConfigPath)) {
    Write-Host "Error: Config file '$ConfigPath' not found!" -ForegroundColor Red
    exit 1
}

# Output base directory
if ($UseRunId) {
    $runId = Get-Date -Format 'yyyyMMdd_HHmmss'
    $baseDir = Join-Path $ScriptRoot (Join-Path 'Instagram' $runId)
} else {
    $baseDir = Join-Path $ScriptRoot 'Instagram'
}
New-Item -ItemType Directory -Force -Path $baseDir | Out-Null

$baseDirGdl = $baseDir -replace '\\', '/'

$archivePath = Join-Path $ScriptRoot (Join-Path 'Instagram' 'archive.sqlite3')
$archivePathGdl = $archivePath -replace '\\', '/'

$logPath = Join-Path $baseDir "gallerydl_run.log"
Write-Host "Output folder: $baseDir" -ForegroundColor Green
Write-Host "Logging to $logPath"

$targets = Get-Content -Path $UsersFile | Where-Object { $_.Trim().Length -gt 0 }
if ($targets.Count -eq 0) {
    Write-Host "No valid lines found in $UsersFile" -ForegroundColor Yellow
    exit 1
}

foreach ($target in $targets) {
    $targetTrim = $target.Trim()
    if ($targetTrim -eq "") { continue }

    Write-Host "`nProcessing target: $targetTrim" -ForegroundColor Cyan

    $args = @()
    # Ignore any global/user gallery-dl config
    $args += "--config-ignore"
    # Load our workspace config explicitly as JSON
    $args += "--config-json"
    $args += $ConfigPath

    # Force base directory
    $args += "-o"
    $args += "extractor.base-directory=$baseDirGdl"

    # Use download archive unless bypassed
    if ($IgnoreArchive) {
        $args += "-o"
        $args += "extractor.archive=null"
    } else {
        $args += "-o"
        $args += "extractor.archive=$archivePathGdl"
    }

    if (Test-Path $CookiesPath) {
        $args += "--cookies"
        $args += $CookiesPath
    }

    $args += $targetTrim

    & gallery-dl @args 2>&1 | Tee-Object -FilePath $logPath -Append

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Successfully processed $targetTrim" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Error / skipped $targetTrim (exit code $LASTEXITCODE)" -ForegroundColor Red
    }
}

Write-Host "`nAll done at $(Get-Date)" -ForegroundColor Green
