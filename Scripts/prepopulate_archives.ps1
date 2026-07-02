$ScriptDir = $PSScriptRoot
$RootFolder = Join-Path $ScriptDir ".."
$RawDataDir = Join-Path $RootFolder "TweetData\RawData"
$AccountStatusDir = Join-Path $RootFolder "TweetData\AccountStatus"
$SyncScript = Join-Path $ScriptDir "sync_archive.py"

if (-not (Test-Path $AccountStatusDir)) {
    New-Item -ItemType Directory -Force -Path $AccountStatusDir | Out-Null
}

$jsonFiles = Get-ChildItem -Path $RawDataDir -Filter "*_tweets.json"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Pre-populating SQLite Archives from JSON files" -ForegroundColor Cyan
Write-Host " Total files to process: $($jsonFiles.Count)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$counter = 0
foreach ($file in $jsonFiles) {
    $counter++
    $username = $file.Name -replace "_tweets\.json$", ""
    $dbFile = Join-Path $AccountStatusDir "${username}_archive.sqlite3"
    
    Write-Host "[$counter/$($jsonFiles.Count)] Syncing archive for $username..." -ForegroundColor Yellow
    
    # Run the sync_archive.py script
    python $SyncScript $file.FullName $dbFile
}

Write-Host "`n[DONE] Finished pre-populating archives. You can now safely run gallerydl_batch_scraper.ps1" -ForegroundColor Green
