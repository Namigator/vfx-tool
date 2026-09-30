$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Claude sign-in - VFX Tool'
Write-Host 'Complete Claude sign-in here. Do not paste credentials into chat.' -ForegroundColor Cyan
& 'C:\Users\itonk\AppData\Roaming\Claude\claude-code\2.1.280\claude.exe' auth login
if ($LASTEXITCODE -eq 0) { Write-Host 'Sign-in finished. Tell Codex to resume the two saved squad tasks.' -ForegroundColor Green }
