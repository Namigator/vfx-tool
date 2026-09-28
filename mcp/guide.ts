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

  fire: `FIRE / FLAMETHROWER JET (continuous flame body)
- Two tongue layers (sprites flame-tongue-a and flame-tongue-b), each: Emitter cone, radius 0.03-0.04, coneAngle 0.08-0.12 (half-angle), rate ~200/s, speed 7-10 m/s, life 0.4-0.75 s, Burst 0, rateOverWindow ramp [0:0.2, 0.1:1, 0.8:1, 1:0].
- InitialProperties size 0.10-0.16 m (SMALL) + randomFrameStart. Forces: Drag 0.9, NoiseForce curl amplitude ~3.5 freq 0.7, Gravity [0,1.6,0] (heat rises).
- BillboardRenderer alignment "velocity", stretchRatio ~1.5, pivot 0.3, flipbookMode "overLife"; sizeOverLife [0:1, 0.45:2.6, 1:1.5] (they GROW into each other - that is what makes one continuous mass); opacityOverLife [0:0, 0.06:1, 0.6:0.75, 1:0].
- Material SpriteTextured, blend additive, opacity ~0.11, emission 0, dissolve 0.85 (dissolveStart 0.45, softness 0.1, edge 0.04, edgeColor #FFB040) so tongues burn away instead of popping.
- Hot core: a third emitter, cone 0.06, rate ~140/s, speed 9-12, life 0.3-0.5, size 0.10-0.14 growing x2.5 early, tint #FFF1C8, opacity ~0.15, emission ~0.5. Stacked with the tongues this is already bright: if vfx_render_frames warns about glow flooding, cut core opacity first, then EffectOutput glowLimit ~1.6 / glowThreshold ~1.4 / glowRadius ~0.3.
- Decay / billows: sprite fire-puff (a fire blob that cools and tears apart over its 16 frames), flipbook overLife.
- Embers: spark-streak, additive, emission ~1.2, size 0.015-0.035, cone 0.35, speed 3-6, Gravity up [0,1.8,0], NoiseForce curl, optional ParticleTrail (history 0.08 s, width 0.01) with its OWN Material, template SpriteUnlit (trails are untextured).
- Smoke: smoke-puff normal blend, grey #8A8078, rate ~18/s, size 0.2-0.3 growing x4, opacity peak ~0.25, Drag 1.6, Gravity up [0,1.4,0]; keep it going ~1 s after the flame so it lingers.
- Light: PointLight #FF8A3A intensity ~35 range 6 with flicker 0.3 over the emit window. Ignition: a SpriteRenderer soft-glow flash (6 ticks) + optional ScreenFlash / CameraImpulse.
- Nozzle: PropMesh cylinder at Source aimed at Target (pivot end: the muzzle is at Source, the barrel behind it) + a stand: PropMesh box, Direction [0,-1,0], pivot start (hangs down from the anchor), placed with an OffsetAnchor a little behind the muzzle.`,

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
