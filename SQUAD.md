# Claude squad implementation handoff

The user requested Claude workers through the squad skill in visible terminals. This current instruction supersedes the historical plan snapshot that said to work solo. Full design remains docs/v2-plan/00-START-HERE.md.

## Current status
[RAN] Two visible PowerShell terminals launched and both agents joined/acknowledged their tasks. Both Claude executions failed before reading/editing project files: `Failed to authenticate: OAuth session expired and could not be refreshed`. User subsequently renewed sign-in. Both wrappers were restarted and the saved tasks requeued with explicit Opus 5.5 / low effort. Inspect current logs for task outcomes.

| Agent | Role | Task |
| --- | --- | --- |
| vfx-manager | Codex coordinator | Assign, monitor, run tests, inspect results, manage Git |
| claude-model | Claude implementation | WP01a document types, parameter validation, canonical serialization, tests |
| claude-review | Claude read-only inspector | Contract readiness review, then separate implementation review |

Task IDs:
- worker: 79eae6a7-05a9-4e77-9091-9fbf1b9387de
- inspector: 0eb4eb5a-057f-417f-81a5-e71f17911acd

Both initial tasks submitted responses. Initial worker checks: 11 passing tests, TypeScript failed on the Web Crypto input type. Worker rework task: 07f9aea0-f2b7-4469-9899-91b02f976aa8. Contract clarification review 45a75cac-f516-4f18-9712-bafd75108b51 returned PASS [PROXY]; separate code review still required. Full assignment text is preserved at evidence/squad/first-wave-tasks.txt. Model is explicitly pinned to `claude-opus-5-5`; process-local `CLAUDE_CODE_EFFORT_LEVEL=low` is set before invoking Claude. The user permits higher effort for specific tasks when justified; explain any change and record it. This uses the official environment override: https://code.claude.com/docs/en/model-config#adjust-effort-level. Global Claude settings are untouched.

## Sign in and resume
Use the visible login terminal opened by the manager, or run `Start-ClaudeLogin.ps1` from this project. Complete the Anthropic sign-in yourself; never paste tokens or credentials into this chat or project files.

After login, the manager checks `squad agents` and the two terminal processes. If they are still listening, requeue the existing tasks (do not create duplicate tasks):

```powershell
squad task requeue 79eae6a7-05a9-4e77-9091-9fbf1b9387de --to claude-model
squad task requeue 0eb4eb5a-057f-417f-81a5-e71f17911acd --to claude-review
squad send --task-id 79eae6a7-05a9-4e77-9091-9fbf1b9387de vfx-manager claude-model RESUME_SAVED_TASK
squad send --task-id 0eb4eb5a-057f-417f-81a5-e71f17911acd vfx-manager claude-review RESUME_SAVED_TASK
squad receive vfx-manager --wait --timeout 30 --json
```

This squad version changes task state on requeue without notifying the worker, so the explicit RESUME_SAVED_TASK messages above are required. The wrapper loads the saved assignment and acknowledges the existing task. Run these from F:/Dev2/VFX-Tool. If a wrapper exited, inspect its log before relaunching; archive only its own obsolete squad identity after preserving unread messages. Do not clean all squad state. `Start-ClaudeSquad.ps1` launches both roles and refuses to duplicate a live process. For one role use the tools/squad-agent.ps1 parameters in a visible PowerShell window.

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
