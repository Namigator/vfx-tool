# The editor: where everything is

A map of the web editor for an AI that helps a person use it (or drives it through a browser), and for the person.
Every editor action also exists as an MCP tool (named in brackets), so an AI never *needs* the UI.
Start the editor with `npm run dev` and open the printed address; `vfx_preview_url { docId }` gives a link that opens
an MCP document in it.

## Layout (redesigned 2026-10: resizable panes, one compact top bar, tabbed inspector)

```
┌ VFX Studio · effect name │ File  Export │ [Library][Graph][Inspector toggles] │ Undo Redo │ save status ┐
│ Library  ││  3D preview (View ▾ overlay: Glow/Grid/Light arena/Reduced/Quality/New seed/Reset camera)  ││ Controls │
│ (resize- ││  compact transport: Play/Restart/step/scrub/speed/loop/sound                               ││ Selected │
│  able,   ││  Timeline strip                                                                            ││ node     │
│  collaps-│├─────────────────────────────────────────────────────────────────────────────────────────── ││ Outline  │
│  ible)   ││  Graph editor (node canvas; resizable/collapsible split from the viewport above)            ││ Assets   │
│          ││                                                                                             ││ Sound    │
│          ││                                                                                             ││ Diagnos- │
│          ││                                                                                             ││ tics (n) │
└──────────┴┴─────────────────────────────────────────────────────────────────────────────────────────────┴──────────┘
```

Every splitter (Library↔rest, centre↔Inspector, viewport↔graph) drags to resize, has a minimum size, and
double-clicking it (or the matching top-bar icon button) collapses/expands that pane. Sizes persist per
browser (`localStorage`). The right side is a tab strip, not a long scroll — **Controls** is the default tab;
selecting a node in the graph switches to **Node** automatically; **Issues** (diagnostics) shows an error/warning
count badge. An empty effect shows "Open the Library and add a component to get started" in the viewport.

