# Editor workflows and interaction specification

## Workspace

Desktop-first. At ≥1280×800: left library 220 px, right inspector 320 px, resizable middle with viewport above graph (initial 60/40 vertical split), transport between them. Header: project name, New, Open, Save, Export, Undo/Redo. At 1024–1279 px, library/inspector become toggled drawers. Below 1024 px show a compact preview and "Desktop authoring recommended"; mobile authoring is not a release requirement.

Library tabs: Presets, Components, Assets, My Blocks. Search is local and filters by name/tags/type. Default presets show actual captured thumbnails only after visual acceptance; unfinished thumbnails are marked Pending review.

Open a preset in Simple view: component blocks, their enable/solo controls and published knobs. Graph tab exposes the same components and wiring. Advanced opens a component's internal graph. No separate hidden recipe exists for Simple mode.

## Primary workflows

1. Preset variation: choose Lightning → disable Impact Sparks → change bolt thickness → duplicate a branch group → modify color → Save As.
2. Blank composition: New Blank → Add Lightning Bolt → source/target auto-connect → Add Impact Burst at arrival/discharge event → Add Sound → preview.
3. Deep edit: select Flames → Open internals → replace texture/flipbook → add NoiseForce → adjust opacity curve → return to top.
4. Reuse: select connected nodes → Group selection → expose chosen parameters → Save as block → insert independent copy in another effect.
5. Asset workflow: import texture/mesh/WAV → preview/metadata → Add to effect → suitable component inserted with supported material.
6. Debug: Solo Smoke → inspect across timeline/backgrounds → jump to input driver → fix curve → clear Solo.

Add component uses a complete documented template and connects available compatible anchors/events/root outputs. If several context ports are compatible, show a short explicit choice; do not silently wire an arbitrary event. Primitive Add creates the node with literal defaults and a clear Unconnected badge.

## Graph interactions

Pan with middle drag or Space+drag; zoom wheel; select click; multiselect Shift; box-select drag on empty canvas; move group transaction ends on pointer-up. Keyboard equivalents: Tab through nodes, Enter select/open, Delete removes selected authored nodes, Ctrl/Cmd+D duplicates, Ctrl/Cmd+G groups, Escape exits selection/editor, F fits graph, Ctrl/Cmd+Z undo and Shift+Z redo. Suppress graph shortcuts while editing text/numbers.

Context menu and toolbar duplicate critical actions. Node cards show name/type, enabled, Solo, small summary and warning count; advanced numeric fields live in inspector, not dozens of tiny graph controls. Connections use port names/icons as well as colors. Invalid connect shows a precise reason. Error panel can focus the responsible node/field.

Expose "Add connected node" from a dangling compatible port. Copy/paste uses application JSON on clipboard with schema validation and asset reference reconciliation. Across documents, prompt to include referenced local assets; never leave silent unresolved links.

## Inspector

Render controls from node metadata: labels, units, bounds, defaults, help, animated/driven status, reset. Number fields keep a local draft, commit on Enter/blur, Escape restores. Empty/invalid drafts revert and give a brief message. Slider drag creates one undo transaction; keyboard adjustment groups from keydown to keyup. Color dialogs group until close/blur. Reset affects only the chosen field unless Reset block is selected.

Curve editor has draggable points plus a keyboard-accessible numeric key table. Enforce ordered unique x values; add/delete keys; linear/hold interpolation; zoom to domain. Gradient editor has stop positions, color/alpha and numeric editing. No inaccessible canvas-only editing.

Changing a driven field opens its source or offers explicit Disconnect/Unbind. A macro displays every affected internal field and its mapping. Controls do not pretend to be independent if they share a driver.

## Transport and preview

Play/pause, Restart, Loop, one-tick step, scrub, .25x/.5x/1x and Sound. Timeline displays duration, event markers, selected layer's lifetime window and pending audio/seek state. Dragging scrub pauses and is silent. End of a nonlooping cast stops exactly at duration. Loop restarts from tick 0 with a fixed seed; optional New seed on cast is an explicit preview setting, off by default.

View tools: fit/reset camera, grid/markers, dark/light background, glow, optional presentation, quality profile and diagnostics. Hidden tabs pause and require Resume when returning. A reduced-effects preference suppresses flash/camera impulse and respects prefers-reduced-motion.

## Commands, history and dirty state

All authored edits use commands with inverse patches and an explicit transaction ID. Keep 100 undo transactions or 20 MiB of patch data, whichever is reached first. Assets are referenced, never copied into undo snapshots. Redo clears only after a real new edit; no-op edits preserve it. Layout moves are undoable but do not recompile. Camera/Solo/selection are not authored undo entries.

Autosave state is visible: Saving, Saved locally, Save failed. Save As names a separate document. Built-in presets are immutable; editing creates a draft copy. Closing/replacing a dirty document flushes autosave or shows the concrete failure and offers portable download.

## Accessibility and errors

Readable 14 px minimum primary controls, 40 px primary action targets, visible focus, accessible labels, logical keyboard order and color-independent statuses. Provide an outline/list view of components for screen-reader navigation and enable/solo/reorder operations. Announce errors/saves through a polite status region without frame-by-frame chatter.

Renderer failure leaves graph and export accessible. Worker failure pauses and offers Retry preview. Missing assets link to Relink. Invalid graph pauses with last valid preview clearly marked stale. Never replace a user's project with defaults after an exception.

