$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { 'C:\Users\itonk\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw 'Node.js is not available. Install Node.js 24 or update its path in this launcher.' }
if (-not (Test-Path -LiteralPath 'node_modules/vite/bin/vite.js')) { throw 'Dependencies are missing. Run pnpm install --frozen-lockfile --ignore-scripts in this directory.' }
Write-Host 'Opening the editor at http://127.0.0.1:5174/?workspace=v2 - keep this window running.'
# Open the browser shortly after the server starts (the old v1 editor stays at http://127.0.0.1:5174/).
Start-Job -ScriptBlock { Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:5174/?workspace=v2' } | Out-Null
& $nodeExecutable node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort
