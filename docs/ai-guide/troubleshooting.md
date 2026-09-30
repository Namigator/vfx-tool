# Troubleshooting

Two kinds of problems: the tool **tells you** (a diagnostic with a code, a message and a field path), or the effect
**looks wrong** with no error. Both are covered here. The full list of codes and where each comes from is generated in
[reference/diagnostics.md](reference/diagnostics.md).

Every diagnostic has: `code` (below), `message` (says what to do), `fieldPath` (e.g.
`graphs[0].nodes[4].params.burst`) and usually `nodeId`. Errors stop the preview; warnings don't. The editor jumps to
the node when you click an error.

## 1. Diagnostic codes

| Code | Means | Typical fix |
|---|---|---|
| `MISSING_REFERENCE` | Something required isn't connected or doesn't exist: an Emitter with a burst but no trigger, a renderer with no material, an unknown anchor/asset/node id, a path emitter without a path. | Connect it (see the message), or set the value that makes it unnecessary (e.g. `burst: 0` for continuous emission). |
| `INVALID_VALUE` | A value is out of range or not allowed here: min > max, a repeating schedule where only once/window works, a zero axis, an unsupported template, keyframes on a timing knob. | Fix the value named by `fieldPath`; the message says the allowed range or alternative. |
| `TYPE_MISMATCH` | Connected or bound incompatible types (a colour knob on a number parameter, a particles output into a paths input). | Connect matching port types (`vfx_list_node_types` shows port types). |
| `DOMAIN_MISMATCH` | A parameter is driven by something that varies over time, but that parameter only accepts constants (or the other way round). | Use a constant, or drive a parameter whose domains include `effectTime` / `normalizedAge` (see the parameter's "domains" in [reference/nodes.md](reference/nodes.md)). Keyframed knobs avoid this entirely. |
| `MULTIPLE_DRIVERS` | Two links feed an input that takes one (e.g. an Emitter chain resolving to two particle sources). | Remove one link, or merge them with the node made for it (`MergePaths`, `MergeEvents`). |
| `GRAPH_CYCLE` | A loop: particles feeding their own source, events nested too deep, a chain that never reaches an Emitter. | Break the loop; route through a separate emitter. |
| `GROUP_RECURSION` | A group contains itself. | Don't nest a component inside its own copy. |
| `BUDGET_EXCEEDED` | A hard limit would be passed: too many particles, paths/points, branches, active lights, mesh pieces; or the effect ends before its content (warning). | Reduce counts/rates/branches; lengthen the effect (the message gives the exact tick). Limits: [reference/limits.md](reference/limits.md). |
| `MISSING_ASSET` | An imported texture/model isn't in the project any more. | `vfx_relink_asset` or re-import; `vfx_remove_asset` if it's no longer wanted. |
| `IMPORT_LIMIT` | A file is too big or breaks the import rules (texture > 16 MiB / 4096 px, GLB > 20 MiB / 50k triangles, external references...). | Shrink or clean the file. |
| `CHECKSUM_MISMATCH` | A pack's bytes don't match its manifest (corrupted or edited pack). | Re-export the pack. |
| `DUPLICATE_ID` | Two nodes/edges/anchors share an id. | Use unique ids (the tools pick unique ones if you omit `id`). |
| `UNKNOWN_NODE` | A node type the registry doesn't know (typo, or a newer file). | `vfx_list_node_types`. |
| `UNSUPPORTED_VERSION` | A document from an incompatible version. | Old-editor effects: "Import old effect" / `vfx_convert_legacy`. |
| `STORAGE_CONFLICT` / `STORAGE_QUOTA` | The editor's local save collided with another tab / the browser is out of space. | Save .json or Export pack, free space, reload. |
| `WORKER_FAILURE` / `RENDERER_UNAVAILABLE` | The preview's worker or WebGL died (GPU reset, no WebGL). | "Retry preview"; reload; check GPU. |

## 2. Frequent messages and their fixes

| Message (start) | Fix |
|---|---|
| `Emitter burst is nonzero but no trigger is connected` | Continuous: `burst: 0` + `rate` + a Schedule `window`. Burst: connect `Schedule.start` (or another event) to `Emitter.trigger`. |
| `The effect ends at tick N but parts are still visible until tick M` | `vfx_set_document { durationTicks: M }`, or end emission earlier. Knob edits lengthen automatically; manual edits don't. |
| `A repeating Schedule window is not supported by the … preview` | Use `mode: "window"` or `"once"`; for repeated bursts use `repeat` on a Schedule that *triggers* bursts. |
| `Emitter aim anchor coincides with the emitter position` | Source and Target are at the same point (or the aim anchor is the emitter's own anchor). Move one. |
| `ParticleTrail draws untextured ribbons in the preview; use a SpriteUnlit material` | Give the trail its own Material with template SpriteUnlit. |
| `N point lights are active at tick T; the limit is …` | Shorten or merge light windows. |
| `BranchPath … would create up to N branches` / `Path preview would evaluate N paths/points` | Lower branch counts or path samples. |
| `"param" is a structural … parameter and cannot be bound/connected` | Structural parameters (shape, counts that change the graph) can't be knobs or links; set them directly. |
| `Keyframed knob(s) … change the effect's structure or timing over time` | Remove keys from timing knobs (Start at, Burn time, Travel…) and from knobs that change counts. |
| `… is inside a group; grouped audio chains are not supported` | Sound is parked; keep audio nodes in the root graph. |

## 3. "It looks wrong" (no error)

| Symptom | Check | Likely fix |
|---|---|---|
| Nothing visible | `vfx_sample_particles` at a mid tick: 0 live? | Wire the window/trigger; `burst: 0` without `rate` emits nothing; check the renderer reaches `node-output.visual`. |
| Visible in numbers, not in frames | Bounding box huge, or far from the camera | Particles fly away: add Drag; event-born particles inherit speed. Check `rootTransform.scale`. |
| Everything white / fog | Render reports "glow flooding" | Lower additive opacity/emission, then EffectOutput glowLimit/Threshold ([look.md](look.md)). |
| Dark smoke invisible | Dark floor | Lighten the tint, or check with `background: "light"`. |
| Faint glow invisible on light floor | Additive on light background | Add a normal-blend underlayer or accept dark-floor-only. |
| Pieces left behind when Target moves | Fixed document anchors used for parts | Derive with `OffsetAnchor` from `node-target`. |
| Impact happens before the projectile arrives | Impact on a fixed tick | Trigger it from `PathFollower.arrival` (`Schedule.trigger`). |
| Sprites look like squares | Texture missing / not a sprite template | Material template SpriteTextured + a library sprite; for imports check the texture role and grid. |
| Flipbook flickers | Wrong grid or mode | Match the sheet's grid; `flipbookMode` overLife for once-per-life, `flipbookCrossfade` for smoothness. |
| Same pattern every loop | Deterministic seed (by design) | Preview "New seed each loop"; change the document seed for a different saved pattern. |
| Knob does nothing | The knob drives a node inside a disabled branch, or its value is clamped | `vfx_list_controls` shows bindings; check ranges. |
| Keyframed knob doesn't animate | It's a timing knob, or keys are all equal | Timing knobs can't animate; check `vfx_list_controls` shows the keys. |
| Preview slow | Huge rates, many beams, deep branch counts | Lower rates; the Performance numbers in the editor show per-component cost. |

## 4. When the tools themselves misbehave

- `vfx_render_frames` needs the dev server (http://127.0.0.1:5174). If rendering fails, check it's running.
- The MCP server mirrors documents to `work/mcp/<id>.json`; the editor opens them with `?doc=/work/mcp/<id>.json`.
- If a tool reports an unexpected error, `vfx_get_document` shows the current JSON; `vfx_undo` steps back.
- A render can occasionally hang or time out with nothing wrong in the document; retry the same call once before
  changing anything.
- After a large batch of parallel edits, check with `vfx_get_document` (or `vfx_compile`, which reports unknown node
  ids) that every call landed: a call lost to a transport timeout leaves no error in the document.
- Clipped content at late ticks: the automatic camera fits once; see [workflow.md](workflow.md) "Cameras and
  backgrounds".
