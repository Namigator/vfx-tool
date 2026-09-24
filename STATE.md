# STATE — VFX Tool

**Goal:** Simple expandable-node VFX/SFX authoring with original-lightning quality, ten rich editable spell defaults and future engine-independent export inputs.

## Now
- [RAN] Full planning handoff preserved at docs/v2-plan/00-START-HERE.md; historical planning audit passed. Git baseline 02c883d preserves v1; branch squad/vfx-v2.
- User explicitly requested Claude delegation via squad in visible terminals. This supersedes the plan snapshot solo/planning-only instructions. No nested agents.
- Default model: Claude Opus5.5 (claude-opus-5-5), LOW effort. User allows justified per-task increases. Final WP01a reviewer used MEDIUM after low reviews skipped assigned files; now reset to LOW. Worker stayed LOW.
- [RAN] WP01a implemented: types, parameter validation, semantic canonical serialization/hash, structural fixture, 22 new tests. All 68 tests pass; latest TypeScript check passes.
- [PROXY] Claude final review accepts WP01a only. Evidence and remaining limitations: evidence/wp01a/README.md. This does not complete WP01 or prove any visuals.
- [RAN] No existing app/render/audio/preset code or dependencies changed. No new third-party package installed.
- WP00 partial: source/reference preserved and baseline checks pass; full-cycle original clip/GPU/dependency vetting remain pending.

- [SAW] Existing v1 app launched on http://127.0.0.1:5174 and lightning preview inspected in browser; tab left playing for user testing. Server PID16300; logs work/dev-server.*.log. This is not v2 visual acceptance.
- [RAN] WP01b: document validation, parameter/control resolution and nested Group overrides implemented; 108 total tests pass, TypeScript exits0. [PROXY] independent LOW reviewer accepted corrected slice; evidence/wp01b/. All three visible Claude terminals idle, default Opus5.5 LOW. Contract: docs/implementation/WP01B-WORKER-CONTRACT.md.

## Next (in order)
1. Finish WP01 readiness: production registry/parameter metadata and runnable fixtures, remaining T01/T05/T06/T07 coverage; reconcile typed asset ports and interface defaults before WP02 compiler. Do not treat WP01b as full WP01.
2. Complete WP00 reference capture/environment evidence before renderer acceptance; proceed to WP02 compiler when WP01 contracts/tests pass.
3. Follow remaining packages through lightning parity WP10-WP12 before other effect families.

## Known failed / unverified
- [UNVERIFIED by agent; user-reported] v1 fire/water/shadow unacceptable; v1 lightning below original.
- [SAW] Archived original PNG depicts charging only, not discharge.
- [UNVERIFIED] v2 editor/renderer/audio/performance not implemented or accepted. Actual GPU unknown.
- [PROXY] Follow-ups: inherited value diagnostic text/code, role-specific asset ports, interface default typing, nonenum choices, unreachable-graph warning paths, default asset references/availability (WP05). Model fixture remains structural, not runnable F01. Pipeline requires validateDocument then resolveParameters before compiler.
- [UNVERIFIED] Unity/Roblox/Unreal exporters remain outside this phase.

## Environment
- Everything under F:/Dev2/VFX-Tool; F writes require appropriate Codex permission. Node 24.3.0, erasable TS only.
- Existing editor 5174; original lightning 5173. Approved React/Three/TypeScript/Vite; new @xyflow/react/fflate require approval.
- Tests: node --experimental-strip-types --test tests/*.test.ts
- Types/build: node node_modules/typescript/bin/tsc --noEmit; node node_modules/vite/bin/vite.js build
- Squad F:/Dev2/squad/squad.exe; manager vfx-manager; visible Claude worker claude-model, controls worker claude-controls, reviewer claude-review. Settings/logs/resume: SQUAD.md.
- doctor/shot exist under C:/Users/itonk/.claude/tools, not the originally supplied .codex/tools paths. Doctor -Quiet completed without reported issues this session.

## Key files
- docs/v2-plan/00-START-HERE.md and19-WORK-PACKAGES.md — full design/order;20-AGENT-HANDOFF.md — evidence rules.
- docs/implementation/WP01-REPRESENTATION-DECISIONS.md — normative clarification of representations/hash/limits.
- src/model/ and tests/v2-model.test.ts — first implementation slice.
- evidence/wp01a/ — accepted-slice evidence; SQUAD.md — current agent operations.
- docs/v2-plan/references/original-lightning/ — preserved original source/audio/image.
