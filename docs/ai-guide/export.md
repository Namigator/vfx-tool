# Export: getting an effect out of VFX Studio

| Format | For | Status |
|---|---|---|
| `.vfx.json` | The effect recipe (graph, knobs, anchors). Re-open in VFX Studio. | available |
| `.vfxpack` | Portable: recipe + imported textures/models + checksums. Share with another person or machine. | available |
| Roblox `.rbxmx` | A Roblox model with native emitters, beams, trails, lights and a player script. | available |
| Sprite sheet / PNG sequence / GIF / MP4 / WebM | Rendered frames for any engine (flipbook textures) or for showing the effect. | available |
| Unreal (Niagara) | | planned |
| Unity | | planned |
| Godot | | planned |

## Recipe and pack

- `vfx_save_document { docId, path }` / editor **Save .json**: the document only. Imported asset bytes are not in it
  (the included sprite library is, by name).
- `vfx_export_pack { docId, path?, draft? }` / **Export pack**: a `.vfxpack` with the imported files and a checksum
  manifest. `draft: true` allows missing asset bytes (incomplete pack, for work in progress).
- `vfx_inspect_pack { path }`: look inside without opening: name, contents, included sprites that changed since
  packing, required capabilities, warnings and licences.
- `vfx_open_pack { path, docId? }` / **Open…**: verifies paths and checksums (`CHECKSUM_MISMATCH` if the bytes were
  changed), restores the files and opens the effect.

## Media: sprite sheets, PNG sequences, GIF, video

`vfx_export_media { docId, format, ... }` or the editor's **Export media…** renders the effect frame by frame
(deterministic, not a screen recording; floor, grid and markers left out). Files go to `work/mcp/media/<docId>.<ext>`.

| format | output | typical use |
|---|---|---|
| `spritesheet` | one PNG grid + `.json` sidecar {columns, rows, frameCount, fps, frameWidth, frameHeight, durationTicks, loop, ...} | a flipbook texture for Unity / Unreal / Godot / any engine |
| `png-sequence` | a .zip of numbered PNGs | compositing, engines that import sequences |
| `gif` | looping animated GIF (dark background by default: GIF alpha is on/off only) | chat, docs, previews |
| `mp4` / `webm` | H.264 video (WebM/VP9 if H.264 isn't available), solid background, no audio | showing the effect |

- `background`: `transparent` (default for sheets and sequences) | `dark` | `light`. Transparency is exact for
  glow and smoke as they look on a dark scene; screen flashes and camera shake only appear on solid backgrounds.
- `fps` samples a tick every 60/fps (30 default, 20 for GIF). A 2 s effect at 30 fps = 60 frames. Keep sheets
  small for games: 128–256 px frames, 15–30 fps, only the ticks you need (`startTick` / `endTick`).
- Camera: by default fits the **whole** effect over all exported ticks; `orbit` looks from another side; `camera`
  sets an exact pose. A long horizontal jet in a square frame leaves empty space: use `width`/`height` to match it.
- Limits: frames ≤ 4096 px, sheets ≤ 16384 px per side, ≤ 1200 frames per export.
- Look at the returned preview image before handing the file over.

## Roblox

`vfx_export_roblox { docId, path? }` (default `work/roblox/<docId>.rbxmx`) or the editor's **Export Roblox** writes:

- `<name>.rbxmx`: a Model with an attachment per emitter, native **ParticleEmitters**, **Beams** (for paths:
  lightning, streams, rings), **Trails** (a single particle trail on a moving head, e.g. a projectile), **PointLights**,
  Parts for mesh particles, an **EffectPlayer** ModuleScript that replays the timeline, and a disabled **Demo** script.
- `<name>.report.md`: what was converted, approximated or left out, plus textures and a how-to.

### Units and placement

1 m = 3.571 studs (a 1.8 m character ≈ 6.4 studs, about a Roblox avatar). The model's pivot is the floor point under
the Source anchor; the effect starts at the Source height above it.

### Playing it

```lua
local EffectPlayer = require(model.EffectPlayer)

-- as authored, at the model's pivot:
local p = EffectPlayer.play(model)

-- aimed from a caster to a hit point (stretches the Source->Target line, rotates to face the target):
local p = EffectPlayer.play(model, nil, {
    source = caster.HumanoidRootPart.Position,  -- Vector3 or CFrame
    target = mouseHit,                           -- Vector3
    speed = 60,          -- projectile studs/s   (or travelTime = 0.5 seconds; neither = authored speed)
    scale = 0.5,         -- resize for your game: sizes, speeds, widths, light range (reach still follows target)
    loop = false,
})
p.setTarget(enemy.Position)   -- follow a moving target mid-flight
p.hit(hitPosition)            -- the projectile really hit something: jump to the impact now, there
p.stop()
```

Everything after the arrival (impact, sparks, lights) moves with the retimed flight. Sizes, widths and heights are
not stretched by aiming; only positions along the aim line are. `EffectPlayer.create(...)` returns the same handle
plus `update(dt)` / `isDone()` for hosts that drive time themselves.

### Textures

Sprites need Roblox asset ids. `node tools/roblox-upload-textures.mjs --creator-user <userId> --yes <png files>`
uploads them with Open Cloud (needs `ROBLOX_OPEN_CLOUD_API_KEY`; without `--yes` it only shows what it would do) and
records the ids in `work/roblox/asset-ids.json` (sheet file → `rbxassetid://…`). Exports read that file. A sprite
with no id falls back to Roblox's built-in fire / smoke / sparkles texture (flipbook off) instead of showing squares.
Roblox flipbooks must be 2×2, 4×4 or 8×8; other grids play as a single image.

### What changes in Roblox (the report lists it per effect)

| VFX Studio | In Roblox |
|---|---|
| Velocity stretch | Squash on velocity-parallel particles |
| Trails behind many particles | stretched velocity-aligned particles |
| Over-life curves | NumberSequence / ColorSequence, max 20 keys |
| Keyframed knobs | the first key's value (not animated) |
| Forces that change over time | full strength |
| Disc emission | Disc shape emitting along its normal |
| Emission along a path | point emitter at the path start |
| Flat ground-facing sprites (rings) | camera-facing |
| Light flicker | its average brightness; range capped at 60 studs |
| Liquid material on a ribbon | plain translucent Beam |
| Turbulence, vortex, attraction, ground bounce/collision | left out (particles fly straighter, pass through floors) |
| Dissolve, rim glow, ribbon distortion | left out |
| Screen flash, camera shake | left out |

Heavy path effects get a warning when they need many Beam segments at once (mobile cost).

### Checking an export without opening Studio

`node tools/roblox-check.mjs <file.rbxmx>` loads the model into real Roblox Studio headlessly (rojo + run-in-roblox)
and runs the player: plain play, an aimed run (90°, 2× distance, custom speed, scale 0.5), an early `hit()`, and
checks trails and mesh parts. It needs Studio installed.

### Studio steps (for a person)

1. Workspace → right-click → **Insert from File** → the `.rbxmx`.
2. Move the model to where the effect happens.
3. Preview: enable the model's **Demo** script and press Play. In your game: `require(model.EffectPlayer).play(model, …)`.

## Choosing what to build for export

If the effect is meant for Roblox, prefer what converts cleanly: sprite particles with over-life curves, beams for
paths, a trail on a projectile head, one or two lights. Put essential motion in speed/gravity/drag rather than
turbulence or vortex, and read the report after every export.
