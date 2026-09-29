# STATE — VFX Tool

**Goal:** A simple composable web VFX/SFX node tool with ten editable elemental defaults, original-lightning quality floor, and engine-neutral future exporters.

## CURRENT — 2026-09-29, end of the "finish everything in the mds" pass (read this first)
- Branch squad/vfx-v2, not merged, not pushed. Gate: `git add …; bash tools/gate-commit.sh "msg"` (581 tests, tsc).
  After src/render changes: `node tools/render-smoke.mjs`.
- Plan status per document: `docs/v2-plan/27-GAP-AUDIT.md`, last section. T01–T40 map: `docs/v2-plan/evidence/TRACEABILITY.md`.
- Done in this pass (details in git log since 8814928):
  - Packs, colour shift, curve/gradient editors, Solo, error focus, Relink/Replace/Remove/Cleanup.
  - Emitter path shape, OverLife, RingRenderer, Curve/Gradient nodes, copy/paste/duplicate (and Preserve pattern),
    Delete and reconnect, Start on event.
  - Material templates, flipbook loop/crossfade, portability classes, hard limits, selection highlight, markers.
  - Asset library to the 10 minimum (17 sheets), normal/noise roles, plane mesh, Add to effect, flipbook preview playback.
  - Library panel (Presets/Components/Assets/My Blocks + search), Jump to driver, Retry preview, Catching up.
  - In-step ground bounce, checkpoint ceiling, conformance F05–F11 tests.
  - Gate B + Gate D evidence (120 sheets re-rendered), perf evidence (compile p95 128 ms, seek 85/5 ms, load 0.8 s).
  - README + MCP guide updated.
- Waiting on the USER: A-05 run 6 verdict (work/a05); variant approval (Gate D); whether additive effects need a
  light-arena variant (faint on light floors); visual OK before merging to main.
