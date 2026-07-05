param(
    [switch]$Overwrite,
    [switch]$Skip
)

$ScriptDir     = $PSScriptRoot
$RootFolder    = Join-Path $ScriptDir ".."
$UsersFile     = Join-Path $RootFolder "Config\Users\users.txt"
$CompletedFile = Join-Path $RootFolder "Config\Queues\completed_handles.txt"
$FailedFile    = Join-Path $RootFolder "Config\Queues\failed_handles.txt"
$ConfigFile    = Join-Path $RootFolder "Config\Settings\config.json"
$CookiesFile   = Join-Path $RootFolder "Config\Cookies\cookies.txt"

# Ensure AccountStatus directory exists for SQLite archives
$AccountStatusDir = Join-Path $RootFolder "TweetData\AccountStatus"
if (-not (Test-Path $AccountStatusDir)) {
    New-Item -ItemType Directory -Force -Path $AccountStatusDir | Out-Null
}

$JsonMergerScript = Join-Path $ScriptDir "json_merger.js"

# Determine execution mode
$Mode = "default"
$OutputDir = Join-Path $RootFolder "TweetData\RawData"

if ($Overwrite) {
    $Mode = "overwrite"
    $OutputDir = Join-Path $RootFolder "TweetData\NewRawData"
} elseif ($Skip) {
    $Mode = "skip"
}

# ============================================================
# Setup
# ============================================================
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Starting Gallery-dl JSON Scraper ($Mode Mode)" -ForegroundColor Cyan
Write-Host " Output Directory: $OutputDir" -ForegroundColor Cyan
Write-Host " Account Status : $AccountStatusDir" -ForegroundColor Cyan
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

