// vfx_guide: authoring know-how distilled from the ten element families built with this tool (A-05 finding:
// fresh agents had every capability but not the recipes — e.g. a continuous flame jet needs many small, faint,
// stretched additive tongues, not a few big bright ones). Plain text, one topic per entry, no source code.

export const GUIDE: Record<string, string> = {
  basics: `BASICS
- Graph: Schedule (when) -> Emitter (how many/where) -> InitialProperties (size/colour/spin) -> forces (Gravity, Drag, NoiseForce, Attract, Vortex, GroundCollision) -> BillboardRenderer/MeshRenderer/ParticleTrail + Material -> EffectOutput.visual. Paths (LinePath, BezierPath, JaggedPath, HelixPath, RingPath...) -> RibbonRenderer draw beams, bolts, rings.
- Time is in ticks (60/s). A Schedule "window" opens [startTicks, startTicks+durationTicks); continuous emitters use Rate + a window and Burst 0; bursts use Burst + Trigger (Schedule start, PathFollower arrival, ParticleEvents...).
- Event-relative timing: connect an event to Schedule.trigger so the window starts relative to it (impacts after an arrival).
- vfx_compile after every batch: read warnings (tail cut off, event ticks, lights). vfx_render_frames: always look at the images; it also reports lit/bright coverage and warns on glow flooding.
- Tip: build one layer at a time and render it alone before stacking the next.`,

  glow: `GLOW, BRIGHTNESS AND BLENDING
- Additive sprites ADD: 200 overlapping sprites at opacity 1 become a blown-out blob and the bloom floods the frame. Dense additive layers need LOW per-sprite opacity (0.05-0.2) and emission 0-0.5; only a small hot core may use emission 1-2.
- Glow is per effect on EffectOutput: glowStrength (0.8), glowRadius (0.45; 0.2-0.3 = tighter), glowThreshold (1; raise to 1.3-1.6 for dense fire), glowLimit (3; 1.5-2 for dense additive stacks). If vfx_render_frames warns "glow flooding", lower per-sprite opacity/emission first, then glowLimit.
- blend "normal" for smoke, dust, water, dark or opaque stuff; "additive" for fire tongues, sparks, glows, energy.
- Colour: keep fire orange-yellow (#FFB040..#FFE9B0); reds (#C02000) only at the very end of life and faint. Saturated red at full opacity reads as "petals".`,

  fire: `FIRE / FLAMETHROWER JET (continuous flame body) - proven against the standalone reference
- Flame BODY: two emitters (sprites flame-tongue-a / flame-tongue-b), each: cone, coneAngle ~0.105 (6 deg half-angle), radius 0.02, rate ~210/s (420 total), speed 8.5-11 m/s, life 0.4-0.75 s, Burst 0, rateOverWindow [0:0.35, 0.04:1, 0.92:1, 1:0], Aim = Target.
- InitialProperties size 0.22-0.30 (the tongue fills only half its square cell, so sprites must be about twice the flame width you want).
- Forces: Drag 0.18, NoiseForce vector amplitude ~3 frequency 0.55, Gravity [0,0.9,0] (the far end billows up).
- BillboardRenderer: alignment velocity, stretchRatio ~1.6, pivot 0.38, flipbookMode overLife; sizeOverLife [0:1, 0.7:3.7, 1:2.2]; opacityOverLife [0:0, 0.07:1, 0.55:1, 1:0]; colorOverLife white -> #FFE0A0 -> #FFA050 -> #C8501E -> #5A1E0A (the flame COOLS as it ages - this is what gives the white root, orange body and dark red tips).
- Material: blend NORMAL (not additive), opacity ~0.62, dissolve 0.6 from 0.5 of life. Normal blend keeps the body readable and never floods the glow.
- Faint additive accent: a second BillboardRenderer on the same particles (flame-tongue-a, additive, opacity ~0.05, tint #FFF2D0), visible only while young (opacityOverLife [0:0, 0.05:1, 0.45:0]).
- Hot core: cone 3 deg (0.052), rate ~130/s, speed 10-13, life 0.23-0.43 s, size 0.15-0.18, additive, opacity ~0.13, tint #FFF6E0, stretchRatio ~1.9.
- Smoke and embers are born WHERE TONGUES DIE: ParticleEvents(death) on each tongue chain -> Emitter with Burst 1, useEventPosition, inheritVelocity 0.35-0.45. Smoke probability ~0.08 (smoke-puff, normal, #6A625A, opacity peak ~0.32, size 0.35-0.5 growing x2.4, Gravity up 1.6, life 1-1.9 s). Event-born particles INHERIT the jet speed: always add Drag (~1.2-1.6) to smoke and embers or they fly out of frame; check with vfx_sample_particles if something seems missing. Embers probability ~0.1 (spark-streak additive + a SpriteUnlit ParticleTrail, Gravity down ~3.5, life 0.5-1.2 s).
- Glow: the default EffectOutput glow works with these values (core opacity ~0.13, accent ~0.05); only touch glow settings if vfx_render_frames warns about flooding.
- Light: two PointLights along the jet (OffsetAnchor 1.2 m and 3 m from Source, 0.3 m up), #FF7A28, intensity ~16, range ~3.5, flicker 0.25.
- Ignition: SpriteRenderer soft-glow variant 1 at the muzzle (11 ticks) + CameraImpulse (translation 0.03). Nozzle: PropMesh cylinder at Source aimed at Target (pivot end), leg PropMesh Direction [0,-1,0] pivot start; a dark lit Material (#3A2E26, roughness ~0.55, metalness ~0.4) so it reads as metal, not a bright grey bar.
- Decay / billows elsewhere: sprite fire-puff (a fire blob that cools and tears apart).`,

  smoke: `SMOKE / DUST / CLOUDS
- smoke-puff flipbook (overLife), blend normal, tint greys/browns, randomFrameStart + random rotation + slow spin (angular velocity +-0.4).
- Few, large-growing particles: size 0.2-0.5 growing x2.5-4; opacity peak 0.25-0.6 early then fade; Drag 0.6-1.6 so they slow; Gravity up 0.1-1.4; NoiseForce curl low amplitude for curling.
- Material groundFade 0.2-0.3 so puffs touching the floor fade softly instead of being cut. Dark smoke on dark floors is invisible - lighten it or render on background "light" to check.`,

  sparks: `SPARKS / EMBERS / DEBRIS
- spark-streak sprite, additive, alignment velocity, stretchRatio 3-6, pivot 0.7-0.8, size 0.015-0.04, emission 0.8-1.5.
- Burst on an event (impact) or a low rate (20-60/s) during a window; Gravity down for sparks, up for embers; Drag 1-2; GroundCollision bounce restitution 0.3 for impacts.
- colorOverLife white -> orange -> dark red with alpha 0 at the end. ParticleTrail adds tapered streaks (history 0.08-0.15 s); it needs a separate SpriteUnlit Material (additive, tinted).
- Stones/debris: MeshRenderer rock-a/b/c, orientation tumble, lit, rough Material (roughness 0.85).`,

  beams: `BEAMS, BOLTS, RINGS (ribbons)
- LinePath/BezierPath between Source and Target; JaggedPath + BranchPath for lightning; HelixPath for swirling wind/energy; RingPath for shockwaves.
- RevealPath with a Time/ScalarMath fraction animates a bolt shooting out. RibbonRenderer width 0.02-0.08 with endFade; layer a thin bright core over a wider faint sheath.
- Textured ribbons (Material SpriteTextured electric-arc / smoke-puff) with uvScroll and uvDistort for flowing energy/wind.`,

  projectile: `PROJECTILES AND TIMING
- BezierPath from Source to Target -> PathFollower (Travel ticks, or Speed m/s). Its Anchor output moves SpriteRenderer cores, emitters (trails of sparks), PointLights and MotionTrail.
- Its Arrival event triggers impact Schedules (Schedule.trigger), bursts (Emitter.trigger) and flashes, so the impact always lands when the projectile does.
- Charge-up before launch: Attract pulls motes inward to an anchor; a SpriteRenderer core grows with sizeOverWindow.`,

  props: `PROPS AND MESHES
- PropMesh: one static mesh (cylinder, box, cone, orb, shard, rock-*, crystal*, or an imported GLB) at an anchor, pointing at Aim (another anchor) or along Direction. Width = size, Length = along the pointing direction. pivot start: the mesh begins at the anchor and extends along the pointing direction (legs, posts); pivot end: it ends at the anchor, body behind (nozzles, barrels); center: centred.
- OffsetAnchor moves an anchor by a fixed offset (a floor point under the target, a point above a hand...).
- Lit meshes need light: a PointLight near them; Material roughness/metalness shape the look; rim adds an edge glow.`,
};

export function guideText(topic?: string): string {
  if (!topic) return `Topics: ${Object.keys(GUIDE).join(', ')}. Call vfx_guide with a topic. Start with "basics" and "glow".`;
  const t = GUIDE[topic.toLowerCase()];
  return t ?? `Unknown topic "${topic}". Topics: ${Object.keys(GUIDE).join(', ')}.`;
}
