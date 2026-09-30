# VFX Studio: guide for AI agents

How to make good visual effects with VFX Studio: through its MCP tools (`vfx_*`) or by helping a person in the
editor. The MCP tool `vfx_guide` serves these same pages: `vfx_guide {}` lists them, `{ topic: "look" }` returns a
chapter, `{ topic, section }` one section, `{ node: "Emitter" }` / `{ component: "flamethrower" }` one reference entry.

## Read in this order

1. **[concepts.md](concepts.md)**: the mental model: documents, the node graph, time (schedules, windows,
   events), anchors, components and knobs, keyframes, materials, glow, limits.
2. **[workflow.md](workflow.md)**: the build → compile → render → *look* → adjust loop, with exact tool calls and a
   verified example from scratch.
3. **[look.md](look.md)**: what makes effects read well (blending, colour, scale, motion, timing, layering) and
   the common wrong looks with their causes.
4. **[recipes/](recipes/)**: per family: fire, smoke, sparks & embers, earth, ice, water, lightning, energy
   projectiles, wind, poison, shadow, light/holy, impacts. Components to start from, knob values, from-scratch
   builds, variants, fixes.
5. **[troubleshooting.md](troubleshooting.md)**: every diagnostic code, frequent messages, "it looks wrong" table.
6. **[export.md](export.md)**: .vfx.json, .vfxpack, Roblox (aiming API, textures, what changes).
7. **[editor.md](editor.md)**: where everything is in the editor, with the matching MCP tool for each action.

## Reference (generated from the code, always current)

| File | Contents |
|---|---|
| [reference/nodes.md](reference/nodes.md) | Every node type: ports, parameters with units, ranges, defaults. |
| [reference/components.md](reference/components.md) | Every included component and its knobs. |
| [reference/sprites.md](reference/sprites.md) | The included sprite library: grids, flipbook/variant sets, what each is for. |
| [reference/mcp-tools.md](reference/mcp-tools.md) | Every MCP tool and its arguments. |
| [reference/diagnostics.md](reference/diagnostics.md) | Every error code and where it's raised. |
| [reference/limits.md](reference/limits.md) | Hard limits and budgets. |

Regenerate with `npm run guide`; a test fails if they drift from the code.

## The five rules

1. **Look at rendered frames** (`vfx_render_frames`) before saying anything about how an effect looks. Compile
   output and particle counts are not evidence of looks.
2. **Start from a component** when one is close; turn knobs before opening internals.
3. **Change one thing, compile, look.** Build layers one at a time (use `solo`).
4. **Additive layers flood easily**: per-sprite opacity 0.05–0.3; fix "glow flooding" at the sprites first.
5. **Derive points from Source/Target** (`OffsetAnchor`) and **tie impacts to events**, so the effect still works
   when the target moves.
