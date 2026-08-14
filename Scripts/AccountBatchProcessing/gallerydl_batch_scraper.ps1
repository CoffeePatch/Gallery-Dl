# DEPRECATED: This script is deprecated and will be removed in a future release.
# The scraping orchestration logic has moved to node fetch_orchestrator.js via run_scraper.ps1.

param(
    [switch]$Overwrite,
    [switch]$Skip,
    [int]$Threshold = 3000
)

Write-Host "[DEPRECATION NOTICE] gallerydl_batch_scraper.ps1 is deprecated. Delegating to run_scraper.ps1..." -ForegroundColor Yellow

$ScriptDir = $PSScriptRoot
$RunScraper = Join-Path $ScriptDir "run_scraper.ps1"

$params = @{}
if ($Overwrite) { $params["Overwrite"] = $true }
if ($Skip) { $params["Skip"] = $true }
if ($Threshold) { $params["Threshold"] = $Threshold }

& $RunScraper @params
exit $LASTEXITCODE
