$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { 'C:\Users\itonk\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw 'Node.js is not available. Install Node.js 24 or update its path in this launcher.' }
if (-not (Test-Path -LiteralPath 'node_modules/vite/bin/vite.js')) { throw 'Dependencies are missing. Run pnpm install --frozen-lockfile --ignore-scripts in this directory.' }
Write-Host 'Open http://127.0.0.1:5174/ in your browser. Keep this window running.'
& $nodeExecutable node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort
