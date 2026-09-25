# Claude squad implementation handoff

The user requested Claude workers through the squad skill in visible terminals. This current instruction supersedes the historical plan snapshot that said to work solo. Full design remains docs/v2-plan/00-START-HERE.md.

## Completed WP01b wave
- Document worker: claude-model, task e9a706c2-f7fc-4119-8a0a-07194571e8f8.
- Controls worker: claude-controls, task c256b71b-048f-4346-a9eb-6e7e9930b657.
- [RAN] 108 total tests and TypeScript pass; final review accepted slice [PROXY], see evidence/wp01b/. Workers/reviewer now idle. All Opus5.5 LOW, visible terminals; no nested agents. Shared-file ownership remains with manager. Read docs/implementation/WP01B-WORKER-CONTRACT.md.
- Existing v1 editor is running at http://127.0.0.1:5174 for user testing. WP01b is not connected to that UI yet.

## Current status
[RAN] After machine restart, all three visible Claude terminals were recreated and saved tasks recovered. Checkpoint 962a7ed has 170 passing tests and TypeScript exit0; bounded graph-analysis review passed [PROXY]. STATE.md records current task IDs. All current agents use Opus5.5 LOW. Historical WP01a review used MEDIUM, then returned to LOW. Inspector now uses default permission mode with Read/Glob/Grep only, because plan mode demanded unavailable plan-file tools.

| Agent | Role | Task |
| --- | --- | --- |
| vfx-manager | Codex coordinator | Assign, monitor, run tests, inspect results, manage Git |
| claude-model | Claude implementation | WP01a document types, parameter validation, canonical serialization, tests |
| claude-review | Claude read-only inspector | Independent code review after each scoped slice |
| claude-controls | Claude implementation | WP01b controls.ts and tests/v2-controls.test.ts |

Task IDs:
- worker: 79eae6a7-05a9-4e77-9091-9fbf1b9387de
- inspector: 0eb4eb5a-057f-417f-81a5-e71f17911acd

All first-wave tasks and corrections have submitted results; do not requeue completed work. Model is pinned to claude-opus-5-5 and process-local CLAUDE_CODE_EFFORT_LEVEL defaults to low. User permits announced, justified per-task increases. Global Claude settings remain untouched. Official configuration: https://code.claude.com/docs/en/model-config#adjust-effort-level.

## Historical sign-in recovery (do not rerun completed tasks)
Use the visible login terminal opened by the manager, or run `Start-ClaudeLogin.ps1` from this project. Complete the Anthropic sign-in yourself; never paste tokens or credentials into this chat or project files.

After login, the manager checks `squad agents` and the two terminal processes. If they are still listening, requeue the existing tasks (do not create duplicate tasks):

```powershell
squad task requeue 79eae6a7-05a9-4e77-9091-9fbf1b9387de --to claude-model
squad task requeue 0eb4eb5a-057f-417f-81a5-e71f17911acd --to claude-review
squad send --task-id 79eae6a7-05a9-4e77-9091-9fbf1b9387de vfx-manager claude-model RESUME_SAVED_TASK
squad send --task-id 0eb4eb5a-057f-417f-81a5-e71f17911acd vfx-manager claude-review RESUME_SAVED_TASK
squad receive vfx-manager --wait --timeout 30 --json
```

This squad version changes task state on requeue without notifying the worker, so the explicit RESUME_SAVED_TASK messages above are required. The wrapper loads the saved assignment and acknowledges the existing task. Run these from F:/Dev2/VFX-Tool. If a wrapper exited, inspect its log before relaunching; archive only its own obsolete squad identity after preserving unread messages. Do not clean all squad state. `Start-ClaudeSquad.ps1` launches the two workers and inspector and refuses to duplicate a live process. For one role use the tools/squad-agent.ps1 parameters in a visible PowerShell window.

## Launcher design and provenance
Adapted from the already installed C:/Users/itonk/.claude/tools/squad/agent-loop.ps1 and squad-up.ps1. Original tools default Claude to read-only and auto-stage/commit all changes; this project version provides an editing worker and a read-only reviewer, leaves commits to the manager, records errors without completing failed tasks, and uses the correct manager ID.

- tools/squad-agent.ps1: joins, immediately receives, acknowledges, invokes Claude, reports and returns to receive.
- Start-ClaudeSquad.ps1: opens visible PowerShell windows, as explicitly requested.
- Installed Claude: C:/Users/itonk/AppData/Roaming/Claude/claude-code/2.1.280/claude.exe (signature checked: Valid, Anthropic, PBC).
- Squad: F:/Dev2/squad/squad.exe.
- Claude restricted file-tool mode; workers Read/Edit/Write/Glob/Grep, inspector Read/Glob/Grep. No shell/network/MCP/nested-agent tools, no permission bypass. Manager runs the already approved tests/builds.
- No new third-party dependency installed. Existing package approvals still apply; new dependencies require user approval.
- CLI task completion means an agent submitted a response, not manager acceptance. Code needs executed checks and inspector review; visual work also needs actual captures and artistic gates.

## Monitoring and stopping
Logs: .squad/logs/<agent>.log, per-task .events.jsonl and .result.md. Process records: .squad/logs/<agent>.process.json. These are local, Git-ignored. No authentication output is logged by the login helper.

Use `squad agents`, `squad task list` and `squad receive vfx-manager --wait --timeout 30 --json`. Check logs/processes before treating a busy engine with an old heartbeat as dead. On failure report immediately and do not loop blindly.

For a graceful stop, create .squad/logs/claude-model.stop and/or claude-review.stop; the wrapper finishes its current task then exits the receive loop and archives its own identity. The visible window remains open. Remove only those stop files before intentionally restarting. Do not terminate unrelated Claude sessions.

## First-slice acceptance
WP01a is only contracts, parameter validation and serialization; full document validation/reference checking and T05 resolution remain WP01b. WP00 full original-lightning clip, GPU evidence and dependency vetting remain pending. No visual gate is passed.

Manager executes targeted Node tests, TypeScript checks and relevant regression checks, forwards concrete output to the worker, and obtains a separate code review. Record outcomes in STATE.md and evidence; do not claim the new editor exists yet.

## Recovery and package policy (2026-09-25)
- User authorizes new packages only after a Claude inspector vets their exact source, provenance, licenses, dependencies and hooks. Current downloaded evidence: work/package-vetting/index.json; nothing installed yet.
- Wait for completion reports. Only check worker status/logs after ten minutes without a report. Startup/error recovery checks are separate from work-progress polling.
- Claude auto-updated to 2.1.281; Authenticode signature Valid, Anthropic PBC. Launcher default updated. If an installed version disappears, inspect and verify the replacement before changing the path.
- squad leave archives the agent AND clears assigned tasks. Recovery order: stop only the identified failed terminal, leave, launch visible, wait for registration, task requeue TASK --to AGENT, then send --task-id TASK vfx-manager AGENT RESUME_SAVED_TASK. Do not requeue before leave or before registration. A task requeue does not itself deliver the saved prompt.
- SQLite lock errors are transient: SquadCall now has four bounded attempts for that error only. Other failures still report immediately.
- Current assignments: preview f56018bf-cdaa-4f71-a45e-84cd0bb52cfc; runtime/adapter review b29336b4-8fdb-4302-b59b-cd7a0b64e833; history 89754809-a5bf-4b54-ba4e-3de336a48575; package vet 2ca2d42b-5a34-4493-b598-dc0b75298f90.
`nFor a failed wrapper whose squad registration is still active, stop the exact failed terminal and restart squad-agent.ps1 with -ResumeExistingRegistration. Do not leave/requeue: that changes leases and can race preserved inbox messages. The switch is manager-only recovery, never used concurrently with a live wrapper.
