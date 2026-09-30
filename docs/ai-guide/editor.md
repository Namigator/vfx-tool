# The editor: where everything is

A map of the web editor for an AI that helps a person use it (or drives it through a browser), and for the person.
Every editor action also exists as an MCP tool (named in brackets), so an AI never *needs* the UI.
Start the editor with `npm run dev` and open the printed address; `vfx_preview_url { docId }` gives a link that opens
an MCP document in it.

## Layout

```
┌ File bar: New · Open… · Save .json · Save as… · Keep · Export pack · Export media… · Export Roblox · Undo/Redo · Library ┐
│ Library (left, toggle)  │  3D preview + play bar + timeline strip   │  Controls / Outline / Selected node   │
│                         │  Graph editor (node canvas, below)        │  Imported assets / Diagnostics        │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## File bar

| Button | Does | MCP |
|---|---|---|
| **New** | Blank effect (clears undo history; Keep or Save first). | `vfx_new_document` |
| **Open…** | Open a `.vfx.json` or a `.vfxpack` (a pack is inspected first: contents, licences, warnings). | `vfx_open_document`, `vfx_inspect_pack`, `vfx_open_pack` |
| **Save .json** | Download the effect as `.vfx.json` (recipe only, imported asset bytes not included). | `vfx_save_document` |
| **Save as…** | Keep a copy under a new name and continue on the copy. | — |
| **Keep** | Store a copy on the local **Projects** shelf (same name replaces). Projects → Trash → Restore / Empty trash. | — |
| **Export pack** | Portable `.vfxpack`: effect + imported files + checksums. | `vfx_export_pack` |
| **Export media…** | Sprite sheet, PNG sequence, GIF or video: format, frame size, fps, background, camera (current view or fit the whole effect), glow; progress bar with Cancel ([export.md](export.md)). | `vfx_export_media` |
| **Export Roblox** | `.rbxmx` model + a report of what Roblox can't do ([export.md](export.md)). | `vfx_export_roblox` |
| **Undo / Redo** | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z. | `vfx_undo`, `vfx_redo` |
| **Import old effect** | Converts effects from the old editor (saved presets and the ten originals) into new editable copies. | `vfx_convert_legacy` |

The editor autosaves. If an autosave can't be read it is kept aside and offered as a download, never discarded. If
another tab changed the same effect, you choose which version to keep.

## Library (left)

Sections: **Presets** (whole effects: *Open* as a new effect), **Components** (ready layers: *Add to effect*
inserts one Group wired to Source/Target), **Assets** (the sprite library and imports) and **My Blocks** (groups you
saved). The search box matches name, element or type ("fire", "impact", "beam").
[`vfx_list_components`, `vfx_add_component`, `vfx_new_document { component }`]

## 3D preview and play bar

- **Mouse:** orbit / pan / zoom. **Reset camera** fits the effect again.
- **Source / Target handles:** drag them to aim the effect; everything wired to them follows. [`vfx_set_anchor`]
- **Play bar:** Play/Pause, **Restart**, step one tick back/forward, the tick field (type a tick to jump), **Loop**,
  speed 0.25× / 0.5× / 1× (sound only plays at 1×).
- **Toggles:** Glow on/off (see the raw shapes), light arena (check the effect on a light floor), grid and markers,
  **New seed each loop** (preview variations; the saved seed doesn't change), reduced effects (no flashes/shake).
- **Preview quality:** Reference (sharpest) · Balanced (default) · Economy (fast, no glow). Only the preview
  changes. A notice appears if the device runs slower than real time; the simulation is still exact.
- **Retry preview** appears if the GPU or the preview worker fails.

## Timeline strip (under the play bar)

One bar per component. Drag a bar to change its **Start at**; drag its right edge to change its length knob (Burn
time, Duration...) when it has one; click to select. Keyframed knobs show their keys as ticks on the lane.
[`vfx_list_timeline`, `vfx_set_control`]

## Controls panel (right)

All published **knobs** of the effect, grouped by component.

- Sliders for numbers, **colour pickers** for colours. Each component also has **Colour** (turn the whole
  component around the colour wheel, keeping the hot-core-to-cool-tip look) and one picker per part (Flame, Smoke &
  dust, Embers...). "Back to the original colours" resets them.
- **◇ keyframe button:** adds or removes a key at the playhead; the knob then animates between keys. "Stop animating"
  removes all keys (keeps the current value). Timing knobs can't be keyframed.
  [`vfx_list_controls`, `vfx_set_control`, `vfx_set_control_keys`]

## Outline panel

The parts of the effect (components and their renderers/lights). **Solo** shows only those parts in the preview
(the effect is unchanged); **Clear solo** undoes it. **Open** shows a component's internals in the graph.
[`vfx_render_frames { solo }`]

## Graph editor (node canvas)

- **Path bar** at the top: where you are (root → a group's internals). Escape goes up a level.
- **Add** a node from the tools menu (or right-click the canvas); **Insert** a component with a start time or "start
  when another part's event happens" (e.g. an impact that waits for the projectile's arrival).
- Drag from an output port to an input port to connect; only matching port types connect. Click a link to select it.
- **Right-click menu:** Copy, Paste, Duplicate, **Duplicate, same random pattern**, Delete, **Delete and
  reconnect** (links bypass the removed node), Group selection, Open internals, Save as my component, Fit view, Up
  to parent. Solo is on the Outline panel and the group's toolbar.
- **Group** (Ctrl/Cmd+G) wraps the selection into one Group node; **Save as my component** keeps it in My Blocks for
  any effect. [`vfx_group_nodes`, `vfx_save_group_component`]
- Keyboard: Delete/Backspace, Enter (open group), Ctrl/Cmd+D duplicate, Ctrl/Cmd+C / V copy/paste (also across
  effects), Escape, F fit view. Box-select by dragging on empty canvas; Shift+click adds to the selection;
  middle/right drag or Space pans.
- "Show parameter handles" reveals the unconnected parameter inputs (to drive a parameter from another node).
- Nodes with errors are outlined; hovering shows the messages.
[`vfx_add_node`, `vfx_connect`, `vfx_disconnect`, `vfx_move_node`, `vfx_duplicate_nodes`, `vfx_copy_nodes`,
`vfx_paste_nodes`, `vfx_remove_node`]

## Selected node (inspector)

Every parameter of the selected node, with units and ranges. Fields driven by a link or a knob show **Jump to
driver**, **Disconnect** or **Unbind**. Each field resets to its default; **Reset** resets the whole node (knobs and
links kept). Curves (over-life size/opacity/colour) open the curve editor. "Enabled" switches a node off without
deleting it. [`vfx_describe_node_type`, `vfx_set_params`]

## Imported assets

**Import texture…** (PNG / static WebP / JPEG, ≤ 16 MiB, ≤ 4096 px; role Color / Mask / Normal / Noise; flipbook
columns × rows and playback) and **Add model** (self-contained .glb, ≤ 20 MiB, ≤ 50k triangles, no animation;
import scale). Then **Use on selected Material / MeshRenderer** or **Add to effect** (a small ready component).
**Relink…** re-picks a missing file; **Remove** is refused while nodes use it; **Clean up unused files** frees space.
[`vfx_import_texture`, `vfx_import_mesh`, `vfx_add_asset_component`, `vfx_relink_asset`, `vfx_remove_asset`,
`vfx_cleanup_assets`]

## Diagnostics

Errors and warnings from the last compile. Click one to jump to the node and field. Meanings and fixes:
[troubleshooting.md](troubleshooting.md). [`vfx_compile`]

## Graph document JSON

An advanced panel that shows the effect's JSON; **Apply JSON** validates and applies edits, **Revert text** drops
them. [`vfx_get_document`]
