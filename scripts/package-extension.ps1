[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'extension\manifest.json') -Raw | ConvertFrom-Json
$dist = Join-Path $projectRoot 'dist'
$output = Join-Path $dist "bookmark-agent-bridge-extension-$($manifest.version).zip"

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
Compress-Archive -Path (Join-Path $projectRoot 'extension\*') -DestinationPath $output -CompressionLevel Optimal
Write-Output $output
