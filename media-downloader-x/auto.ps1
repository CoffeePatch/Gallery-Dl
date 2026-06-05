param (
    [switch]$ExtractText = $false
)

# 1. Path Setup
$UsersFile = "./users.txt"
$ConfigFile = "./config.json"

if (-not (Test-Path $UsersFile)) {
    Write-Error "Error: users.txt file not found!"
    exit 1
}

# 2. Parse Accounts
$Accounts = Get-Content $UsersFile | Where-Object { $_.Trim() -ne "" }

foreach ($Account in $Accounts) {
    # Normalize URL/Handle to base profile link, removing any trailing '/media'
    $CleanHandle = $Account -replace "https://(twitter|x).com/", "" -replace "/media/?", "" -replace "@", ""
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
        "--cookies-from-browser", "edge",
        "--config", $ConfigFile
    )

    # Toggle post-processing conditionally 
    if ($ExtractText) {
        $Args += @("-o", "twitter.postprocessors.metadata.enabled=true")
    } else {
        $Args += @("-o", "twitter.postprocessors.metadata.enabled=false")
    }

    # Append Target Profile
    $Args += $TargetURL

    # Execute
    & gallery-dl @Args
}