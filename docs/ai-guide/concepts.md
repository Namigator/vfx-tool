# Concepts: how VFX Studio thinks

Read this first. Everything else in the guide assumes these ideas. Exact node and parameter details live in
[reference/nodes.md](reference/nodes.md); this chapter explains how the pieces fit.

## 1. An effect is a document

An effect is one **document** (a `.vfx.json` file, or an entry in the editor's project shelf). It holds:

| Part | What it is |
|---|---|
| `durationTicks` | How long the effect runs. **60 ticks = 1 second.** Max 600 (10 s). |
| `seed` | Random seed. Same seed = the exact same particles every time (effects are deterministic). |
| `anchors` | Named points in the world, at minimum **Source** (where the effect starts: the caster, the nozzle) and **Target** (where it goes: the enemy, the impact point). |
| `graphs` | The node graph(s): the root graph plus one graph per Group (component). |
| `controls` | Published **knobs**: friendly sliders/colour pickers bound to node parameters. |
| `assets` | Imported textures and 3D models (the included sprite library needs no import). |
| `rootTransform` | Moves/rotates/scales the whole effect. `scale` resizes everything together. |

Units are metric and physical: metres, seconds, m/s, m/s², radians. The editor's floor grid is 1 m.
A game character is about 1.8 m tall; the default Source→Target distance is about 4–6 m.

## 2. The node graph

Effects are built from **nodes** connected by **links** from an output port to an input port. Ports are typed
(particles, paths, material, event, timeWindow, anchor, visual, scalar...) and only matching types connect.

Everything drawn must reach the root **EffectOutput** node's `visual` input. The typical chain:

```
Schedule (when) ──window──► Emitter (how many, where, which way)
                              │ particles
                              ▼
                  InitialProperties (size, colour, spin at birth)
                              ▼
            forces: Gravity · Drag · NoiseForce · Attract · Vortex · GroundCollision
                              ▼
            OverLife (size / opacity / colour / spin over each particle's life)   [optional]
                              ▼
   BillboardRenderer / MeshRenderer / ParticleTrail  ◄── Material (look: sprite, blend, colour, glow)
                              ▼ visual
                         EffectOutput
```

Paths are a parallel world for beams, bolts, streams and rings:

```
LinePath / BezierPath / RingPath / HelixPath / RadialPath
      ▼ paths
JaggedPath (lightning zigzag) · BranchPath (side branches) · RevealPath (grow over time) · MergePaths
      ▼ paths
RibbonRenderer ◄── Material  ──► EffectOutput.visual
```

A particle chain can also *follow* a path (`PathFollower` moves an anchor along it: projectiles) or be *born along*
it (Emitter shape `path`: sparks along a bolt).

## 3. Time: schedules, windows and events

- A **Schedule** node decides *when*. Modes: `once` (a single start event), `window` (open from `startTicks` for
  `durationTicks`: continuous emission), `repeat` (`repeatCount` starts, `repeatIntervalTicks` apart).
- Its `window` output gates continuous emitters (Emitter `rate`) and lights; its `start`/`end` events trigger
  **bursts** (Emitter `burst` + `trigger`), flashes and camera shakes.
- **Event-relative timing:** connect an event into `Schedule.trigger` and the schedule starts *relative to that
  event*. This is how impacts follow arrivals: `PathFollower.arrival → Schedule.trigger`, so if the projectile
  travels longer, the impact moves with it automatically.
- **Particle events:** `ParticleEvents` turns particle births/deaths into events (sparks where flames die, smoke
  where embers land); `GroundCollision` emits collision events.
- Particles have **ages**: over-life curves use the normalized age 0→1 (birth→death), which is why size, opacity
  and colour "over life" read so naturally.

## 4. Space: anchors

- **Source** and **Target** are document anchors. Move them (editor handles, or `vfx_set_anchor`) and every node
  that uses them follows: emitters aim at Target, paths run Source→Target, impacts land on Target.
- `OffsetAnchor` makes a derived point (1.2 m in front of Source, a floor point under Target with
  `dropToGround`). Always derive from Source/Target instead of adding fixed anchors, or pieces get left behind when
  the target moves.
- `PathFollower` outputs a *moving* anchor (the projectile head): attach sprites, emitters, lights and trails to it.

## 5. Components, groups and knobs

- A **component** is a ready-made, pre-wired effect layer (49 included: fire jets, lightning strikes, water
  streams...). Inserting one adds a **Group** node whose internals live in their own graph; "Open internals" goes
  inside. See [reference/components.md](reference/components.md).
- Every component publishes **knobs** (document controls): 4–8 big levers (reach, density, width, colour...) plus
  automatic ones: **Start at** (delay it on the timeline), **Colour** (turn every colour around the colour wheel
  but keep the hot-core-to-cool-tip look), and one **"<Part> colour"** picker per part (Flame, Embers, Smoke & dust,
  Flash & rings, Light...).
- Knobs are the right way to change a component. Only open the internals for things the knobs don't reach.
- A knob drives one or more node parameters (`bindings`, each with optional scale/offset/axis).
- You can wrap your own selection of nodes into a Group and save it as a reusable component ("My Blocks").

## 6. Keyframes and the timeline

- Any **number knob** can be keyframed: keys `{tick, value}`, linear in between, held before the first and after
  the last key (editor: the ◇ button next to a knob; MCP: `vfx_set_control_keys`).
- Keyframes animate *values*: speed, size, density, colour, strength. **Timing knobs** (Start at, Burn time,
  Travel...) can't be keyframed (they change structure, not values) and the tool says so.
- The **timeline strip** under the play bar shows one bar per component: drag it to change Start at, drag its right
  edge to change its length knob (when it has one), click to select.

## 7. Materials: how things look

A **Material** node decides appearance for the renderer it feeds:

- `template`: SpriteUnlit (soft round disc), **SpriteTextured** (a sprite sheet from the library or an import),
  RibbonUnlit, MeshLit, SurfaceTranslucent (liquids/glass), DarkVolumeSprite (dark smoke that glow never lifts).
- `blend`: **additive** adds light (fire, sparks, energy, glows: overlapping sprites get brighter) vs **normal**
  (smoke, dust, water, dark things: overlapping sprites cover each other) vs cutout.
- `tint`, `opacity`, `emission` (how much it glows / feeds bloom), `hueShift`, part `recolorFrom/To`.
- Sprite sheets are **flipbooks** (4×4 animations) or **variant sets** (several different shapes, one per particle).
  Use one with `template: "SpriteTextured"` and `sprite: "<id>"` (e.g. `"flame-tongue-a"`); imported textures use
  `textureAsset: "<assetId>"`. See [reference/sprites.md](reference/sprites.md).
- Curve and colour-ramp parameters (size/opacity/colour over life) take JSON objects, not lists: see the "default"
  note at the top of [reference/nodes.md](reference/nodes.md).
- Extra looks: dissolve (burning edges), rim, UV scroll/distort, reflection/surface detail for lit meshes, liquid.

## 8. Glow

Bloom is per effect, on EffectOutput: `glowStrength`, `glowRadius`, `glowThreshold`, `glowLimit`. Additive layers
with emission feed it. Dense additive stacks flood the frame white — see [look.md](look.md).

## 9. Determinism, seeds and variation

The same document always produces the same frames (seeded randomness per node, `randomStreamId`). "New seed each
loop" in the editor previews variations without changing the saved effect. Duplicate a node with
`preservePattern` to keep its random pattern.

## 10. Limits

Particles, bursts, beams, lights and mesh pieces have hard budgets that fail loudly instead of silently dropping
content — see [reference/limits.md](reference/limits.md). The editor also warns when the effect is shorter than its
content (tails cut off); knob edits lengthen the effect automatically.

## 11. Two ways in: the editor and the MCP tools

Everything the editor does, an AI can do through the **MCP tools** (`vfx_*`, listed in
[reference/mcp-tools.md](reference/mcp-tools.md)), and vice versa. An AI should build with the tools and **look at
rendered frames** (`vfx_render_frames`) — see [workflow.md](workflow.md).