Keyboard: Space toggles Play/Pause (when focus isn't in a text field), Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z undo/redo,
Ctrl/Cmd+S downloads `.vfx.json`, Esc closes an open menu.

## Top bar

| Control | Does | MCP |
|---|---|---|
| **Effect name** (click to edit) | Renames the open effect. | — |
| **Top bar** → New | Blank effect (clears undo history; Keep or Save first). | `vfx_new_document` |
| **Top bar** → Open… | Open a `.vfx.json` or a `.vfxpack` (a pack is inspected first: contents, licences, warnings). | `vfx_open_document`, `vfx_inspect_pack`, `vfx_open_pack` |
| **Top bar** → Save .json | Download the effect as `.vfx.json` (recipe only, imported asset bytes not included). Also Ctrl/Cmd+S. | `vfx_save_document` |
| **Top bar** → Save as… | Keep a copy under a new name and continue on the copy. | — |
| **Top bar** → Keep | Store a copy on the local **Projects** shelf (same name replaces). | — |
| **Top bar** → Projects… | Opens a panel: Projects (open) → Trash (restore / empty) → Import old effect (converts old-editor presets and the ten originals into new editable copies). | `vfx_list_documents`, `vfx_convert_legacy` |
| **Export menu** → Export pack | Portable `.vfxpack`: effect + imported files + checksums. | `vfx_export_pack` |
| **Export menu** → Export media… | Sprite sheet, PNG sequence, GIF or video: format, frame size, fps, background, camera (current view or fit the whole effect), glow; progress bar with Cancel ([export.md](export.md)). | `vfx_export_media` |
| **Export menu** → Export Roblox | `.rbxmx` model + a report of what Roblox can't do ([export.md](export.md)). | `vfx_export_roblox` |
| **Export menu** → Export Unreal | Unreal Engine (Niagara) package as a .zip: effect.json, textures, README and a report, for the VfxStudioImporter plugin ([export.md](export.md)). | `vfx_export_unreal` |
| **Panel toggle icons** | Show/hide Library, Graph and Inspector (same as double-clicking their splitter). | — |
| **Undo / Redo icons** | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z. | `vfx_undo`, `vfx_redo` |

The editor autosaves (status shown at the right of the top bar). If an autosave can't be read it is kept aside and
offered as a download, never discarded. If another tab changed the same effect, you choose which version to keep.

## Library (left, resizable/collapsible)

Sections: **Presets** (whole effects: *Open* as a new effect), **Components** (ready layers: *Add* inserts one
Group wired to Source/Target), **Assets** (the sprite library and imports) and **My Blocks** (groups you saved).
The search box matches name, element or type ("fire", "impact", "beam").
[`vfx_list_components`, `vfx_add_component`, `vfx_new_document { component }`]

## 3D preview and transport

- **Mouse:** orbit / pan / zoom. **View ▾** overlay (top-right corner of the viewport) → **Reset camera** fits the
  effect again.
- **Source / Target positions:** open the right inspector's **Controls** tab. The **Source & Target** section has X/Y/Z fields in metres (Y is height). Press Enter or leave the field to apply; Undo restores the previous position. Viewport markers show their positions but cannot be dragged. [`vfx_set_anchor`]
- **Transport (one row under the viewport):** Play/Pause (▶/⏸), **Restart** (⟲), step one tick back/forward, the
  scrub bar with a tick readout, speed 0.25× / 0.5× / 1× (sound only plays at 1×), **Loop** (↻), **Sound** (🔊/🔇).
- **View ▾ overlay** (viewport corner): Glow on/off (see the raw shapes), Grid & markers, Light arena (check the
  effect on a light floor), Reduced effects (no flashes/shake), **New seed each loop** (preview variations; the
  saved seed doesn't change), Quality: Reference (sharpest) · Balanced (default) · Economy (fast, no glow — preview
  only), Reset camera. A notice appears if the device runs slower than real time; the simulation is still exact.
- **Retry preview** appears if the GPU or the preview worker fails.

## Timeline strip (under the play bar)

One bar per component. Drag a bar to change its **Start at**; drag its right edge to change its length knob (Burn
time, Duration...) when it has one; click to select. Keyframed knobs show their keys as ticks on the lane.
[`vfx_list_timeline`, `vfx_set_control`]

## Right inspector (tabs: Controls · Node · Outline · Assets · Issues · Sound)

The right side is a tab strip, not a long scroll. **Controls** is the tab shown by default; clicking a node in the
graph (or the Outline tab) switches automatically to **Node**; **Issues** (diagnostics) carries a badge with the
current error/warning count. **Sound** (audio audition) is parked behind its own tab since sound work is parked.

### Controls tab

All published **knobs** of the effect, grouped by component.

- Sliders for numbers, **colour pickers** for colours. Each component also has **Colour** (turn the whole
  component around the colour wheel, keeping the hot-core-to-cool-tip look) and one picker per part (Flame, Smoke &
  dust, Embers...). "Back to the original colours" resets them.
- **◇ keyframe button:** adds or removes a key at the playhead; the knob then animates between keys. "Stop animating"
  removes all keys (keeps the current value). Timing knobs can't be keyframed.
  [`vfx_list_controls`, `vfx_set_control`, `vfx_set_control_keys`]

### Outline tab

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

### Selected node tab

Every parameter of the selected node, with units and ranges. Fields driven by a link or a knob show **Jump to
driver**, **Disconnect** or **Unbind**. Each field resets to its default; **Reset** resets the whole node (knobs and
links kept). Curves (over-life size/opacity/colour) open the curve editor. "Enabled" switches a node off without
deleting it. [`vfx_describe_node_type`, `vfx_set_params`]

### Assets tab

**Import texture…** (PNG / static WebP / JPEG, ≤ 16 MiB, ≤ 4096 px; role Color / Mask / Normal / Noise; flipbook
columns × rows and playback) and **Add model** (self-contained .glb, ≤ 20 MiB, ≤ 50k triangles, no animation;
import scale). Then **Use on selected Material / MeshRenderer** or **Add to effect** (a small ready component).
**Relink…** re-picks a missing file; **Remove** is refused while nodes use it; **Clean up unused files** frees space.
[`vfx_import_texture`, `vfx_import_mesh`, `vfx_add_asset_component`, `vfx_relink_asset`, `vfx_remove_asset`,
`vfx_cleanup_assets`]

### Diagnostics tab

Errors and warnings from the last compile (the tab's badge shows the count). Click one to jump to the node and
field. Meanings and fixes: [troubleshooting.md](troubleshooting.md). [`vfx_compile`]

The **Advanced: document JSON** panel (Apply JSON / Load file… / Revert text) lives at the bottom of this tab.

## Graph document JSON

An advanced panel that shows the effect's JSON; **Apply JSON** validates and applies edits, **Revert text** drops
them. [`vfx_get_document`]

## Layout: resizing, collapsing, maximizing

- **Top bar layout switch — Preview · Split · Graph.** *Split* shows everything. *Graph* gives the graph the whole
  centre (the inspector stays, so you can edit the selected node) with a small floating preview in the corner
  (+ / − changes its size, × hides it, **Preview** in the graph's corner brings it back). *Preview* gives the 3D view
  the whole centre. **Ctrl+Space** maximizes the panel under the pointer and restores it again (as in Blender); the
  ⤢ button in the corner of the 3D view and of the graph does the same.
- **Borders between panels** can be dragged. Drag a border far past a panel's minimum to hide that panel; the
  panel buttons in the top bar bring it back. Double-click a border to reset that panel's size. With a border
  focused, arrow keys resize (Shift = bigger steps) and Enter hides/shows. Sizes and the layout are remembered.
- On narrower windows the less-used file actions (Save as…, Projects…, Import old…) fold into **More**.

## Help inside the editor

- **Tutorial** (top bar): a short guided tour that spotlights each part of the editor in turn. It only runs when
  you press it; Esc leaves, ←/→ step.
- **Node tab:** selecting a node shows what it does and, under every setting, what that setting means (the same
  text as [reference/nodes.md](reference/nodes.md)). Selecting a component box shows the component's description.
- **Add node** is grouped by role; hover an entry (or pick it) to read what it does. Hovering a node's type in the
  graph shows the same description.
