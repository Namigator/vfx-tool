# Gaps found while writing the family recipes (2026-09-30)

Found while building and rendering `recA-*` documents through the MCP tools for fire/smoke/sparks-embers/
earth/ice/water. Each entry is a repro plus what actually happened.

## 1. `OverLife` / `MeshRenderer` / `RibbonRenderer` curve and gradient parameters don't match the docs' notation

**Repro**: `vfx_add_node { docId, type: "OverLife", id: "ol", params: { sizeOverLife: { kind: "normalized",
keys: [{t:0,v:1},{t:1,v:1}] } } }` (the shape you'd guess from reference/nodes.md's compact display text
`curve normalized/linear: 0:1 1:1`).

**Result**: rejected — `Unexpected field(s): kind`, `Missing field(s): domain`. Same for `colorOverLife` with
`{stops:[{t,srgb}]}` — rejected with `Unexpected field(s): t, srgb` / `Missing field(s): position, color`.

**Actual shape** (from `vfx_describe_node_type`): a curve is
`{ domain: "normalized", interpolation: "linear", keys: [{ x, y }, ...] }` and a gradient is
`{ stops: [{ position, color: { srgb, alpha } }, ...] }`.

**Why it's a gap**: `reference/nodes.md` prints curves/gradients only as a compact human-readable string
(`curve normalized/linear: 0:1 1:1`, `gradient: 0:#FFFFFF 1:#FFFFFF`) and never shows the actual JSON the
parameter accepts. An agent following the doc literally will guess a `{t,v}`/`{kind}` shape and get rejected.
**Fix suggestion**: either have `vfx_describe_node_type`'s output linked from nodes.md, or print the real JSON
shape (not just the compact notation) next to every curve/gradient parameter in reference/nodes.md.

## 2. `Material`'s sprite parameter is named `sprite`, not `spriteId`

**Repro**: `vfx_add_node { docId, type: "Material", id: "mat", params: { template: "SpriteTextured",
spriteId: "flame-tongue-a", ... } }`.

**Result**: rejected — `Node "Material" has no parameter "spriteId"`. Correct id is `sprite` (an enum of the
18 included sprite names).

**Why it's a gap**: `reference/sprites.md` and the `vfx_guide materials` topic both talk about "sprites" and
list their ids, but neither ever states the literal Material parameter id. `reference/nodes.md`'s Material
section (not reached during this pass, but likely has the same gap since the describe_node_type output was
needed to resolve this) should make the parameter id impossible to miss right next to the sprite list.

## 3. A particle-chain output's "connections: one" in reference/nodes.md does not mean it can only feed one input

**Repro**: build a flame chain ending in `ol` (an `OverLife` node), then connect `ol.particles` to **both**
`bb.particles` (the renderer) **and** `pevents.particles` (a `ParticleEvents` tap for death-triggered smoke) —
two `vfx_connect` calls from the same source port.

**Result**: both connections succeeded and `vfx_compile` treated the chain as branching correctly (smoke
triggered off the flame's death events as expected, confirmed by render). The same pattern worked for a
`Schedule.start` event output feeding two different `Emitter.trigger` inputs in the earth recipe.

**Why it's a gap**: `reference/nodes.md`'s "How to read the tables" section says *"`connections: many` inputs
accept several links (they are ordered); `one` accepts a single link"* and then applies a `connections` column to
**both** inputs and outputs in every node's port table, with most particle/event outputs listed as `connections:
one`. This reads as "this output can only go to one place," which is false and actively discourages the
fan-out pattern every non-trivial effect needs (tapping `ParticleEvents` off a chain that also renders, or one
`Schedule.start` triggering several emitters). **Fix suggestion**: either drop the `connections` column from
output rows (it only meaningfully constrains inputs) or state explicitly that it does not limit how many inputs
an output can fan out to.

## 4. Default render camera does not re-fit as an effect's bounds grow over time

**Repro**: `recA-ice-scratch` — nine `MeshRenderer` crystals with a `sizeOverLife`/`scaleY` grow-in reaching full
height (scaleY 3, several metres tall) by ~tick 25. `vfx_render_frames { ticks: [15, 40, 100] }` with no explicit
`camera`.

**Result**: tick 15 (crystals still short) framed cleanly; ticks 40 and 100 (crystals at full height) had the
tops of the tallest shards clipped by the top of the frame. The framing appears to be computed once (likely from
tick-0 or a fixed early sample) rather than re-fit per rendered tick.

**Why it's a gap**: `workflow.md`'s "Cameras and backgrounds" section says *"Default framing fits the effect"*
without qualifying that this is a single fit, not a per-frame one — an agent rendering a growing effect (ice
crystals, a charging orb, an expanding ring) at a late tick using default framing will get a misleadingly
clipped image and might conclude content is missing rather than off-frame. **Fix suggestion**: note in
workflow.md that default framing is fit once (not per tick) and recommend an explicit `camera` for effects whose
bounds change a lot between rendered ticks.

## 5. A dropped `vfx_add_node` call after an MCP timeout needs a manual re-check

**Repro**: while building `recA-smoke-scratch`, one `vfx_add_node` call (adding the `Drag` node, sent in a
batch of 7 parallel add-node calls) returned: `MCP server "vfx" tool "vfx_add_node" sent no response or
progress for 1800s; aborting.` All 6 sibling calls in the same batch succeeded normally and fast.

**Result**: the node was silently **not** added (confirmed via `vfx_get_document`) despite the other 6 calls in
the same batch landing in under a few seconds each. No error was reported to the document; the next `vfx_connect`
referencing the missing node would have failed with an unrelated "unknown node" error if I hadn't checked first.

**Why it's a gap**: this looks like a transient MCP transport/idle-timeout glitch rather than a tool bug, but
it's worth logging because the failure mode is silent-ish (a tool-call-level error, easy to miss when other
calls in the same batch succeeded) and the fix (re-check the document, re-add the missing node) isn't obvious
from the error text alone. No consistent repro found — it did not recur across five more documents built the
same way in the same session.

## Not a gap, for the record

- Fanning particle/event outputs to multiple inputs (see #3) works correctly — only the documentation wording is
  the problem.
- `vfx_render_frames`'s "lit %"/"bright %" figures and glow-flooding warning matched what the rendered PNGs
  actually showed in every recipe built for this pass (e.g. the spark-burst component's 22.8% lit / 4.3% bright
  at the peak of a bright starburst was not flagged as flooding, and visually it wasn't — a normal bright burst,
  not a washed-out blob).
