param(
  [Parameter(Mandatory)][string]$Id,
  [Parameter(Mandatory)][ValidateSet('worker','inspector')][string]$Role,
  [string]$Project = 'F:\Dev2\VFX-Tool',
  [string]$Manager = 'vfx-manager',
  [string]$Model = 'claude-opus-5-5',
  [ValidateSet('low','medium','high','xhigh','max')][string]$Effort = 'low',
  [string]$Claude = 'C:\Users\itonk\AppData\Roaming\Claude\claude-code\2.1.281\claude.exe',
  [string]$Squad = 'F:\Dev2\squad\squad.exe',
  [switch]$ResumeExistingRegistration
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
# Process-local setting; inherited by Claude, never changes global user settings.
$env:CLAUDE_CODE_EFFORT_LEVEL = $Effort
Set-Location -LiteralPath $Project
$logDir = Join-Path $Project '.squad\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "$Id.log"
$stopFile = Join-Path $logDir "$Id.stop"
$Host.UI.RawUI.WindowTitle = "VFX Claude - $Id ($Role)"
function Say([string]$message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $message
  Write-Host $line -ForegroundColor Cyan
  Add-Content -LiteralPath $log -Value $line
}
function SquadCall([string[]]$CommandArgs) {
  for ($attempt = 0; $attempt -lt 4; $attempt++) {
    $output = & $Squad @CommandArgs 2>&1
    if ($LASTEXITCODE -eq 0) { return ($output -join "`n") }
    $failureText = $output -join "`n"
    if ($failureText -notmatch 'database is locked' -or $attempt -eq 3) { throw $failureText }
    Start-Sleep -Milliseconds (250 * ($attempt + 1))
  }
}
try {
  Say "Claude $Role starting with model=$Model effort=$Effort in $Project. No installations, shell tools, or nested agents."
  if ($ResumeExistingRegistration) {
    $actualId = $Id
  } else {
  $joined = SquadCall @('join',$Id,'--role',$Role,'--client','claude','--protocol-version','2')
  if ($joined -notmatch 'Joined as ([^\s]+) \(role:') { throw "Could not determine actual squad ID: $joined" }
  $actualId = $Matches[1]
  if ($actualId -ne $Id) { throw "ID already occupied; assigned $actualId. Manager must reconcile before dispatch." }
  }
  @{id=$Id; role=$Role; model=$Model; effort=$Effort; pid=$PID; project=$Project; started=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logDir "$Id.process.json")
  # Enter receive immediately after joining; the manager discovers readiness via agents.
  while (-not (Test-Path -LiteralPath $stopFile)) {
    $inbox = SquadCall @('receive',$Id,'--wait','--timeout','30','--json')
    foreach ($line in ($inbox -split "`r?`n")) {
      if (-not $line.Trim()) { continue }
      try { $message = $line | ConvertFrom-Json } catch { Say "Receive note: $line"; continue }
      $resume = $message.task_id -and $message.content -eq 'RESUME_SAVED_TASK'
      if (-not $message.task_id -or ($message.kind -ne 'task_assigned' -and -not $resume)) { Say "Message: $($message.content)"; continue }
      $taskId = $message.task_id
      if ($resume) {
        $savedPrompt = Join-Path $logDir "$Id-$taskId.prompt.txt"
        $savedAssignment = Join-Path $logDir "$Id-$taskId.assignment.txt"
        if (-not (Test-Path -LiteralPath $savedAssignment)) { Copy-Item -LiteralPath $savedPrompt -Destination $savedAssignment }
        $title = "Resume saved assignment $taskId"
        $body = Get-Content -LiteralPath $savedAssignment -Raw
      } else {
        $title = $message.task.title
        $body = $message.task.body
      }
      try { SquadCall @('task','ack',$Id,$taskId) | Out-Null }
      catch {
        if ($_.Exception.Message -match 'is not queued|is not assigned') {
          Say "Skipped stale assignment notification for $taskId; manager retains task state."
          continue
        }
        throw
      }
      Say "TASK $taskId : $title"
      $prompt = @"
You are Claude agent $Id ($Role), assigned by the manager via the squad skill.
Repository: $Project. Read AGENTS.md, STATE.md, and the specific plan documents named in the task.
The user explicitly authorized Claude delegation in visible terminals after the handoff. That supersedes old solo/planning-only statements. Do not spawn agents yourself.
You are not alone in this shared repository. Respect other edits and your ownership boundaries. Do not revert other work. Do not commit, change dependencies/settings, install packages, or touch files outside the repository.
Only file tools are provided. The manager runs tests, builds, squad messages and git operations. Say which commands need running; NEVER claim tests ran. Evidence tags are required: [UNVERIFIED] for new unchecked code; [PROXY] for static review, [RAN] only for real output you executed/read, [SAW] only for inspected actual image.
Read-only inspector: never change any file. Worker: edit only explicitly assigned paths. Preserve v1.
Use erasable TypeScript (no parameter properties) and native node:test with node:assert/strict; do not add test packages. Core/model code has no DOM, React or Three dependencies. No network or external downloads.
Report blockers directly with BLOCKED: and the exact missing requirement. Do not improvise incompatible contracts.
TASK: $title
$body
End with a concise summary, changed files (or findings with lines), required checks and remaining limitations. Inspector ends with VERDICT: PASS or VERDICT: FAIL plus reasons. Passing static review is [PROXY], not visual acceptance.
"@
      $prefix = Join-Path $logDir "$Id-$taskId"
      $prompt | Set-Content -LiteralPath "$prefix.prompt.txt"
      $toolSet = if ($Role -eq 'inspector') { 'Read,Glob,Grep' } else { 'Read,Edit,Write,Glob,Grep' }
      $mode = if ($Role -eq 'inspector') { 'default' } else { 'acceptEdits' }
      $claudeArgs = @('-p','--model',$Model,'--restricted','--tools',$toolSet,'--permission-mode',$mode,'--permission-prompts','none','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--output-format','stream-json','--verbose')
      $script:engineResult = $null
      $script:latestText = ''
      $prompt | & $Claude @claudeArgs 2>&1 | ForEach-Object {
        $raw = $_.ToString()
        Add-Content -LiteralPath "$prefix.events.jsonl" -Value $raw
        try { $event = $raw | ConvertFrom-Json } catch { Say $raw; return }
        if ($event.type -eq 'system' -and $event.subtype -eq 'init') { Say "Connected to Claude; model=$($event.model), session=$($event.session_id)" }
        if ($event.type -eq 'assistant') {
          foreach ($part in $event.message.content) {
            if ($part.type -eq 'text') { $script:latestText = $part.text; Say $part.text }
            if ($part.type -eq 'tool_use') {
              $location = if ($part.input.file_path) { $part.input.file_path } elseif ($part.input.path) { $part.input.path } else { $part.input.pattern }
              Say "$($part.name): $location"
            }
          }
        }
        if ($event.type -eq 'result') { $script:engineResult = $event }
      }
      $engineExit = $LASTEXITCODE
      $report = if ($script:engineResult.result) { $script:engineResult.result } else { $script:latestText }
      $report | Set-Content -LiteralPath "$prefix.result.md"
      $failed = $engineExit -ne 0 -or -not $script:engineResult -or $script:engineResult.is_error -or -not $report -or $report -match '(?m)^BLOCKED:'
      if ($failed) {
        $problem = "BLOCKED: $Id task $taskId; Claude exit=$engineExit; inspect $prefix.result.md and .events.jsonl. $report"
        if ($problem.Length -gt 6000) { $problem = $problem.Substring(0,6000) }
        SquadCall @('send','--task-id',$taskId,$Id,$Manager,$problem) | Out-Null
        Say 'Task blocked; left acknowledged for manager review.'
      } else {
        $summary = "[UNVERIFIED implementation / PROXY review] Report: $prefix.result.md`n$report"
        if ($summary.Length -gt 12000) { $summary = $summary.Substring(0,12000) }
        SquadCall @('task','complete',$Id,$taskId,'--summary',$summary) | Out-Null
        SquadCall @('send','--task-id',$taskId,$Id,$Manager,$summary) | Out-Null
        Say 'Task response delivered; waiting for manager review or follow-up.'
      }
    }
  }
  SquadCall @('leave',$Id) | Out-Null
  Say 'Stopped after finishing the current task.'
} catch {
  $failure = "BLOCKED: $Id launcher error: $($_.Exception.Message)"
  Say $failure
  & $Squad send $Id $Manager $failure 2>&1 | Out-Null
  throw
}




