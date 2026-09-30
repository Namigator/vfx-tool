# AI guide acceptance test — 2026-09-30

Scope: build a flamethrower and the original lightning bolt **from scratch** (no `vfx_add_component`,
no reading `src/`), using only `docs/ai-guide/**` and the `vfx_*` MCP tools, following the guide's
build→compile→render→look→adjust loop. Documents: `accept-flamethrower`, `accept-lightning`, saved to
`work/mcp/accept-flamethrower.json` and `work/mcp/accept-lightning.json`.

## 1. Flamethrower

**Final renders** (all `[SAW]`, looked at every one):
- `work/mcp/frames/accept-flamethrower-t15.png` — ignition
- `work/mcp/frames/accept-flamethrower-t60.png` — steady jet
- `work/mcp/frames/accept-flamethrower-t150.png` — near window close
- `work/mcp/frames/accept-flamethrower-t190.png`, `-t195.png` — tail (smoke/embers after burn ends)

Reference: `docs/v2-plan/references/standalone-flamethrower/flamethrower.html` (captured live via the
in-app browser at `?t=1.0`, `[SAW]`).

**Comparison.** Matches: white-hot root cooling through pale-yellow → orange → dark-red tips (colour-over-life
reads correctly); continuous jet aimed Source→Target; grey smoke breaking off and rising where the flame body
dies (`ParticleEvents.death` → smoke emitter); small warm embers falling from the same death events; a warm
point light lighting the floor near the nozzle; a believable tail after the burn window closes. Doesn't match:
the reference's flame body is made of crisp, filament-like licking tongues with visible internal structure and
bright highlights; mine reads as a smoother, more uniform billowing cloud — thinner/faster-emitting tongues
closed some of the gap but didn't fully fix it. The reference also has a modelled nozzle/pipe mesh at the
source, which this build (rightly, per "build from nodes") has no component for and doesn't attempt. No ground
scorch ring (reference doesn't show one continuously either, so this is a minor miss).

**Score: 7/10.** Silhouette, colour progression, layering (core/body/smoke/embers/light) and timing are all
correct and read unmistakably as "flamethrower." The texture/shape of the flame body itself is the gap — more
a fine-tuning issue than a structural one.

**Iterations:** 1 build + 3 render/adjust passes (≈45 tool calls total, well under the 12-iteration budget):
(1) initial build, blobby/cloudlike; (2) added `randomFrameStart: true` to desync the flame's flipbook — no
visible change; (3) narrowed size, raised rate, raised stretch, reduced late-life size growth — visibly crisper,
accepted.

## 2. Lightning

**Final renders** (all `[SAW]`):
- `work/mcp/frames/accept-lightning-t27.png` — discharge (+3 ticks after strike start)
- `work/mcp/frames/accept-lightning-t30.png` — discharge, sparks visible
- `work/mcp/frames/accept-lightning-t40.png` — decaying bolt + impact flash/sparks
- `work/mcp/frames/accept-lightning-t60.png` — late decay
- `work/mcp/frames/accept-lightning-t22.png` — pre-strike (correctly empty; no charge-phase layer was built,
  see gap below)

Reference: `docs/v2-plan/references/original-lightning/lightning-arc.html`, captured live mid-discharge via
the in-app browser (`[SAW]`; two frames captured 0.3s apart during a real "Cast lightning" trigger).
`vfx_compare_images` against the guide's own reference image
(`docs/v2-plan/references/original-lightning/lightning-preview.png`) **failed** — see gap #3 below — so the
comparison here is visual, by eye, against the live browser captures.

**Comparison.** Matches: thin bright core with the colour living in the wider additive outer/halo passes
(exactly the look.md rule); fine zigzag amplitude (0.3/0.14) reads as "electric," not "scribbled"; hair-thin
side branches attach along the trunk, not just at the ends; sparks fall and bounce at the target; a bright
flash/point light sells the strike. Doesn't match: the reference's bolt is visually thicker/brighter overall
with a stronger blue glow wash across a wider area (my halo pass is comparatively restrained — I raised it
once but stopped short of matching the reference's brightness to avoid re-triggering "glow flooding"); the
reference has a charge-up phase (motes gathering at Source, ~1–2s) before the strike that I did not build,
since the guide's from-scratch recipe explicitly stops at "from scratch: LinePath → JaggedPath → BranchPath →
RibbonRenderer" and only *mentions* `charge-tethers` as a separate existing component, with no from-scratch
code for it.

**Score: 7/10.** The core "thin bright bolt, fine zigzag, faint branches, glow sheath, flash" checklist from
the task is fully present and reads correctly; missing the charge-up anticipation phase and slightly under-
bright compared to the reference are the gaps.

**Iterations:** 1 build + 3 fix/adjust passes (≈70 tool calls, still under budget): (1) initial path+4-pass
build — compile failed on a unit mismatch in the decay-envelope math (see gap #2); (2) fixed unit, compiled
and rendered clean — bolt shape good, colours too dim/flat; (3) raised core emission and pass opacities,
added sparks + impact light — first light setting triggered "glow flooding"; (4) lowered light intensity/range,
clean render, accepted.

## 3. Where the guide failed me (the main deliverable)

1. **`recipes/fire.md`'s from-scratch code omits `randomFrameStart`, and the guide doesn't say it matters
   for this code.** The copy-paste "From scratch: two-layer flame jet" example
   (`docs/ai-guide/recipes/fire.md`, "From scratch" section) sets `InitialProperties` with only `sizeMin`/
   `sizeMax` for the flame body (`ip`) and smoke (`smokeip`), no `randomFrameStart`. `randomFrameStart` is
   only mentioned as a general tip in `reference/sprites.md` ("Set randomFrameStart on InitialProperties to
   desynchronise particles") — not called out as something the fire recipe itself needs, and not present in
   its exact node list. Since `flame-tongue-a` is a 16-frame flipbook and `BillboardRenderer.flipbookMode:
   "overLife"` plays every particle's flipbook in lockstep with its own lifetime (which is fine per-particle)
   but *all particles still start the animation at frame 0*, this produced a visibly smoother/more synchronized,
   blobbier flame than the reference. **What was actually true:** turning `randomFrameStart: true` on made no
   visible difference in my render (I checked before/after at the same tick) — so either the guide's claim that
   this desynchronises particles doesn't show up as expected with `flipbookMode: "overLife"`, or the effect is
   too subtle to see against the dominant factor (heavy alpha overlap from normal-blend sprites at opacity 0.62).
   The guide doesn't explain which. I could not tell which was true without reading source, which the task
   rules forbid — a real dead end for an agent following the guide honestly.

2. **The lightning decay-envelope recipe (`recipes/lightning.md`, "From scratch") gives a formula but not a
   working node graph, and the graph I built from its description failed to compile on the first try** with
   `[TYPE_MISMATCH] decayFinal (graphs[0].edges[12]): Unit none of "value" does not match unit normalized of
   "a"; add an explicit conversion.` The guide's prose says: "drive each pass's `Material.opacity` from the
   shared decay-envelope chain — `Time` → `ScalarMath multiply(-3)` → `ScalarMath exp` → multiply by an
   `Oscillator(sine, 96/π Hz, min 0.72, max 1)`" — this is a one-line aside, not exact tool calls like every
   other recipe in the doc gets. It doesn't mention that `ScalarMath`'s own `unit`/`inputUnit` params have to
   be hand-matched across the chain or compile fails with a unit-mismatch error, and doesn't give the fix
   (`inputUnit: "none"` on the consuming node). Every other code block in the guide is copy-paste-exact and
   verified; this one wasn't, and it's the one piece of the lightning recipe that most affects whether the
   bolt "flickers" vs. looks like "frozen neon" (look.md's own wrong-look row for lightning).

3. **`vfx_compare_images` cannot actually be used on the guide's own named reference file.**
   `look.md` section 9 ("Quality bars") and `recipes/lightning.md`'s closing line point at
   `docs/v2-plan/references/original-lightning/lightning-preview.png` as the thing to diff against. Calling
   `vfx_compare_images { a: "docs/v2-plan/references/original-lightning/lightning-preview.png", b: <my render> }`
   returned the bare error `Not a PNG file.` Inspecting the bytes: the file's magic number is `FF D8 FF E0`
   (JPEG/JFIF), not PNG — it's a `.png`-named file that's actually a `.jpg`. The guide never warns that this
   file isn't a real PNG, and the tool's error message doesn't say why it isn't a PNG or what to do about it,
   so I had no path forward except abandoning the numeric comparison and doing it by eye from my own browser
   screenshots. There's also **no equivalent reference PNG for the flamethrower at all** — `look.md` section 9
   names `standalone-flamethrower/flamethrower.html` as the fire quality bar but no companion image file
   exists anywhere under `docs/v2-plan/references/standalone-flamethrower/`, so the flamethrower comparison in
   this report is necessarily by-eye only, with no numeric-diff option even in principle.

4. **`vfx_render_frames` hung for the full 1800s idle timeout on `accept-lightning`'s very first render call**,
   with nothing wrong in the document (it compiled clean immediately before, and the identical call succeeded
   on retry). `troubleshooting.md` section 4 does say "A render can occasionally hang or time out with nothing
   wrong in the document; retry the same call once before changing anything" — this one line saved real time,
   since without it a literal reading of the rest of the guide gives no reason to suspect the *tool* rather
   than the document. Flagging as a near-miss rather than a hard failure, since the guide got this one right,
   but 1800 seconds of silence before the documented workaround kicks in is a long time to sit on a known
   issue — a shorter idle timeout or a faster-failing retry would have saved most of that.

5. **No guidance on what "good" looks like numerically for the flame body's texture/shape**, beyond "don't
   look like fog" and "don't look like petals." Both `look.md` and `recipes/fire.md` are precise about colour
   stops, blend modes, and size-over-life curves, but the actual "crisp licking tongue vs. smooth blob" quality
   difference I struggled to close for the flamethrower isn't covered by any table or rule in the guide — there
   is no "looks like a blob, not tongues → fix: …" row in `recipes/fire.md`'s "Looks wrong → fix" table (the
   table has "Orange/white fog," "Flower petals," "A solid orange tube, no flicker," but nothing between a solid
   tube and convincing fire). An agent following the guide exactly, as I did, plateaus at "recognisable fire,
   wrong texture" with no next diagnostic step offered.

6. **Minor:** `recipes/lightning.md`'s "From scratch" section explicitly frames itself as building
   `lightning-strike`'s *trunk and one impact-less pass pair* and defers "Add `inner` at width ×2.7 the core
   and `halo` at ×16.5 for the full four-pass look... Add sparks with `Emitter`... triggered off `strike.start`"
   to a single parenthetical paragraph with no exact tool calls (unlike literally every other worked example in
   the guide, including the fire recipe's smoke layer, which does give exact calls). I had to invent parameter
   values (spark speed/lifetime/size, light intensity/range) from the numbers given in the "What makes lightning
   read right" bullets above it, which are prose ranges ("ripple radius 4–7.5 m," "impact core/halo sprites
   0.35 m / 1.4–3 m") rather than the copy-paste-ready blocks the rest of the guide trains you to expect.

## 4. Tool-call / iteration accounting

- Guide reading: `vfx_guide` × 7 (readme implicitly via README file read, concepts, workflow, look,
  recipes/fire, recipes/lightning, troubleshooting, reference/sprites).
- Reference look: browser screenshots of both reference HTML pages (`[SAW]`), `vfx_describe_node_type` × 9
  for node params not fully covered inline in the recipes (PointLight, Emitter, OffsetAnchor, InitialProperties,
  RibbonRenderer, JaggedPath, BranchPath, GroundCollision, Material, ScalarMath, Oscillator, Time,
  EffectTimeCurve — some combined in one call).
- Flamethrower: 1 `vfx_new_document`, ~22 `vfx_add_node`, ~40 `vfx_connect`, 1 `vfx_set_document`, 5
  `vfx_compile`, 4 `vfx_render_frames` calls (13 frames total), 5 `vfx_set_params` adjustment calls,
  1 `vfx_save_document`. 3 look→adjust iterations.
- Lightning: 1 `vfx_new_document`, 2 `vfx_set_anchor`, 1 `vfx_set_document`, ~27 `vfx_add_node`, ~35
  `vfx_connect`, 4 `vfx_compile` (1 failed on the unit-mismatch gap above), 4 `vfx_render_frames` calls
  (11 frames total, one needing a retry after a 1800s timeout), 5 `vfx_set_params` adjustment calls,
  1 failed `vfx_compare_images` call, 1 `vfx_save_document`. 4 look→adjust iterations.
- Both well inside the ~12-iteration-each budget.
