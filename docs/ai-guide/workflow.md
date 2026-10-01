# Workflow: building an effect step by step

The loop that produces good effects, for an AI working through the MCP tools and for a person in the editor.
Tool names and arguments are exact; full parameter lists are in [reference/mcp-tools.md](reference/mcp-tools.md).

## The golden loop

```
decide the look  →  start from a component (or blank)  →  change one thing  →  vfx_compile
       ▲                                                                   │
       └──────────── adjust ◄── LOOK at vfx_render_frames images ◄─────────┘
```

1. **Decide the look in words first.** Colour, size relative to a 1.8 m character, how long it lasts, what happens
   when (charge → release → impact → fade). Find the closest family recipe in [recipes/](recipes/).
2. **Start from a component when one is close** (fast, proven): `vfx_new_document { template: "blank",
   component: "flamethrower" }` or `vfx_add_component { docId, component, group: true }`. Turn its knobs first.
3. **Change one thing at a time** and compile after every batch of edits: `vfx_compile { docId }`. Read every
   warning — cut-off tails, event ticks outside the effect, lights over budget are real problems.
4. **Look.** `vfx_render_frames { docId, ticks: [...] }` returns PNGs — open and look at them before saying anything
   about the result. `vfx_contact_sheet` shows the whole timeline as one strip.
5. **Compare** against a reference when you have one: `vfx_compare_images { a, b }`.
6. **Save**: `vfx_save_document { docId, path }`.

Never claim an effect "looks good" from compile output or particle counts. Only images count.

## Choosing ticks to render

| Effect shape | Ticks to look at |
|---|---|
| Continuous (jet, stream, beam) | ramp-up (≈10–15), steady middle, the last 10 ticks, and after the end (tail) |
| Projectile | launch, mid-flight, arrival tick (`vfx_list_timeline` / compile summary), arrival +5, +30 |
| Burst / impact | trigger tick, +2, +8, +30, near the end of the longest life |
| Charge-up | start, halfway, release |

`vfx_list_timeline { docId }` prints each component's active span; `vfx_list_events` lists event outputs.

## Cameras and backgrounds

- Default framing fits the **whole** effect (sampled over every tick), so growing content stays in frame and all
  ticks of one render share the same camera (frames compare directly). For a specific angle pass
  `camera: { position, target, fov }` (metres), or `orbit: { yaw, pitch, distance }` to look from another side.
- Check effects from the **side**, from **behind the source** and from **in front of the target**: sprites that
  follow their velocity look different end-on.
- `background: "light"` renders on a light floor: dark smoke vanishes on dark floors and faint additive glows vanish
  on light ones. Check both if the effect must work on either.
