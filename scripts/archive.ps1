# ============================================================
# Twitter Gallery-DL Archival Script
# ============================================================
# users.txt format (one per line):
#   https://x.com/handle1 | both
#   https://x.com/handle2 | media
#   handle3 | both
# ============================================================

$ScriptDir = $PSScriptRoot
$RootFolder = Join-Path $ScriptDir ".."
$UsersFile = Join-Path $RootFolder "users.txt"
$ConfigFile = Join-Path $ScriptDir "config.json"
$CookiesFile = Join-Path $RootFolder "cookies.txt"

# Output root: "Tweets" folder
$BaseOutputDir = Join-Path $RootFolder "Tweets"
$BaseOutputDirGdl = $BaseOutputDir -replace '\\', '/'
$ArchiveFileGdl = (Join-Path $BaseOutputDir "archive.sqlite3") -replace '\\', '/'

# Ensure output directory exists
if (-not (Test-Path $BaseOutputDir)) {
    New-Item -ItemType Directory -Path $BaseOutputDir -Force | Out-Null
}

# Validate users.txt
if (-not (Test-Path $UsersFile)) {
    Write-Error "Error: users.txt not found at $UsersFile"
    exit 1
}

# Validate config.json
if (-not (Test-Path $ConfigFile)) {
    Write-Error "Error: config.json not found at $ConfigFile"
    exit 1
}

$Lines = Get-Content $UsersFile | Where-Object { $_.Trim() -ne "" -and -not $_.Trim().StartsWith("#") }

foreach ($Line in $Lines) {
    # Parse "URL | mode"
    $Parts = $Line -split '\|'
    $Account = $Parts[0].Trim()
    $Mode = if ($Parts.Count -ge 2) { $Parts[1].Trim().ToLower() } else { "both" }

    # Extract raw handle
    $CleanHandle = $Account -replace "^(?:https?://)?(?:www\.)?(?:twitter|x)\.com/", "" `
                            -replace "\?.*$", "" `
                            -replace "/media/?$", "" `
                            -replace "/tweets/?$", "" `
                            -replace "/with_replies/?$", "" `
                            -replace "^@", "" `
                            -replace "/$", ""

    if ([string]::IsNullOrWhiteSpace($CleanHandle)) {
        Write-Warning "Skipping empty/invalid line: $Line"
        continue
    }

    $TargetURL = "https://x.com/$CleanHandle"

    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host " Target: $CleanHandle" -ForegroundColor Yellow
    Write-Host " Mode:   $Mode" -ForegroundColor Yellow
    Write-Host "==================================================" -ForegroundColor Cyan

    # Build gallery-dl arguments
    $GdlArgs = @(
        "--config-ignore",
        "--config", $ConfigFile,
        "-o", "extractor.base-directory=$BaseOutputDirGdl",
        "-o", "extractor.archive=$ArchiveFileGdl"
    )

    # Cookies
    if (Test-Path $CookiesFile) {
        $GdlArgs += @("--cookies", $CookiesFile)
    } else {
        Write-Warning "cookies.txt not found. Attempting browser cookies (Edge)."
        $GdlArgs += @("--cookies-from-browser", "edge")
    }

    # Per-account mode handling
    switch ($Mode) {
        "media" {
            # Disable postprocessors (no .md file, no text)
            $GdlArgs += @("-o", "extractor.twitter.postprocessors=[]")
            # Also disable text-tweets since we don't need them
            $GdlArgs += @("-o", "extractor.twitter.text-tweets=false")
        }
        "both" {
            # Postprocessors stay active from config
            # text-tweets stays true from config
        }
        default {
            Write-Warning "Unknown mode '$Mode' for $CleanHandle. Defaulting to 'both'."
        }
    }

    $GdlArgs += $TargetURL

    # Execute
    Write-Host "Running: gallery-dl $($GdlArgs -join ' ')" -ForegroundColor DarkGray
    & gallery-dl @GdlArgs
    $ExitCode = $LASTEXITCODE

    if ($ExitCode -ne 0) {
        Write-Warning "gallery-dl exited with code $ExitCode for $CleanHandle"
    } else {
        Write-Host "Completed: $CleanHandle" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " All accounts processed." -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