$pendingHandles = $handles
if ($Mode -ne "overwrite") {
    $pendingHandles = $handles | Where-Object { -not $completedSet.Contains($_) }
    if ($pendingHandles.Count -eq 0) {
        Write-Host "[INFO] All handles have already been processed!" -ForegroundColor Green
        exit 0
    }
    Write-Host "[INFO] Handles pending processing: $($pendingHandles.Count)`n" -ForegroundColor Yellow
} else {
    Write-Host "[INFO] Overwrite flag enabled. Ignoring completed list and forcing re-processing.`n" -ForegroundColor Yellow
}

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
    
    # Strip base URLs to generate standard username format for file saving
    $cleanUsername = $handleStr -replace "^https?://(www\.)?(twitter|x)\.com/", ""
    $cleanUsername = $cleanUsername -replace "\?.*$", "" # remove query params
    $cleanUsername = $cleanUsername -replace "/.*$", ""  # remove trailing slashes/paths
    
    $targetUrl = $handleStr
    if (-not $handleStr.StartsWith("http")) {
        $targetUrl = "https://twitter.com/$handleStr"
    }
    
    $jsonTargetFile = Join-Path $OutputDir "${cleanUsername}_tweets.json"
    $userArchiveFile = Join-Path $AccountStatusDir "${cleanUsername}_archive.sqlite3"

    Write-Host "[$counter/$total] Processing: $targetUrl -> ${cleanUsername}_tweets.json" -ForegroundColor Cyan
    
    $args = @()
    $args += "--config-ignore"
    $args += "--verbose"
    
    # We want JSON metadata without downloading media
    $args += "--resolve-json"
    
    if (Test-Path $ConfigFile) {
        $args += "--config-json"
        $args += $ConfigFile
    }

    if (Test-Path $CookiesFile) {
        $args += "--cookies"
        $args += $CookiesFile
    }
    
    # Apply Mode-specific flags
    if ($Mode -eq "overwrite") {
        # Ignore archive, delete existing target file so merger starts fresh
        if (Test-Path $jsonTargetFile) {
            Remove-Item -Path $jsonTargetFile -Force | Out-Null
        }
        # Delete user's SQLite archive to force a complete re-fetch while allowing it to be rebuilt
        if (Test-Path $userArchiveFile) {
            Remove-Item -Path $userArchiveFile -Force | Out-Null
        }
    }

    $args += $targetUrl

    # Execute Node JSON Merger which spawns gallery-dl as a child process
    $exitCode = 0
    try {
        node $JsonMergerScript $jsonTargetFile $Mode $cleanUsername $userArchiveFile -- @args
        $exitCode = $LASTEXITCODE
    } catch {
        if ($LASTEXITCODE -eq 105) {
            $exitCode = 105
        } else {
            $exitCode = 1
        }
    }

    # If the main run was tripped (exit code 105), perform the search fallback handoff
    if ($exitCode -eq 105 -or $LASTEXITCODE -eq 105) {
        $exitCode = 105
        Write-Host "[TRIPWIRE] Tripwire activated for $cleanUsername. Switching to search fallback..." -ForegroundColor Yellow
        
        if (Test-Path $jsonTargetFile) {
            try {
                $json = Get-Content -Raw -Path $jsonTargetFile | ConvertFrom-Json
                $tweets = $json | Where-Object { $_[0] -eq 2 } | ForEach-Object { $_[1] }
                
                if ($tweets -and $tweets.Count -gt 0) {
                    # Scan the last ~20 tweets to find the true oldest date
                    $scanCount = [Math]::Min($tweets.Count, 20)
                    $lastTweets = $tweets[-$scanCount..-1]
                    
                    # Sort them by date descending to find the oldest
                    $sortedLast = $lastTweets | Sort-Object { [DateTime]$_.date } -Descending
                    
                    # Find oldest date of continuous timeline, avoiding pinned tweet anomaly
                    $oldestDate = $sortedLast[-1].date
                    for ($i = $sortedLast.Count - 2; $i -ge 0; $i--) {
                        $dateA = [DateTime]$sortedLast[$i].date
                        $dateB = [DateTime]$sortedLast[$i+1].date
                        $diffDays = ($dateA - $dateB).TotalDays
                        if ($diffDays -gt 30) {
                            $oldestDate = $sortedLast[$i].date
                            break
                        }
                    }
                    
                    # Parse in a locale-independent way and add 1 day buffer
                    # Handles formats: "YYYY-MM-DD HH:MM:SS" or "ddd MMM dd HH:mm:ss +0000 yyyy"
                    $dt = $null
                    if ($oldestDate -match "^\d{4}-\d{2}-\d{2}") {
                        if ($oldestDate -match "^(\d{4})-(\d{2})-(\d{2})") {
                            $year = [int]$Matches[1]
                            $month = [int]$Matches[2]
                            $day = [int]$Matches[3]
                            $dt = New-Object DateTime $year, $month, $day
                        }
                    } else {
                        # Clean out timezone offset (e.g. "+0000" or "-0000") for Twitter created_at format
                        $cleanDate = $oldestDate -replace "[\+\-]\d{4}\s+", ""
                        $culture = [System.Globalization.CultureInfo]::InvariantCulture
                        try {
                            $dt = [DateTime]::ParseExact($cleanDate, "ddd MMM dd HH:mm:ss yyyy", $culture)
                        } catch {
                            try {
                                $dt = [DateTime]::ParseExact($cleanDate, "ddd MMM d HH:mm:ss yyyy", $culture)
                            } catch {
                                $dt = [DateTime]$oldestDate
                            }
                        }
                    }
                    
                    if ($dt -ne $null) {
                        $untilDate = $dt.AddDays(1).ToString("yyyy-MM-dd")
                        
                        # Build search URL
                        $searchUrl = "https://x.com/search?q=from:${cleanUsername} -filter:replies until:${untilDate}"
                        Write-Host "[TRIPWIRE] Anchor date is $($dt.ToString('yyyy-MM-dd')). Search until: $untilDate" -ForegroundColor Yellow
                        Write-Host "[TRIPWIRE] Running fallback: gallery-dl ... $searchUrl" -ForegroundColor Yellow
                        
                        # Build fallback args (remove the last target URL, replace with search URL)
                        $fallbackArgs = @()
                        # Copy all args except the last one (which is $targetUrl)
                        for ($i = 0; $i -lt ($args.Count - 1); $i++) {
                            $fallbackArgs += $args[$i]
                        }
                        
                        # Append search pagination and rate-limiting resiliency settings
                        $fallbackArgs += "-o"
                        $fallbackArgs += "twitter.search-pagination=until"
                        $fallbackArgs += "-o"
                        $fallbackArgs += "twitter.ratelimit=wait"
                        
                        # Append search URL
                        $fallbackArgs += $searchUrl
                        
                        # Run the fallback command
                        try {
                            node $JsonMergerScript $jsonTargetFile $Mode $cleanUsername $userArchiveFile "no-tripwire" "no-dupe-abort" -- @fallbackArgs
                            $exitCode = $LASTEXITCODE
                        } catch {
                            $exitCode = $LASTEXITCODE
                            if ($exitCode -eq 0 -or $exitCode -eq 100) {
                                # swallow non-fatal issues if they arise
                            } else {
                                $exitCode = 1
                            }
                        }
                    } else {
                        Write-Host "[ERROR] Could not parse date format: $oldestDate" -ForegroundColor Red
                        $exitCode = 1
                    }
                } else {
                    Write-Host "[ERROR] No tweets found in JSON file to determine anchor date." -ForegroundColor Red
                    $exitCode = 1
                }
            } catch {
                Write-Host "[ERROR] Failed during fallback date calculation: $_" -ForegroundColor Red
                $exitCode = 1
            }
        } else {
            Write-Host "[ERROR] JSON target file not found for fallback: $jsonTargetFile" -ForegroundColor Red
            $exitCode = 1
        }
    }

    if ($exitCode -eq 0 -or $exitCode -eq 100 -or $exitCode -eq 106) {
        # gallery-dl often exits with 0 on success, or sometimes specific codes for aborts
        Write-Host "[SUCCESS] Completed: $handleStr" -ForegroundColor Green
        
        # Sync the SQLite archive using the Python script
        $SyncScript = Join-Path $ScriptDir "sync_archive.py"
        if (Test-Path $SyncScript) {
            python $SyncScript $jsonTargetFile $userArchiveFile
        }

        # Add to completed list
        if (-not $completedSet.Contains($handleStr)) {
            Add-Content -Path $CompletedFile -Value $handleStr
            $completedSet.Add($handleStr) | Out-Null
        }
    } else {
        Write-Host "[ERROR] Failed/Aborted cleanly: $handleStr (Exit code: $exitCode)" -ForegroundColor Red
        $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        Add-Content -Path $FailedFile -Value "$timestamp - $handleStr - Exit Code: $exitCode"
    }
    
    Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
}

Write-Host "`n[DONE] Finished processing queued handles." -ForegroundColor Green