- `solo: [nodeIds or Group ids]` renders only those parts (like the editor's Outline → Solo), perfect for tuning one
  layer without the rest in the way.

## Building from scratch (no component)

Minimal continuous sparkle, exact calls:

```
vfx_new_document { template: "blank", id: "demo" }
vfx_add_node { docId: "demo", type: "Schedule", id: "win", params: { mode: "window", startTicks: 0, durationTicks: 90 } }
vfx_add_node { docId: "demo", type: "Emitter", id: "em", params: { burst: 0, rate: 60, lifetimeMin: 0.4, lifetimeMax: 0.8 } }
vfx_add_node { docId: "demo", type: "BillboardRenderer", id: "bb" }
vfx_add_node { docId: "demo", type: "Material", id: "mat", params: { blend: "additive", tint: { srgb: "#FFB040", alpha: 1 } } }
vfx_connect { docId: "demo", from: "win.window", to: "em.window" }
vfx_connect { docId: "demo", from: "node-source.out", to: "em.anchor" }
vfx_connect { docId: "demo", from: "em.particles", to: "bb.particles" }
vfx_connect { docId: "demo", from: "mat.material", to: "bb.material" }
vfx_connect { docId: "demo", from: "bb.visual", to: "node-output.visual" }
vfx_compile { docId: "demo" }
vfx_render_frames { docId: "demo", ticks: [40] }
```

What happens, and why this is the loop in miniature (verified 2026-09-30):

1. If you forget `burst: 0`, compile fails with `MISSING_REFERENCE … Emitter burst is nonzero but no trigger is
   connected` — an Emitter defaults to a burst. Continuous emission = `burst: 0` + `rate` + a `window`.
2. Compile warns `The effect ends at tick 120 but parts are still visible until tick 138` — particles born near the
   end of the window still live. Fix: `vfx_set_document { docId, durationTicks: 140 }` (or end the window earlier).
3. The first render floods: `lit 70.6% of frame … WARNING: a large dim halo around a small bright core (glow
   flooding)`. Default opacity 1 on an additive sprite blooms into orange fog. Fix:
   `vfx_set_params { docId, nodeId: "mat", params: { opacity: 0.25 } }` → `lit 2.7%`, distinct warm sparkles.
   Dense additive layers want per-sprite opacity 0.05–0.3 (see [look.md](look.md)).

Use `vfx_describe_node_type { type }` (or [reference/nodes.md](reference/nodes.md)) for every node's parameters,
units and ranges before setting them. `vfx_list_node_types { filter }` lists ports. The blank document's anchor
nodes are `node-source` / `node-target` and the output is `node-output` (check with `vfx_get_document`).

Build **one layer at a time**: get the flame body right alone (solo), then add the core, then smoke, then embers,
then the light. Stacking five untested layers makes it impossible to tell which one is wrong.

## Working with components

- `vfx_list_components` — ids, labels, descriptions. Full knob lists: [reference/components.md](reference/components.md).
- `vfx_list_controls { docId }` — every knob with value, range and what it drives; keyed knobs show their keys.
- `vfx_set_control { docId, control, value }` — by id or label. Colour knobs take `{ srgb: "#RRGGBB", alpha: 1 }`;
  the whole-component **Colour** knob also takes degrees or a `"#RRGGBB"` (turned toward that hue).
- `vfx_set_control_keys { docId, control, keys: [{ tick, value }] }` — animate a number knob; `[]` stops animating.
- Several components in one effect: add each, then place them in time with their **Start at** knob (or
  `startOn: "nodeId.port"` on `vfx_add_component` to start on another component's event, e.g. an impact after a
  projectile arrives).
- Open the internals only for what knobs don't cover; component node ids are prefixed (`<prefix>-<node>`) and live
  in graph `graph-<prefix>` (pass `graphId` to node tools).

## Debugging with numbers (after looking)

- `vfx_sample_particles { docId, tick, show }` — live count, bounding box and mean speed per particle system. Use it
  when something is *missing* in the frames: 0 live = nothing emitted (window/trigger wiring); a huge bounding box =
  particles flew out of frame (add Drag).
- `vfx_compile` summary lists systems, bursts and rates per emitter.
- Diagnostics carry a code and a field path — see [troubleshooting.md](troubleshooting.md).

## Editing tools

Duplicate (`vfx_duplicate_nodes`, `preservePattern` keeps its randomness), copy/paste across documents
(`vfx_copy_nodes`/`vfx_paste_nodes`), remove with reconnect (`vfx_remove_node reconnect: true`), group a selection
(`vfx_group_nodes`) and save it as your own component (`vfx_save_group_component`), undo/redo
(`vfx_undo`/`vfx_redo`).

## Assets

- The included sprite library needs no import ([reference/sprites.md](reference/sprites.md)).
- Your own textures: `vfx_import_texture` (role color | mask | normal | noise; flipbook grid optional).
- Your own models: `vfx_import_mesh` (GLB, checked against the import rules; `importScale`).
- `vfx_add_asset_component` inserts a ready-made component that uses an imported asset.
- Clean up with `vfx_cleanup_assets`; `vfx_relink_asset` / `vfx_remove_asset` fix missing ones.

## Finishing

1. Check the effect's end: nothing should be cut off (the compile warns) and nothing should linger.
2. Check performance: particle counts in the compile summary, beam counts for exports.
3. Save the document; export if needed ([export.md](export.md)).

## The same loop in the editor

Library (Presets / Components / Assets / My Blocks) → insert → Controls panel knobs (◇ to keyframe) → play, scrub,
step, 0.25×/0.5× speed → Outline → Solo a part → graph for internals → Save / Keep / Export. See
[editor.md](editor.md).
