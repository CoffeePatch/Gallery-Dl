param(
    [switch]$Overwrite,
    [switch]$Skip,
    [int]$Threshold = 3000
)

$ScriptDir = $PSScriptRoot
$OrchestratorScript = Join-Path $ScriptDir "fetch_orchestrator.js"

$argsList = @()
if ($Overwrite) {
    $argsList += "--overwrite"
} elseif ($Skip) {
    $argsList += "--skip"
}

if ($Threshold) {
    $argsList += "--threshold"
    $argsList += $Threshold.ToString()
}

node $OrchestratorScript @argsList
exit $LASTEXITCODE
