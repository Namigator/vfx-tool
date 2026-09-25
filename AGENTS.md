# VFX Tool agent instructions

## Current authority (2026-09-24)
The user has authorized implementation and specifically requested Claude agents through the squad skill in visible terminals. This supersedes the planning snapshot's solo/planning-only instructions. Codex coordinates; Claude terminal workers implement assigned packages and Claude inspectors review them. Do not spawn nested agents. The full plan is docs/v2-plan/00-START-HERE.md.

## Claude model preference
Use Opus 5.5 (`claude-opus-5-5`) at low effort by default. The user permits a higher level for a specific task if justified; explain and record each increase. Do not silently change the global default. Low effort never permits skipping explicitly assigned files or checks.

## Boundaries
- Work only in assigned files under this project. You are not alone: preserve other agents' edits. Keep v1 usable.
- User authorizes installing needed packages ONLY after an inspector vets exact package/dependency provenance, license, source, and hooks. Existing React/Three/TypeScript/Vite approved. Manager collects source without executing it; inspector reports acceptance before installation. No repeated permission request needed after PASS.
- Do not commit, switch branches, or stage other agents' changes. Manager owns Git checkpoints and test execution.
- Native Node tests, erasable TypeScript, no DOM/React/Three in pure model/runtime contracts.
- Every claim carries evidence: [UNVERIFIED] unchecked changes; [PROXY] static/indirect evidence; [RAN] real executed output; [SAW] actual user-visible capture inspected. Tests do not establish visual quality. Never claim unrun tests passed.
- Inspect actual visual output for visual acceptance; never weaken the original lightning quality gate. Full reference capture is still pending.
- Read STATE.md and only the relevant specifications. Report blockers with exact evidence rather than guessing repeatedly.

## Squad Collaboration
Use squad help for supported syntax. Manager ID: vfx-manager. Claude wrappers handle join/receive/ack/report; agents need not run these commands. Manager monitors results and assigns bounded follow-ups. See SQUAD.md for launch, logs and stop instructions.

## Reporting cadence
User requests report-driven coordination. Wait for completion reports; only check a worker for a stall after ten minutes without a report. Do not repeatedly poll its logs/status.

