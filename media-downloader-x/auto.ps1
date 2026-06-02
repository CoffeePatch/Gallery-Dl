# Filename: auto.ps1

Param (
    [string] $UsersFile = ".\users.txt",
    [string] $ConfigPath = ".\config.json",
    [string] $CookiesPath = ".\cookies.txt",
    [string] $Proxy,
    [string] $User,
    [double] $SleepRequest = 0,
    [double] $SleepExtractor = 0,
    [switch] $VerboseGdl,
    [switch] $NoReplies,
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

function Get-TwitterHandleFromInput {
    param([Parameter(Mandatory=$true)][string] $InputValue)

    $value = $InputValue.Trim()
    if ($value -match '^[A-Za-z0-9_]{1,15}$') {
        return $value
    }
    if ($value -match '^(?:https?://)?(?:www\.)?(?:x\.com|twitter\.com)/([A-Za-z0-9_]{1,15})(?:/|$)') {
        return $Matches[1]
    }
    return $null
}

function Get-TargetsForInput {
    param(
        [Parameter(Mandatory=$true)][string] $InputValue,
        [Parameter(Mandatory=$true)][bool] $IncludeReplies
    )

    $value = $InputValue.Trim()
    $handle = Get-TwitterHandleFromInput -InputValue $value

    # If it's a bare handle or profile URL, expand to /media (+ /with_replies)
    if ($handle) {
        $targets = @(
            "https://x.com/$handle/media"
        )
        if ($IncludeReplies) {
            $targets += "https://x.com/$handle/with_replies"
        }
        return [PSCustomObject]@{ Handle = $handle; Targets = $targets }
    }

    # Otherwise treat it as an explicit URL/target already
    return [PSCustomObject]@{ Handle = $null; Targets = @($value) }
}

function Get-ExpectedCounts {
    param(
        [Parameter(Mandatory=$true)][string] $Handle,
        [string] $CookiesPath,
        [string] $Proxy,
        [double] $SleepRequest
    )

    $args = @(
        "--config-ignore",
        "--cookies", $CookiesPath,
        "-s",
        "-N", "{author[media_count]}|{author[statuses_count]}|{author[name]}",
        "https://x.com/$Handle/info"
    )
    if ($Proxy) {
        $args = @("--proxy", $Proxy) + $args
    }
    if ($SleepRequest -and $SleepRequest -gt 0) {
        $args = @("--sleep-request", $SleepRequest) + $args
    }

    try {
        $out = & gallery-dl @args 2>$null
        $line = ($out | Select-Object -First 1)
        if ($line -match '^(\d+)\|(\d+)\|(.+)$') {
            return [PSCustomObject]@{
                MediaCount = [int]$Matches[1]
                StatusesCount = [int]$Matches[2]
                AuthorName = $Matches[3]
            }
        }
    } catch {
        # ignore
    }

    return $null
}

function Get-DownloadedCounts {
    param([Parameter(Mandatory=$true)][string] $DirectoryPath)

    if (-not (Test-Path $DirectoryPath)) {
        return [PSCustomObject]@{
            Total = 0
            Photos = 0
            Videos = 0
            Other = 0
        }
    }

    $photoExt = @(".jpg", ".jpeg", ".png", ".gif", ".webp")
    $videoExt = @(".mp4", ".webm", ".mov", ".mkv")
    $mediaExt = $photoExt + $videoExt

    $files = Get-ChildItem -Path $DirectoryPath -File -ErrorAction SilentlyContinue |
        Where-Object { $mediaExt -contains $_.Extension.ToLowerInvariant() }

    $photos = ($files | Where-Object { $photoExt -contains $_.Extension.ToLowerInvariant() }).Count
    $videos = ($files | Where-Object { $videoExt -contains $_.Extension.ToLowerInvariant() }).Count
    $total = $files.Count

    $tweetIds = @(
        $files |
            ForEach-Object {
                if ($_.BaseName -match '^(\d+)_') { $Matches[1] }
            } |
            Where-Object { $_ } |
            Sort-Object -Unique
    )

    return [PSCustomObject]@{
        Total = $total
        Photos = $photos
        Videos = $videos
        MediaTweets = $tweetIds.Count
    }
}

$includeReplies = -not $NoReplies

# Read inputs (either -User or users.txt)
if ($User -and $User.Trim().Length -gt 0) {
    $inputs = @($User.Trim())
} else {
    # Validate users.txt
    if (-not (Test-Path $UsersFile)) {
        Write-Host "Error: Users file '$UsersFile' not found!" -ForegroundColor Red
        exit 1
    }
    if ((Get-Item $UsersFile).Length -eq 0) {
        Write-Host "Error: Users file '$UsersFile' is empty!" -ForegroundColor Red
        exit 1
    }

    $inputs = Get-Content -Path $UsersFile |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_.Length -gt 0 -and -not $_.StartsWith("#") }

    if ($inputs.Count -eq 0) {
        Write-Host "No valid lines found in $UsersFile" -ForegroundColor Yellow
        exit 1
    }
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

$targetsByHandle = [ordered]@{}
$explicitTargets = @()

foreach ($input in $inputs) {
    $result = Get-TargetsForInput -InputValue $input -IncludeReplies $includeReplies
    if ($result.Handle) {
        if (-not $targetsByHandle.Contains($result.Handle)) {
            $targetsByHandle[$result.Handle] = @()
        }
        $targetsByHandle[$result.Handle] += $result.Targets
    } else {
        $explicitTargets += $result.Targets
    }
}

# De-dup targets per handle
foreach ($handleKey in @($targetsByHandle.Keys)) {
    $targetsByHandle[$handleKey] = @($targetsByHandle[$handleKey] | Sort-Object -Unique)
}

function Invoke-GalleryDl {
    param([Parameter(Mandatory=$true)][string] $Target)

    Write-Host "`nProcessing target: $Target" -ForegroundColor Cyan

    $args = @()
    # Ignore any global/user gallery-dl config (e.g. download=false)
    $args += "--config-ignore"
    # Load our workspace config explicitly as JSON
    $args += "--config-json"
    $args += $ConfigPath
    $args += "-o"
    $args += "extractor.base-directory=$runBaseDirGdl"
    if ($IgnoreArchive) {
        $args += "-o"
        $args += "extractor.archive=null"
    } else {
        $args += "-o"
        $args += "extractor.archive=$archivePathGdl"
    }
    # Safety override: ensure Twitter extractor actually downloads media
    $args += "-o"
    $args += "extractor.twitter.download=true"
    if ($SleepRequest -and $SleepRequest -gt 0) {
        $args += "--sleep-request"
        $args += $SleepRequest
    }
    if ($SleepExtractor -and $SleepExtractor -gt 0) {
        $args += "--sleep-extractor"
        $args += $SleepExtractor
    }
    if ($VerboseGdl) {
        $args += "-v"
    }
    if (Test-Path $CookiesPath) {
        $args += "--cookies"
        $args += $CookiesPath
    }
    if ($Proxy) {
        $args += "--proxy"
        $args += $Proxy
    }
    $args += $Target

    & gallery-dl @args 2>&1 | Tee-Object -FilePath $logPath -Append
    return $LASTEXITCODE
}

# Process grouped handles (auto-expanded)
foreach ($handle in $targetsByHandle.Keys) {
    Write-Host "`n=== User: $handle ===" -ForegroundColor Magenta

    foreach ($target in $targetsByHandle[$handle]) {
        $exit = Invoke-GalleryDl -Target $target
        if ($exit -ne 0) {
            Write-Host "⚠️ Error / skipped $target (exit code $exit)" -ForegroundColor Red
        }
    }

    # Print counts + expected values
    $expected = $null
    if (Test-Path $CookiesPath) {
        $expected = Get-ExpectedCounts -Handle $handle -CookiesPath $CookiesPath -Proxy $Proxy -SleepRequest $SleepRequest
    }
    $userDir = Join-Path $runBaseDir $handle
    $counts = Get-DownloadedCounts -DirectoryPath $userDir

    if ($expected) {
        Write-Host ("Media count (X profile): {0} | Statuses: {1}" -f $expected.MediaCount, $expected.StatusesCount) -ForegroundColor DarkCyan
    }
    Write-Host ("Downloaded media: {0} files (photos: {1}, videos: {2}) | media-tweets: {3}" -f $counts.Total, $counts.Photos, $counts.Videos, $counts.MediaTweets) -ForegroundColor Green
}

# Process explicit targets (as-is)
foreach ($target in $explicitTargets) {
    $exit = Invoke-GalleryDl -Target $target
    if ($exit -eq 0) {
        Write-Host "✅ Successfully processed $target" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Error / skipped $target (exit code $exit)" -ForegroundColor Red
    }
}

Write-Host "`nAll done at $(Get-Date)" -ForegroundColor Green