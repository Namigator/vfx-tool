# Water — arcing stream and splash

## Intent and failure to avoid

A connected curved liquid body that arrives, breaks into a splash and settles into droplets/ripples. The user rejected v1 water. Glowing blue wire tubes, disconnected beads carrying the whole silhouette, opaque cyan ribbons and excessive bloom fail.

Default source (-3,1.5,0), target (3,.05,0), seed 42, duration 180 ticks. Charge 0–18, travel 18–48, sustained stream 48–84, breakup/tail through 180.

## Editable components

| Component | Construction | Initial settings |
| --- | --- | --- |
| Liquid body | BezierPath→RevealPath→RibbonRenderer | 64 samples, arch +1.8 m, width .28 m with tapered ends; reveal 30 ticks |
| Moving head | PathFollower + small translucent mesh/sprite | arrives tick 48; modest size .18 m |
| Surface highlights | same path + thin masked ribbon | .025–.05 m; non-emissive or emission ≤.2; flowing UV/noise |
| Splash sheet | imported/static curved sheet mesh or widening masked ribbon group | arrival event, .35→1.2 m over 18 ticks, fade by 48 ticks |
| Droplets | arrival→Emitter→Gravity→GroundCollision | burst 140, hemisphere speed 1.5–4.5 m/s, life 24–72 ticks; radius .025–.07 m |
| Foam | arrival→disc Emitter→OverLife | burst 24, ground-oriented textured cards, life 30–66 ticks, low opacity |
| Ripples | three delayed RingRenderer groups | delays 0/7/15 ticks, radius .2→2.2 m, thin broken mask, life 60 ticks |
| Sound | travel rush + arrival splash + droplets | arrival source event shared with visible splash |

A water body needs surface cues, not a full fluid solver. Default SurfaceTranslucent material: roughness .12, metalness 0, cool tint, opacity .45–.7, restrained normal/UV flow, rim reflection. Optional refraction is subtle and independently switchable; a no-refraction version must still read as water.

## Timing and events

PathFollower.arrival drives splash, foam, droplets, ripple sequence and splash sound. Changing travel duration moves all those events together. The main stream stops emitting at tick 84 and fades/breaks by tick 108; remaining droplets/ripples clear before end. Child collision events may spawn a small secondary ripple component with strict event cap; disabled by default to avoid clutter.

## Assets

Foam/splash flipbook with irregular holes and tapered edges, thin ripple mask, droplet silhouette, tileable low-frequency normal/noise map. A static splash-sheet mesh is authored asset geometry exposed through MeshRenderer, not a hidden simulation. Review assets against light and dark backgrounds.

## Published controls

Arc height, body width, travel time, flow speed, splash spread, droplet amount, foam amount, ripple strength. Internal control over transparency, reflection/rim, UV animation, lifetime/gravity and arrival wiring. User can remove droplets or replace the body material without losing event timing.

## Variants

Narrow stream: half body width, faster travel, fewer smaller droplets and almost no foam.
Broad splash: short body, wide arrival sheet, larger droplets and wide ripples.
Both retain a cohesive liquid silhouette.

## Acceptance

Inspect with glow disabled; water must not look electrical. Body remains connected during travel; splash is tied to arrival; no pop through the floor or opaque card edges. Check close-up transparent intersections, side view, dark/light arena and no-refraction fallback. Record the known alpha-sorting limitations if visible; severe default artifacts fail. Sound must identify arrival without masking the quieter flowing tail.

