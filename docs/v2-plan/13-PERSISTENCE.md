# Local storage, archives and recovery

## Storage model

Use native IndexedDB database vfx-studio-v2, database version 1. Stores: documents (id), revisions ([documentId,revision]), assets (byteHash), assetMetadata (assetId), blocks (id/revision), preferences (key). Legacy localStorage remains untouched except explicit legacy save actions.

Document records store latest valid or draft JSON, dirty status, revision and timestamps. Asset bytes are deduplicated immutable Blobs. All references and asset writes required by a save commit in one transaction. A failed transaction must leave the previous revision loadable.

Autosave 750 ms after the last committed authored edit and on explicit Save. Keep five prior document revisions plus the latest. Quota policy never silently deletes named documents or referenced assets. Warn before exceeding the application's 512 MiB local asset budget and show storage usage/portable backup controls. Browser quotas may be lower; catch QuotaExceededError and preserve the in-memory document.

Request persistent storage only through an explicit "Keep local projects on this device" action. Browser storage remains origin-specific and can be cleared; Save locally is not a filesystem backup. Switching hostname/port changes the origin and therefore the library.

## Export formats

1. .vfx.json: semantic document plus editor layout, built-in/user asset references and metadata, but no bytes. Export warning names non-builtin dependencies. Import can resolve local assets by hash. This is a recipe, not guaranteed self-contained.
2. .vfxpack: ZIP archive containing manifest.json, effect.json, assets/<hash>.<extension>, metadata/<assetId>.json, licenses/ notices, optional preview.png and rendered/mix.wav.
3. .wav: current canonical rendered audio mix.

Portable export includes every referenced original asset byte, including built-ins, and checksums. It also includes embedded group graphs and controls. Generated GPU caches, decoded texture pixels and simulation checkpoints are excluded. A preview thumbnail is optional; do not fabricate one when no capture occurred.

manifest.json fields: format "vfx-studio-package", packageVersion 2, documentPath, schemaVersion, runtimeVersion, files[{path,sha256,bytes,mime,role}], creation tool version, state (validated or draft) and capability list. Checksums cover file payloads, not the archive's ZIP metadata. Exclude manifest itself from its checksum list.

## Import validation

Preflight file size and ZIP entries; parse in a worker. Limits: archive ≤100 MiB compressed, ≤256 MiB actual expanded bytes, ≤256 entries, JSON ≤5 MiB, manifest ≤256 KiB; per-asset limits from the asset document. Track actual streaming output and abort above limits even if header sizes lie.

Reject absolute paths, drive letters, backslashes, empty or dot/dot-dot path segments, symlinks, duplicate normalized names, encrypted entries, unsupported compression, missing manifest files and checksum mismatch. Never write archive paths directly to the filesystem; archive content stays in staged memory/IndexedDB keys.

Decode UTF-8 JSON, validate types/versions/depth (max 32) and graph limits. No eval, HTML rendering, remote URLs or automatic asset downloads. Unknown versions enter read-only recovery where raw JSON can be downloaded; do not silently downgrade.

Stage the document and available assets first, show name, counts, warnings, licenses and required capabilities, then Import commits atomically. Validated packages require all referenced assets; draft packages may preserve missing references, which keep preview/validated export blocked. Existing active project is autosaved before replacement. Same document ID from outside imports as a new local copy by default; Replace existing is explicit and creates a backup revision.

## Draft versus validated package

A draft archive may preserve incomplete graphs/missing references and is labeled draft in manifest; it cannot pretend to be a runnable preset. Default Export effect requires validation and all assets. Offer Export draft separately when a graph is incomplete so work is not trapped.

Audio mix export checks audio revision equals document audio hash. If stale, render or report the error; never ship an old mix as current. WAV inside a package is a convenience cache; the graph and source assets remain authoritative.

## Recovery and concurrency

On load validate the newest revision; if corrupt, present Recover previous revision with timestamps. Preserve corrupt bytes for download/debug, do not overwrite them with an empty graph.

Two tabs editing one document use revision compare-and-swap plus BroadcastChannel notifications. A stale tab is blocked from overwriting; offer Reload or Save as copy. BroadcastChannel absence falls back to revision checking at save. No collaborative merging is implemented.

Delete project moves it to a local trash record for the session and remains undoable until closing; explicit Empty trash removes document references. Asset cleanup computes references across documents, revisions, blocks and active undo history. Use an explicit cleanup action and report reclaimed size; never delete on every edit.

## Tests

Round-trip a mixed graph with imported texture/GLB/WAV through a fresh origin with no cached built-ins. Verify hashes and editable internals. Simulate quota, interrupted transaction, missing asset, duplicate IDs, stale tab, corrupt latest revision and malicious archive paths/size claims. All failure cases preserve the original active project.

