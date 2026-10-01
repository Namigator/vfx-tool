# Export: getting an effect out of VFX Studio

| Format | For | Status |
|---|---|---|
| `.vfx.json` | The effect recipe (graph, knobs, anchors). Re-open in VFX Studio. | available |
| `.vfxpack` | Portable: recipe + imported textures/models + checksums. Share with another person or machine. | available |
| Roblox `.rbxmx` | A Roblox model with native emitters, beams, trails, lights and a player script. | available |
| Sprite sheet / PNG sequence / GIF / MP4 / WebM | Rendered frames for any engine (flipbook textures) or for showing the effect. | available |
| Unreal (Niagara) | A folder package (IR + textures + docs) imported by the VfxStudioImporter plugin into a NiagaraSystem. | available |
| Unity | | planned (needs Unity installed) |
| Godot 4 (`.tscn`) | GPUParticles3D scene with exact life curves, timing animation, lights. | available |

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

## Unreal Engine (Niagara)

`vfx_export_unreal { docId, path? }` (default `work/unreal/<docId>/`) or the editor's **Export Unreal** writes a
**folder package** (the editor button zips it):

- `effect.json`: the engine-neutral IR — emitters (rate/bursts/shape/forces/curves), ribbons (path layers), lights.
- `Textures/*.png`: the sprite sheets the effect uses.
- `README.md`: import steps (below).
- `report.md`: every approximation or drop versus the VFX Studio preview.

### Units and axes

VFX Studio authors in **metres**, right-handed, **+Y up**. Unreal uses **centimetres**, left-handed, **+Z up**. The
exporter applies the same axis swap Unreal's own FBX/glTF importers use for a right-handed Y-up source:

```
ue.X = src.X * 100
ue.Y = src.Z * 100
ue.Z = src.Y * 100      (our up -> Unreal's up)
```

