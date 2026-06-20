$ScriptDir     = $PSScriptRoot
$RootFolder    = Join-Path $ScriptDir ".."
$UsersFile     = Join-Path $RootFolder "Config\Users\users.txt"
$CompletedFile = Join-Path $RootFolder "Config\Queues\completed_handles.txt"
$FailedFile    = Join-Path $RootFolder "Config\Queues\failed_handles.txt"
$ConfigFile    = Join-Path $RootFolder "Config\Settings\config.json"
$CookiesFile   = Join-Path $RootFolder "Config\Cookies\cookies.txt"
$OutputDir     = Join-Path $RootFolder "TweetData\RawData"

# ============================================================
# Setup
# ============================================================
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Starting Gallery-dl Queue Processor" -ForegroundColor Cyan
Write-Host " Output Directory: $OutputDir" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Validate core files
if (-not (Test-Path $UsersFile)) {
    Write-Host "[ERROR] Input file not found: $UsersFile" -ForegroundColor Red
    exit 1
}

# Read target handles
$handles = Get-Content $UsersFile | Where-Object { $_.Trim().Length -gt 0 }
if ($handles.Count -eq 0) {
    Write-Host "[INFO] Input file is empty. Nothing to process." -ForegroundColor Yellow
    exit 0
}

# Create output dir
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

# Read completed state
$completedHandles = @()
if (Test-Path $CompletedFile) {
    $completedHandles = Get-Content $CompletedFile | Where-Object { $_.Trim().Length -gt 0 }
}
$completedSet = New-Object System.Collections.Generic.HashSet[string]
foreach ($c in $completedHandles) {
    $completedSet.Add($c) | Out-Null
}

Write-Host "[INFO] Total handles loaded: $($handles.Count)"
Write-Host "[INFO] Handles already completed: $($completedSet.Count)"

$pendingHandles = $handles | Where-Object { -not $completedSet.Contains($_) }
if ($pendingHandles.Count -eq 0) {
    Write-Host "[INFO] All handles have already been processed!" -ForegroundColor Green
    exit 0
}

Write-Host "[INFO] Handles pending processing: $($pendingHandles.Count)`n" -ForegroundColor Yellow

# Ensure Failed file exists to avoid append errors
if (-not (Test-Path $FailedFile)) {
    New-Item -ItemType File -Force -Path $FailedFile | Out-Null
}

# ============================================================
# Execution Loop
# ============================================================
$counter = 0
$total = $pendingHandles.Count

foreach ($handle in $pendingHandles) {
    $counter++
    $handleStr = $handle.Trim()
    
    # Check if target is a generic URL or just a handle
    $targetUrl = $handleStr
    if (-not $handleStr.StartsWith("http")) {
        $targetUrl = "https://twitter.com/$handleStr"
    }

    Write-Host "[$counter/$total] Processing: $targetUrl" -ForegroundColor Cyan
    
    $args = @()
    $args += "--config-ignore"
    
    if (Test-Path $ConfigFile) {
        $args += "--config-json"
        $args += $ConfigFile
    }

    if (Test-Path $CookiesFile) {
        $args += "--cookies"
        $args += $CookiesFile
    }

    # Output to raw data directory
    $args += "-d"
    $args += $OutputDir
    
    # Request the target
    $args += $targetUrl

    # Execute gallery-dl and capture all output/errors natively to variable to check
    # Instead of just piping, let's look at the exit code
    & gallery-dl @args 2>&1 | Tee-Object -Variable outputLines

    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Completed: $handleStr" -ForegroundColor Green
        # Add to completed list
        Add-Content -Path $CompletedFile -Value $handleStr
    } else {
        # Check if it was an empty profile vs actual failure
        $isEmpty = $false
        foreach ($line in $outputLines) {
            if ($line -match "No suitable extractor found" -or $line -match "HttpError") {
                $isEmpty = $false
            }
        }
        
        Write-Host "[ERROR] Failed: $handleStr (Exit code: $LASTEXITCODE)" -ForegroundColor Red
        $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        Add-Content -Path $FailedFile -Value "$timestamp - $handleStr - Exit Code: $LASTEXITCODE"
    }
    
    Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
}

Write-Host "`n[DONE] Finished processing all queued handles." -ForegroundColor Green
