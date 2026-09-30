$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js is not available. Install Node.js 24 or newer.' }
$nodeExecutable = $nodeCommand.Source
if (-not (Test-Path -LiteralPath 'node_modules/vite/bin/vite.js')) { throw 'Dependencies are missing. Run pnpm install --frozen-lockfile --ignore-scripts in this directory.' }
Write-Host 'Opening the editor at http://127.0.0.1:5174/ - keep this window running.'
Start-Job -ScriptBlock { Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:5174/' } | Out-Null
& $nodeExecutable node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort
