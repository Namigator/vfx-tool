# STATE — VFX Tool

**Goal:** A simple composable web VFX/SFX node tool with ten editable elemental defaults, original-lightning quality floor, and engine-neutral future exporters.

## Direction (user decision 2026-09-26) — tool first, presets second
- Stop polishing individual effects feature-by-feature. Build **generic, reusable building blocks** first; presets are assembled from them afterwards, never hand-special-cased.
- Ease of use is the product. This is the plan's own Simple view + component templates + published knobs (01, 12) — not a new concept; the failure was execution order (see 27-GAP-AUDIT). Reusable **layer types** (e.g. Flame jet, Smoke, Sparks, Glow, Bolt, Ring) that expose their own big knobs (reach, spread, turbulence, lift, size, heat colour, density), sitting on top of the node graph (graph stays as "advanced"). Per-preset published controls alone are not enough.
- Ship a **bundled sprite/flipbook library** shared by all effects (flame tongues, smoke puffs, sparks/streaks, soft glows, arcs, splashes…), generated procedurally (no licensing) and bakeable to image files; allow user import.
- **Acceptance test for "tool finished":** hand the tool to a model (fresh session, no code access, graph/layer UI only) and have it build a good-looking effect — first target: match `docs/v2-plan/references/standalone-flamethrower/flamethrower.html`. Every gap it hits becomes a new generic node/layer feature, then repeat.
- Quality bars: `docs/v2-plan/references/original-lightning/lightning-arc.html` (lightning) and `docs/v2-plan/references/standalone-flamethrower/flamethrower.html` (fire; open via `http://127.0.0.1:5174/docs/v2-plan/references/standalone-flamethrower/flamethrower.html`, `?t=<sec>` freezes a frame). Flamethrower is a standalone canvas2D demo — 4 layers (core, tongues, embers, smoke) + light + synthesized audio, 8 procedural flame shapes × 12 frames; tuned above 02-FIRE spec (tongues 420/s, cone 6°). [SAW] still frames in the in-app browser only; audio not listened to.

## User rules (2026-09-27)
- User is a non-engineer (visual/sound feedback only). Decide technical questions; ask only visual questions with exact steps.
- Libraries: add without asking if vetted (publisher, license, adoption, deps, install scripts, source scan); else a vettable alternative; else build.
- If the user states an architecture direction: say once if I disagree; once decided it is final.
- SOUND IS PARKED ("ignore the sounds for now"): no audio work, no listening asks; keep existing audio compiling.

## Now (2026-09-27 overnight session)
- Working through docs/v2-plan/27-GAP-AUDIT.md; every item: runtime/compiler + tests + an MCP recipe rendered with vfx_render_frames and looked at. 484 tests + tsc pass — now 511 (gate: tsc && tests before every commit).
- Landed since the audit: emitter shapes/speed/aim; Gravity, Drag, NoiseForce, Attract, Vortex, GroundCollision; colour/size/opacity over life, spin, velocity stretch + pivot, worldAxis alignment; textured flipbooks (library to 10-ASSETS); ParticleEvents child emission; ParticleTrail, MotionTrail, SpriteRenderer, PointLight, MeshRenderer (procedural rocks/shards); PathFollower (projectiles), HelixPath, PathTransform; rateOverWindow; value nodes RandomRange/Constant/ScalarMath (per-instance unit, chainable, once per cast); EventDelay + MergeEvents (emitter, presentation and audio triggers); Emitter.inheritVelocity; ScreenFlash + CameraImpulse (reduced-motion aware); textured ribbons; bloom + ACES; light/dark arena; AudioEnvelope + AudioFilter, repeat-schedule audio, AV-synced Play/Loop; persistence slice; 48 components with knobs and layered SFX (Add component + Controls panel); MCP with 25 tools incl. headless frames, texture import and .vfxpack export/open.
- Evidence recipes: mcp/examples/*.steps.json (run: node mcp/run-steps.mjs <file>; frames land in work/mcp/frames/). Components are generated from them: node tools/build-components.mjs.
- AV sync: editor Play/Restart start the mix at the current tick (800 samples/tick), Pause/scrub stop it; Sound on/off toggle. [RAN] status in browser; not listened to.
- Open for the user: L01 lightning now blooms into a wide haze (emission tuned pre-bloom); water realism backlog; flame look still slightly scaly vs standalone reference.

## MCP (agent tooling)
- .mcp.json registers server `vfx` → node --experimental-strip-types --no-warnings mcp/vfx-mcp.ts (loads in a NEW Claude Code session). Tools: vfx_list_node_types, vfx_describe_node_type, vfx_new_document (blank/f01/forces/lightning/lightning-audio), vfx_open/save/get/set_document, vfx_set_anchor, vfx_add/remove_node, vfx_set_params, vfx_connect/disconnect, vfx_compile, vfx_sample_particles, vfx_render_audio, vfx_preview_url, vfx_list_components, vfx_add_component, vfx_list_controls, vfx_set_control, vfx_render_frames (PNG via headless Chrome → /capture.html?doc=…&tick=…[&glow=0]; needs the vite dev server; frames in work/mcp/frames/).
- Deps: @modelcontextprotocol/sdk 1.30.1, zod 4.6.5 (user-approved 2026-09-26); fflate 0.8.3 (vetted 2026-09-27, see 27-GAP-AUDIT I11; npm install crashes with ERESOLVE here, so it was placed from the checksum-verified tarball). [RAN] tests/v2-mcp.test.ts.

## Rendering
- HDR composer + UnrealBloom (08 defaults .8/.45/1.0) + ACES/sRGB OutputPass; background via scene.background (renderer clear colour double-encoded through the composer). Glow toggle in the transport.

## Standing rule: MCP parity (user, 2026-09-28)
Every editor function must also exist as an MCP tool (33 tools). Editor → MCP map: New/Open/Save/Export pack/Open pack
→ vfx_new/open/save_document, vfx_export_pack, vfx_open_pack; Projects list → vfx_list_documents; Undo/Redo → vfx_undo/redo;
Add node/remove/connect/disconnect/inspector/enable/rename → vfx_add/remove_node, vfx_connect/disconnect, vfx_set_params;
drag node → vfx_move_node; Add component (built-in + My components) → vfx_list/add_component; Group selection →
vfx_group_nodes; Save as my component / delete → vfx_save_group_component, vfx_delete_user_component; knobs (number,
colour, vector) → vfx_list/set_control; anchors → vfx_set_anchor; duration/seed/name → vfx_set_document; import texture /
3D model (+scale) → vfx_import_texture/mesh; Play/scrub/glow/light arena → vfx_render_frames (glow, background);
sound → vfx_render_audio; diagnostics, travel readout, tail warning → vfx_compile; particle inspection → vfx_sample_particles.
Browser-only by nature: two-tab conflict banner, trash (MCP documents are files), import previews (MCP import reports
size/triangles/validation directly). MCP user components live in work/mcp/user-components.json (editor: browser storage).

## Session 2026-09-28 (user away: "cant test rn, please implement")
- Done: Light (09) + Energy (10) families; trails fade only at the tail (head solid); non-number knobs (colour picker commits on close,
  vector fields, checkbox, dropdown) + axis bindings (a number knob drives one axis of a vec2/vec3); Energy knobs Arc bend, Accent colour,
  Speed; PathFollower speed mode (travel = path length ÷ speed, rounded ticks; all compilers agree) + "Projectile travel" readout.
- Also done: GLB Imported size fit|real (import scale applied); Material rim (meshes: fresnel; sprites: radial);
  sprite UV tiling/offset/rotation/scroll; Group selection (Shift+click → wrap into a Group); project Trash; two-tab
  draft compare-and-swap with stale-tab banner. Gate: 524 tests + tsc.
- Also done: duration tails (components include their tails; warning when the effect is too short); texture import
  preview with flipbook grid (+ fixed a crash typing in Grid); projects/trash in IndexedDB (migrated, merged).
- Decided: worker simulation stays deferred (measured < 1 ms/tick avg, ≤ 4.5 ms worst vs 16 ms frame).
- Also done: GLB preview before import (picture, size in metres, triangle count).
- Also done: Save group as my component (A-05 part 2 [RAN]: insert twice, edit one, other unchanged); MCP parity tools
  (group nodes, user components, undo/redo, list documents, move node, travel + tail warning in compile). 530 tests.
- A-05 part 1 RUNNING (2026-09-28, user chose option 1): a fresh agent limited to mcp__vfx__* tools (no source, no
  components) builds the flamethrower from blank; reference frames in work/a05/ref-t*.png (captured from the in-app
  browser: headless Chrome can't draw that canvas). Output: work/a05/a05.vfx.json + a gap log → each gap becomes a
  generic node/control, then rerun. Passing needs the user's visual OK.
- A-05 run 1 done: fresh MCP-only agent built work/a05/a05.vfx.json (core, tongues, embers, smoke, light, flash/shake).
  [SAW] glow off = decent structure; glow on = halo swallowed the flame. Gap log → fixed: (1) EffectOutput glow
  strength/radius/threshold/limit (limit caps stacked additive brightness); (2) PropMesh node + cylinder/box meshes;
  (3) vfx_compile lists flash/shake/light ticks; (4) fire-puff flipbook. Next: rerun A-05 with a fresh agent.
- 2026-09-28 ~17:40: a stray Codex desktop app session (user did not start it; killed with user OK) edited src/render (ribbon end-fade moved into the shader, RibbonGeometry +
  PreviewViewport); its per-pixel end fade was kept after tests + renders (commit after d256cb6).
- A-05 run 2 INVALID: the vfx MCP server process was started before the fixes (26/33 tools, no PropMesh/glow), so
  the agent re-reported fixed gaps. Fix: .mcp.json now runs mcp/vfx-mcp-reload.mjs (restarts the server on src/mcp
  changes, replays the handshake, documents reopen from work/mcp mirrors) — needs ONE user reconnect of "vfx" to take
  effect, then rerun A-05 (run 3). Also documented Emitter coneAngle/space.
- A-05 run 3 (fresh server, 2026-09-28): [SAW] nozzle prop, controlled glow, jagged turbulent flame, embers; still redder,
  shorter jet, faint smoke vs reference. Gaps fixed: PropMesh Direction; Emitter burst/rate guidance; render_frames
  now reports lit/bright coverage + glow-flood warning. Run 4 launched (doc a05d). Frames sent to user for a look.
- A-05 run 4: T-nozzle ok, glow controlled, but flame = scattered red blobs. [SAW] my own fire-jet (same tool) makes a
  continuous jet -> capability exists, know-how missing -> added MCP vfx_guide (recipes per element). Run 5 launched
  (doc a05e) with the guide. Also: PropMesh pivot wording; MCP reload wrapper backs off on crash.
- A-05 run 5 (with vfx_guide): [SAW] long continuous orange jet, hot core, ember trails, lingering smoke, floor light,
  nozzle; agent found NO capability gap, only rough edges (fixed: PropMesh pivot start, trail material note, guide core
  values). Doc work/a05/a05e.vfx.json. AWAITING USER VISUAL VERDICT (ref-t*.png vs a05e-t*.png) = A-05 pass/fail.
- Ceiling test (user: "tool issue or model issue?"): tools/make-flamethrower-recipe.mjs ports the standalone layer by
  layer onto tool nodes. [SAW] at the reference camera it matches the burn shape/reach/cooling colours, ignition and
  the smoke+ember decay closely -> the gap was mostly know-how. Fire guide rewritten with these values. Added: matched
  camera (vfx_render_frames camera, capture cam/look/fov). ref-t0.35.png was black (canvas resize) - recaptured.
  Remaining visible differences: scene dressing (arena), nozzle heat glow, slightly streakier tongues.
- 2026-09-29: "Fire: flamethrower" component (49 components; knobs jet length, width, density, smoke, embers, burn
  time), tuned to look right under DEFAULT glow (components cannot carry EffectOutput glow). A-05 run 6 launched
  (doc a05f, reference camera, updated fire guide). Codex desktop app is running again (not ours) - watch for edits.
- Commit gate is now `bash tools/gate.sh && git commit ...` (tsc + fresh test log; a stale-log slip committed a broken
  file once, fixed in 03fcb35).
- Left: sound (parked); user visual review of all families; merge to main after visual OK.
- User visual review still pending for every family (they could not test today).

## Next (as of 2026-09-27 night)
All ten element families (effects/01..10) are built as components (3 variants each via tools/make-<family>-recipe.mjs, 48 components total),
each with [SAW] headless frames. Next: (a) visual review with the user, family by family, in the editor (Add component → Play);
(b) remaining small floor items below; (c) A-05 model-build test and the full testing pass; (d) merge squad/vfx-v2 → main only after the user's visual OK.
Capability floor (27-GAP-AUDIT) is essentially done: value nodes, event routing, force strength/oscillator, ParticlePaths, OffsetAnchor, PublicParameter,
presentation, seek checkpoints, texture + GLB import, .vfxpack (fflate), project shelf, draft recovery, grouped components with Start at, ground fade,
dissolve, ribbon UV scroll/distortion. Remaining small floor items: worker simulation (deferred: no visible benefit yet), multi-tab CAS + trash,
wrap-selection-as-group, rim, sprite UV ops (non-number knobs done 2026-09-28; depth soft intersection was done 2026-09-27).
1. (Done 2026-09-27) WP10+ element families 01..10. Build every look from generic nodes/components; get the user's VISUAL feedback per family (they only judge visuals; sound is parked).
2. Known visual issues from the user: L01 wide bloom haze; flame slightly scaly vs standalone reference.
3. A-05 model-build test only after everything is implemented (user decision).
Sprite library: `node tools/bake-sprites.mjs` → assets/sprites/ (flame-tongue-a/b, smoke-puff, foam flipbooks 4×4/256; soft-glow, spark-streak, electric-arc, droplet, ripple-ring 2×2; dissolve-noise) + src/assets/builtinSprites.generated.ts; preview /assets/sprites/preview.html.

## Known limits
- [SAW] L01 charge core/halo grows during ticks0-24, bolt appears over ticks24-26 and impact follows at ticks26-38. The bolt holds broadly static through tick62; charge motes, moving sparks, ring/light, synchronized sound and original ARC quality are still missing.
- [SAW] Large blue shards and black corner gaps improved after round join rewrite; tight bends retain small bright overlaps. No whole-cycle visual acceptance yet.
- [UNVERIFIED] Graph-node drag remains inconclusive under single-step browser drag. No full browser lifecycle automation.
- [PROXY] Mixed billboard+ribbon preview works in current browser, but width shaping, textured UVs and parallel transport unsupported. EffectTimeCurve drives only RevealPath.fraction. Billboard life curves are renderer parameters, not graph-driven signals. AudioMix supports one level and one final limiter, not nested mixes. Invalid root audio blocks the whole preview. Playback uses Web Audio but actual listening/download remains unchecked. Persistence, ten complete presets and exporters remain pending.

## Backlog (not scheduled)
- **Realistic water material (Three.js):** move the water look into the tool's renderer — refraction of the scene behind, fresnel/environment reflection, animated normal-map surface, lit textured floor + environment map for something to reflect/refract, caustics. Canvas2D reference `docs/v2-plan/references/standalone-water/water.html` (TIDE) is at its ceiling; user verdict 2026-09-26: "looks computer generated". Matches 03-WATER.md SurfaceTranslucent.
- **Sim-rendered sprites via Blender:** render splash crown, droplets, foam, spray from real fluid sims into flipbooks for the sprite library (blender MCP exists; needs Blender running).
- TIDE physics notes already applied: specular = single half-vector line on the tube; instability grows with distance from source (Plateau–Rayleigh), width ∝ 1/sqrt(speed); ripples only on standing water.

## Environment
- Root `F:/Dev2/VFX-Tool`; v2 `http://127.0.0.1:5174/?workspace=v2`, v1 `/`. Vite PID in `work/dev-server.pid`; doctor/shot `C:/Users/itonk/.claude/tools/`.
- F writes/Git/squad usually require escalation. A one-turn direct F write grant was supplied after auto-review hit its usage limit; it may not persist. Git metadata rejects sandbox-user writes to `.git/index.lock`; unsandboxed escalation worked once the approval service recovered. Approved deps ReactFlow12.12.0+19 vetted transitives; any NEW package needs inspector vet before install/run.
- Checks: `node --experimental-strip-types --test tests/*.test.ts`; `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/vite/bin/vite.js build` (build needs escalation for dist write).
- Squad manager `vfx-manager`, `F:/Dev2/squad/squad.exe receive vfx-manager --wait --timeout 45 --json`; `SQUAD.md` has recovery. No broad process cleanup.

## Key files
- Full plan `docs/v2-plan/00-START-HERE.md`; lightning benchmark `docs/v2-plan/effects/01-LIGHTNING.md`.
- `src/graph/registry.ts`, `toPaths.ts`, `toParticles.ts`, `fixtures.ts` — node definitions, preview compilers and F01/L01.
- `src/runtime/paths.ts`, `branches.ts`, `curves.ts`; `src/render/PreviewViewport.ts`, `RibbonGeometry.ts`, `pathView.ts`, `previewMode.ts`, `billboardLife.ts`, `layerOrder.ts`; `src/PreviewV2.tsx`. Mixed preview/life handoff: `docs/implementation/WP03-MIXED-BILLBOARD-LIFE.md`.
- `src/audio/synthesis.ts`, `mix.ts`, `wav.ts`, `transport.ts`, `src/graph/toAudio.ts`, `audioFixtures.ts`, `docs/v2-plan/24-ALGORITHMS.md` Amendments A1/A2/A3 and `docs/implementation/WP04-AUDIO-CORE.md`.

## Session checkpoint — 2026-09-27
- [RAN] Full suite: 459 passed, 0 failed; TypeScript `--noEmit` exited 0; production build completed. Existing warnings: React Flow `use client` directive and OrbitControls chunk >500 kB.
- [SAW] Timeline-wide camera framing captures the effect in bounds at tick 26; at tick 119 the browser UI reports `1 particles + paths` but the ring is no longer visible. At tick 60 the bolt is visible, while the ripple is too small/faint to judge confidently in the narrow in-app viewport. Ring seam/quality is still open; the prior desktop capture at tick 60 showed the full ring inside the frame but small.
- [RAN] Doctor preflight clean; Vite 5174 listening; no packages installed.
- Claude Opus 5.5 LOW tasks assigned to visible workers: `d748e2b1-20f4-4ea4-9dea-cf6bc1164de5` (generic ribbon joins/length fade) and `39de94e1-c95d-4bcd-8354-b69e3c1c05ae` (read-only audio mix/WAV review). Await reports; do not poll. New terminals use `claude-model-2`, `claude-review-2`; coordinator is `vfx-manager-2` because old IDs remain in squad history.
- Next: finish the wide ring lifecycle visual check; receive worker reports; run targeted/full regressions for any change; inspect the browser again; then update this state and checkpoint.
- Squad recovery note: the first launch hit identity conflicts (`ID already occupied`); the project’s exact-registration resume option restarted only `claude-model-2` and `claude-review-2` in visible terminals. [RAN] `claude-model-2` received its assigned task at 00:27 local. This confirms dispatch, not that the Anthropic spend limit has cleared; no worker result yet.