- [UNVERIFIED]: "Catching up" readout (hidden pane). Jump to driver [RAN] via DOM (selects the driving node).
- Before-release backlog DONE (117ad01): the graph editor is the default page (http://127.0.0.1:5174/), the old editor
  UI is removed (src/core stays only for importing old effects), the converter is "Import old effect", and a first run
  opens a blank effect with the Library. The release is just "VFX Studio" (no "v1").
- Performance pass STARTED 2026-09-29 (user's first post-release item): real-GPU fps for all 49 = 60 fps
  (evidence/perf-fps-*.md); in-editor knob edit → preview median ~100 ms, worst component median 227 ms (was ~300–500;
  evidence/perf-compile-seek-*.md). Tools: `node tools/perf-fps.mjs`, `node tools/perf-knob.mjs`, both via
  `~/.claude/tools/cdp-eval.mjs` (headless Chrome + DevTools protocol; `--gpu` real GPU, `--profile x.cpuprofile`).
  Use it instead of the in-app pane for timing: the pane is hidden/throttled (rAF ~1 Hz).
  f75cbad: parent-event run reused across the 600-tick duration check and the preview -> flamethrower edit median
  227 -> 209 ms (p max 393), all-49 median 107 ms. Next perf targets: flamethrower (209), lightning (~175 ms).
- Colour pickers (user 2026-09-29 "why not a colour picker?" -> "lets do both"): the whole-component Colour knob
  (hueShift) shows as a picker of its swatch (src/graph/recolor.ts hueShiftToward); plus one full-colour picker per part
  (Flame/Embers/Smoke & dust/Flash & rings/Light..., components.ts colourParts) via Material/PointLight
  recolorFrom->recolorTo HSV grade (shader vfxGrade; CPU for meshes/lights). MCP vfx_set_control takes "#RRGGBB" for
  Colour. [SAW] flamethrower orange->blue whole; blue flame + green smoke + blue light with orange embers; editor panel.
  Only NEW inserts get the pickers; effects saved before keep the old slider. shot url can return a blank frame
  (virtual-time flake) - retake before debugging.
- Timeline strip DONE (user order item 2): src/editor/TimelineStrip.tsx under the scrub bar, lanes from
  src/render/timeline.ts timelineLanes (component = ctl-<prefix>-start-at/-colour-shift, longest-prefix node match).
  Drag bar = Start at, right-edge handle = length knob (tick knob bound to durationTicks: only 8 components have one),
  click = select Group, empty track = seek. MCP vfx_list_timeline. [SAW] 3 lanes; [RAN] browser drag 90->12, stretch
  Travel 36->87, click selects. Note: a bar shows the VISIBLE span, so the bolt's bar doesn't grow with Travel (its
  trail tail already ends later). Next: keyframed knobs.
- Keyframed knobs DONE (user order item 3): PublicControl.keys [{tick,value}] (number knobs, not tick-unit ones).
  src/graph/keyframes.ts compileKeyframed: compile once per key tick, differing numbers -> DescriptorTrack on
  descriptors (runtime applies per tick; particles.ts by the Sonnet implementer) and LayerAnimation on layers
  (viewport #applyAnimation: opacity/emission/hueShift/colour/grade/mesh colour-over-life/light colour+intensity+range);
  child emission reads keyed ParticleEvents probability / child burst at each event tick (nodeParamTracks from control
  bindings); paths read keyed values per tick (docAtTick). Structure/timing changes -> one error naming the knob.
  Editor: diamond button per knob (key at playhead; keyed knob edits the key at the playhead), x clears; lane diamonds;
  edits while paused keep the playhead. MCP vfx_set_control_keys. [SAW] orange thin t30 -> blue dense t92;
  [RAN] editor key+edit at t150. Cost: a keyed doc compiles (keys+1)x (~350 ms flamethrower, 2 keyed knobs).
- TOOL BROKEN 2026-09-29: ~/.claude/tools/shot.ps1 url returns "chrome produced no file" even for docs that captured
  earlier (doctor clean, page reports READY via cdp-eval). Use the in-app browser pane or cdp-eval meanwhile.
- USER REPORT 2026-09-29 (open): viewed from behind/in front of the fire (along the jet), the sprites move
  weirdly. Suspect velocity-stretched / velocity-aligned billboards viewed along their velocity (they collapse and
  spin). Needs a capture from those angles first.
- Post-release (user order): performance pass → timeline strip with component bars, then keyframed knobs →
  engine export → in-editor AI box that runs its own render→look→adjust loop → full AI guide → sound.

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
- A-05 run 6 [SAW]: burn matches the reference and my hand build (continuous, cooling, billowing); decay smoke faint,
  nozzle too bright. Guide fixed (Drag for event-born particles, nozzle material). Agent noted the fire guide makes
  flamethrower a transcription -> the free-form test must use a DIFFERENT reference next (no guide recipe for it).
  Awaiting user's visual verdict on run 6.
- 2026-09-29 user: "finish everything, then give me all the tests at once" (no more build-test-build loops with them).
  Done since: WP23 legacy migration (T33), WP24 reliability (context loss, T38 plateau), WP25 (quality profiles,
  benchmark evidence, Outline panel, graph keyboard, Reduced effects), WP-MCP2 (contact sheet, compare images),
  WP27 delivery (prod build now includes capture page + sprites, README, licences, examples/, evidence INDEX).
  WP26 review packet: REVIEW.md + review.html (strips from work/review/manifest.json; regenerate with
  `node mcp/run-steps.mjs work/review.steps.json` then the manifest script). NEXT: user does REVIEW.md, then fixes
  from their notes, then merge squad/vfx-v2 -> main. Parked: sound; comprehensive AI guide (later).
- d34e8cc: New effect anchors run left-to-right; first component into a fresh doc adopts its designed layout.
  All 49 review strips re-rendered after it (49/49, no errors [RAN]); water splash lands at stream end [SAW].
  REVIEW PACKET READY (2026-09-29) — waiting on the user's notes.
- 4fc250f: ribbons draw widthOverPath (RibbonGeometry widthAt); the editor had refused 8 components with it
  (water x3, light pulse/cone/blessing, shadow collapse/tendril) while MCP renders silently ignored it. All 49 review
  docs now load in the editor [RAN]; those 8 strips re-rendered. review.html: "Watch it play" opens
  /?workspace=v2&view=1&autoplay=1&doc=... (view=1 never autosaves over the user's draft [RAN]); click strip to enlarge.
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
- BEFORE RELEASE (user 2026-09-29): new editor becomes the default page (no ?workspace=v2); remove the old editor
  and its "Back to v1 editor" button; keep the converter renamed "Import old effect". Stop calling the release "v1".
- BEFORE RELEASE (optional, offered): sub-group component internals (e.g. Energy bolt: Charge/Bolt/Impact).
- LATER (user asked about keyframes 2026-09-29): (1) timeline strip with a bar per component (drag = Start at,
  stretch = travel/duration) — recommended first; (2) animated knobs (keyframe a knob over effect time).
- User review round 2 (2026-09-29): all good except water splash 'spiderwebs' -> fixed 4f36aa3.
- LATER: performance pass ("slight delay in some things", user editor test 2026-09-29).
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
- 3d4dae4 (2026-09-29): user reported low lightning fps. Cause [RAN]: path preview recompiled the whole graph
  (clone/analyze/expand + ParticlePaths particle compile) every tick = 86 ms/frame. Now cached per document
  (hit only if JSON unchanged): ~3 ms/frame path compile; est. total 7-13 ms/frame [PROXY: parts measured, real
  rAF fps not measurable in the throttled browser pane]. User to confirm smoothness.
- c0b6656 (2026-09-29) user review round 1 (notes in chat). User decision: fix TOOL gaps + bugs only; taste tweaks on
  presets (lightning branches, charge-up colour, smoke sizes, fireball trail, arc beam, thin fork) are SKIPPED — users
  tune those with knobs. Done: Material reflection/surfaceDetail/detailScale/colorVariation/liquid; new lighting
  (fill .6 + hemisphere .8 + key 2.6); droplet sprite de-blued, bubble sprite; OffsetAnchor dropToGround; ground
  rings follow Target (guard test: no component owns fixed anchors); recipes updated (stone, ice + vapour, water,
  fountain, rain, bubbles, helix). [SAW] closeups: stone, ice, water stream, fountain, poison bubbles, helix.
  NEXT: full review strips re-render (running), look at flamethrower/other lit meshes under the new lighting, then
  user re-checks; then REVIEW.md section 2 (editor test) and merge. "How far from product": v1 = this + editor test;
  engine exporters / sound / AI guide are post-v1.
- 2026-09-29 user editor test (REVIEW.md s2): "everything seems to work, slight delay in some things" -> performance
  pass later (not v1-blocking). Asked why Energy bolt has 49 nodes; offered sub-grouping component internals
  (Charge/Bolt/Impact) — awaiting answer.
- Post-v1 idea (user, 2026-09-29): in-editor AI box ("make it more electric" edits the effect live). Requirement from
  the discussion: it must run the render -> look -> adjust loop itself (several rounds, frame stats, compare) before
  showing a result; one blind edit = "not bad" quality (A-05), iterated + guided = the quality of the built-ins.
- 2026-09-29 "finish everything in the mds" pass (user): plan audit found — A packs (DONE 8814928: built-ins
  embedded+pinned, mix.wav, capabilities, staged import summary, .json warning, MCP inspect_pack; T31 fresh-origin
  [RAN]); Colour shift knob on every component (DONE 2ce12ba, user request); fireball Travel fix (0ffc732).
  REMAINING: B editor — curve + gradient editors (12: points + keyboard numeric table), Solo preview mask (06),
  error list focuses node, Relink by file with hash check (10); C — Emitter path shape, PublicParameter parent
  Group override; D — T01–T40 traceability table, quota-failure test, update 27-GAP-AUDIT/INDEX. Parked: sound
  (T18 WAV import, T25 listening), worker (T14; measured unnecessary — record as decision in plan).
- Commit rule (2026-09-29): `git add …; bash tools/gate-commit.sh "msg"` (checks the gate's real exit code — piping
  gate.sh into tail once let a tsc failure through, fixed in ee17c39). After ANY change under src/render/ also run
  `node tools/render-smoke.mjs` (tests cannot compile GLSL; a missing varying once blanked every billboard).