Keep X, swap Y and Z, scale metres to centimetres. This also flips handedness correctly (a right-handed source
becomes Unreal's left-handed frame), so shapes and windings come through unmirrored. The one place this needs a
manual check is a **signed rotation about a single axis** — a vortex/curl force's swirl direction: the exporter keeps
the authored sign, and the report flags every vortex export so you can flip the axis in Niagara if the swirl looks
mirrored. The NiagaraSystem's origin is the **Source** anchor (the caster / nozzle): place or attach the actor
there.

### Importing it: the VfxStudioImporter plugin

The plugin lives in the VFX-Tool repo at `integrations/unreal/VfxStudioImporter/` (source only: `.uplugin` +
`Build.cs` + C++, no binaries checked in).

1. Copy `integrations/unreal/VfxStudioImporter/` into `<YourProject>/Plugins/VfxStudioImporter/`.
2. Open the project (or regenerate project files and build first if your workflow needs that) so the editor compiles
   and loads the plugin module.
3. Import a package:
   - **Commandlet** (headless, scriptable): `UnrealEditor-Cmd.exe <Project>.uproject -run=VfxStudioImport -Package="<path to the export folder>" -Dest=/Game/VFXStudio/<name>`
   - **Python console / editor utility script**: `unreal.VfxNiagaraImporter.import_package(package_dir, dest_path)`
4. The importer reads `effect.json`, imports the textures, creates one Material Instance per blend-mode/texture
   combination from a material the plugin builds once (TextureSampleParameter2D, a flipbook/SubUV node when the IR
   has one, ParticleColor, additive vs translucent variants), chooses a stock Niagara emitter template per IR emitter
   (`effect.json` emitter field `suggestedTemplate`: Fountain, SimpleSpriteBurst, Minimal, Ribbon or Light) and sets
   its module inputs (rate, lifetime, speed, size/colour/opacity-over-life curves, drag, Curl Noise Force, spawn
   shape), then compiles and saves one `NiagaraSystem` (`NS_<name>`) with one emitter per IR emitter.
5. Drag the system into a level, or spawn it at runtime with `UNiagaraFunctionLibrary::SpawnSystemAtLocation`. The
   system plays once by default (no loop); a future pass can expose a loop toggle per the system's own loop settings.

### What changes in Unreal (the report lists it per effect)

What the importer actually builds today (seen in UE 5.8 on the flamethrower, lightning strike and charge-up):

| VFX Studio | In Unreal (Niagara) today |
|---|---|
| Spawn rate over time | the window's peak rate (Spawn Rate) |
| One burst | Spawn Burst Instantaneous |
| Many bursts (smoke/embers born at flame deaths) | a steady rate with the same total over the bursts' span |
| Lifetime, speed, direction, gravity/acceleration, drag | kept |
| Opacity over life | **exact**: written into the templates' Scale Alpha curve |
| Size over life | **exact**: a Scale Sprite Size module with a size curve over life (particles are born at the curve's first size) |
| Colour over life | **exact**: Scale Color in its RGBA colour-curve mode (colour and opacity per life) |
| Flipbook sheets | **animated**: Particle SubUV material + SubUV Animation at the sheet's frames per second (loops or holds the last frame; random start frame kept) |
| Velocity-stretched sprites | velocity-aligned sprites (no stretch) |
| Emitters that start away from Source (smoke at the target...) | kept: Shape Location offset (the importer turns on its Offset Mode switch, which the stock template ships off) |
| Curl noise, attraction, vortex, ground collision | stock Curl Noise / Point Attraction (no falloff, particles reaching the core die) / Vortex / Collision modules before the force solver; the vortex has no distance falloff in Niagara, so far particles swirl a little harder |
| Keyframed knobs | their tick-0 value |
| Lights | one single-particle emitter each with a Niagara Light renderer: colour x peak intensity, radius, on/off timing, intensity track as its brightness over life (exponent falloff) |
| Ribbons (lightning, streams, rings) | baked into static meshes (each path a cross of two strips, its width, end fade and per-path opacity): up to 6 shapes per layer, each shown for its share of the layer's visible time with the per-frame flicker kept as opacity; a bolt that re-forms every frame shows 6 shapes instead of every one; no texture |
| Light position | kept (a light at the target lights the target) |
| Mesh particles; dissolve, rim, distortion; screen flash, camera shake | left out |
| Glow | Unreal's own bloom/post-process (not exported) |

### Checking an import

`node tools/unreal-check.mjs <package-dir>` imports the package into the test project and renders a frame in a
windowed editor kept off-screen (`tools/unreal-capture.py`: waits for shaders, places the system at Source height,
simulates `VFX_UE_SECONDS` = 1.0 s, captures through a SceneCapture2D) to `work/unreal/<name>.png`. `VFX_CAM_X`/`VFX_CAM_DIST` frame long effects (a 15 m bolt: 700/1600), `VFX_UE_SKIP_IMPORT=1` re-renders without importing; `node --experimental-strip-types tools/unreal-export.mjs <component>` writes a package for any built-in component. Read the image;
the script does not judge it.

## Godot 4

`vfx_export_godot { docId, path? }` (default `work/godot/<docId>/`) or the editor's **Export → Export Godot** (a zip)
writes `<name>.tscn`, `Textures/*.png`, `README.md` and `report.md`, plus `ribbons.json` + `vfx_ribbons.gd` when the effect has beams. (When exporting a Godot game, add `*.json` to the export filter so the beam data is packed.)

- Copy the folder into your project as `res://vfx_studio/<name>/` (the scene's texture paths point there) and instance
  the scene where the effect starts: its origin is the **Source** anchor. It plays once on load; call
  `$AnimationPlayer.play("play")` to play it again.
- Godot uses metres and +Y up like VFX Studio, so positions and directions carry over unchanged.
- Each emitter is a `GPUParticles3D` with a `ParticleProcessMaterial`: spawn shape, direction/spread, speed, gravity,
  lifetime, spin, flipbook animation. **Size, colour and opacity over life are exact** (Godot curves and colour ramps).
  An `AnimationPlayer` ("play", autoplay) switches emitters on and off, scales the rate over time (`amount_ratio`),
  fires bursts (one-shot, explosive), moves moving sources (projectiles) and animates light intensity (`OmniLight3D`).

| VFX Studio | In Godot 4 |
|---|---|
| Size / colour / opacity over life | exact |
| Rate over time, one burst, moving source, light intensity | exact timing (animation tracks) |
| Many bursts | a steady rate over their span (same total) |
| Drag | damping matched at launch speed (Godot damping is constant) |
| Curl noise | turbulence with a small influence (check the look) |
| Velocity-aligned sprites | Align Y with no billboard (no stretch) |
| Burning-edge dissolve, rim glow | left out: tongues show crisp edges |
| Beams/ribbons (lightning, streams, rings) | every path (trunk + branches) with its flicker/decay, baked per frame in `ribbons.json`, drawn by the bundled `vfx_ribbons.gd` as camera-facing strips; no texture scrolling/distortion |
| Mesh particles, attraction, vortex, ground collision | not exported yet (report.md) |
| Screen flash, camera shake | left out |

`node tools/godot-check.mjs <package-dir> [seconds]` builds a throwaway Godot project (camera, floor, glow), imports
the package and renders frames with Godot's movie writer to `work/godot/<name>.png` (Godot: `VFX_GODOT`). Read it.

## Choosing what to build for export

If the effect is meant for Roblox, prefer what converts cleanly: sprite particles with over-life curves, beams for
paths, a trail on a projectile head, one or two lights. Put essential motion in speed/gravity/drag rather than
turbulence or vortex, and read the report after every export.
