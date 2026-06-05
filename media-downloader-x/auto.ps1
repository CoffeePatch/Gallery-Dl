param (
    [switch]$ExtractText = $false
)

# 1. Absolute Path Setup
$ScriptDir = $PSScriptRoot
$RootFolder = Join-Path $ScriptDir ".."
$UsersFile = Join-Path $RootFolder "users.txt"
$ConfigFile = Join-Path $ScriptDir "config.json"
$CookiesFile = Join-Path $RootFolder "cookies.txt"

# Force absolute output paths to prevent split archives
$BaseOutputDir = Join-Path $RootFolder "TwitterArchive"
$BaseOutputDirGdl = $BaseOutputDir -replace '\\', '/'
$ArchiveFileGdl = (Join-Path $BaseOutputDir "archive.sqlite3") -replace '\\', '/'

if (-not (Test-Path $UsersFile)) {
    Write-Error "Error: users.txt file not found in the root directory!"
    exit 1
}

# 2. Parse Accounts
$Accounts = Get-Content $UsersFile | Where-Object { $_.Trim() -ne "" }

foreach ($Account in $Accounts) {
    # Robust URL cleanup (Handles www., http, query parameters, and trailing tags)
    $CleanHandle = $Account -replace "^(?:https?://)?(?:www\.)?(?:twitter|x)\.com/", "" -replace "\?.*$", "" -replace "/media/?$", "" -replace "^@", ""
    $TargetURL = "https://x.com/$CleanHandle"
    
    Write-Host "--------------------------------------------------" -ForegroundColor Cyan
    Write-Host "Processing Target Profile: $CleanHandle" -ForegroundColor Yellow
    if ($ExtractText) {
        Write-Host "Workflow Mode: Extracting Media AND Text Metadata (.md)" -ForegroundColor Green
    } else {
        Write-Host "Workflow Mode: Extracting Media Only" -ForegroundColor Magenta
    }
    Write-Host "--------------------------------------------------" -ForegroundColor Cyan

    # 3. Build Dynamic Gallery-dl Command arguments
    $Args = @(
        "--config", $ConfigFile,
        "--sleep-request", "1",
        "-o", "extractor.base-directory=$BaseOutputDirGdl",
        "-o", "extractor.archive=$ArchiveFileGdl"
    )

    # 4. Cookie Authentication Logic
    if (Test-Path $CookiesFile) {
        Write-Host "Auth: Using root cookies.txt file." -ForegroundColor DarkGray
        $Args += @("--cookies", $CookiesFile)
    } else {
        Write-Host "Auth: cookies.txt not found. Falling back to default Edge profile." -ForegroundColor DarkYellow
        $Args += @("--cookies-from-browser", "edge")
    }

    # 5. Toggle post-processing cleanly
    if (-not $ExtractText) {
        # Nullify the postprocessors array entirely if text extraction is OFF
        $Args += @("-o", "extractor.twitter.postprocessors=[]")
    }

    # Append Target Profile
    $Args += $TargetURL

    # Execute
    & gallery-dl @Args
}