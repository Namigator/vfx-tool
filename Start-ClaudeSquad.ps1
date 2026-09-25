param([string]$Project = 'F:\Dev2\VFX-Tool')
$ErrorActionPreference = 'Stop'
$pwsh = 'C:\Program Files\PowerShell\7\pwsh.exe'
$loop = Join-Path $Project 'tools\squad-agent.ps1'
# Explicit user request: visible terminals. Never use bypassPermissions.
foreach ($agent in @(@{Id='claude-model';Role='worker'},@{Id='claude-controls';Role='worker'},@{Id='claude-review';Role='inspector'})) {
  $processFile = Join-Path $Project ".squad\logs\$($agent.Id).process.json"
  if (Test-Path -LiteralPath $processFile) {
    $previous = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
    if (Get-Process -Id $previous.pid -ErrorAction SilentlyContinue) { throw "$($agent.Id) already has a live process; inspect it instead of launching twice." }
  }
  $arguments = @('-NoLogo','-NoProfile','-NoExit','-File',('"{0}"' -f $loop),'-Id',$agent.Id,'-Role',$agent.Role,'-Project',('"{0}"' -f $Project))
  $process = Start-Process -FilePath $pwsh -ArgumentList $arguments -WorkingDirectory $Project -WindowStyle Normal -PassThru
  Start-Sleep -Milliseconds 800
  Write-Output "Launched visible Claude $($agent.Role): $($agent.Id), terminal PID=$($process.Id)"
}

