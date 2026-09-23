# Required node catalog

All nodes are application-registered, versioned and available to users. No family-specific hidden node is permitted. Components such as Flames or Lightning Bolt are embedded group templates constructed from this catalog.

See [algorithm supplement](24-ALGORITHMS.md) for RadialPath, Time, PathLength, DurationFromSpeed, signal math and exact simulation formulas. See [port/interface supplement](25-INTERFACE-CONTRACTS.md) for ParticlePaths and exact port names. These are required parts of the registry, not deferred extras.

Notation: ticks are integer 1/60 seconds. E = event stream; A = anchor/motion anchor; P = path set; S = particle-system descriptor; M = material descriptor; V = visual layer; C = scalar/color signal. Inputs with no edge use their documented literal/default. Every generator has enable and a stable random stream.

## Values, timing and assembly

| Type | Inputs → outputs | Primary parameters/defaults and bounds |
| --- | --- | --- |
| Constant | literal → typed C | number/color/vector/bool; field-appropriate bounds |
| PublicParameter | control ID → typed C | one declared document/group control |
| Curve | domain → C | linear or hold; default (0,1),(1,0); 2–16 keys |
| Gradient | normalized age/pathU → color | 2–8 stops; linear RGB |
| ScalarMath | C,C → C | add, subtract, multiply, safeDivide, min, max, clamp, remap; divide denominator below 1e-6 returns 0 plus warning |
| Oscillator | time → C | frequency 0–60 Hz, phase radians, sine/triangle/pulse, amplitude 0–10, bias -10–10; default sine/2 Hz/1/0 |
| RandomRange | stable identity → C | min/max; sample once per cast/particle/path, never render frame |
| Anchor | anchor ID → A | source/target/custom |
| OffsetAnchor | A → A | local offset xyz ±100 m; default zero |
| Schedule | clock → E/window | start 0, duration 60 ticks; mode once/window/repeat; repeat interval ≥1 tick and repeat count 1–128 |
| EventDelay | E → E | delay 0–600 ticks; discard events beyond duration |
| MergeEvents | ordered E list → E | preserve all IDs; deduplicate identical origin event IDs |
| GroupInput / GroupOutput | declared ports | interface bridge; no visual/runtime state |
| Group | exposed ports → exposed ports | embedded graph; user controls; max depth 4 |
| EffectOutput | V/audio/camera lists | exactly one root output; no rendering logic |

Schedule window carries start/end plus start and end event outputs. Nodes that accept a window have explicit stop-emission semantics. Repeat cannot create unbounded work.

## Paths and moving anchors

| Type | Inputs → outputs | Defaults and bounds |
| --- | --- | --- |
| LinePath | start/end A → P | 2 samples; exact endpoints |
| BezierPath | start/end A → P | cubic handles default +Y 1 m; 2–128 samples, default 48 |
| HelixPath | axis A/A → P | radius 0.5 m [0,20], turns 2 [-16,16], phase 0, taper curve, samples 64 [4,128] |
| JaggedPath | P → P | amplitude .3 m [0,10], regeneration 24 Hz [0,60], samples 42 [2,128], pinned endpoints true |
| BranchPath | P → P | count 14 [0,64], attachment [.12,.88], length [.4,1.8] m, spread 1 rad [0,π], width multiplier .3 [0,1]; emits branches and pass-through trunk on separate ports |
| RevealPath | P,C → P | fraction 0–1; clips at interpolated arc length |
| PathFollower | P,window → A,arrival E | duration 30 ticks [1,600], progress linear; orientation tangent, clamp after arrival |
| PathTransform | P → P | offset, quaternion, uniform scale .01–20 |

Secondary forks are another BranchPath node fed by branch output. Recursive branching is not a hidden setting. Path regenerated points preserve path identity across ticks; trail/history behavior is explicit.

## Particles and ordered motion operators

| Type | Inputs → outputs | Defaults and bounds |
| --- | --- | --- |
| Emitter | A or P, E/window → S | shape point/cone/sphere/disc/box/path; burst 32 [0,4096], rate 0 [0,4096]/s; life .6–1.2 s [1 tick,10 s]; radius .2 m [0,20], cone 20° [0,180°], speed 1–3 m/s [0,100], spread direction +X; world-space default |
| InitialProperties | S → S | size .08–.16 m [.001,20], initial rotation 0–2π, angular velocity ±20 rad/s, color white, random frame start false |
| Gravity | S → S | acceleration (0,-9.81,0), components ±100 m/s² |
| Drag | S → S | coefficient 0.8 [0,20]/s, exponential velocity damping |
| NoiseForce | S → S | amplitude 1 [0,100] m/s², spatial frequency 1 [.01,20]/m, evolution .5 [0,10]/s, mode vector/curl |
| Attract | S,A → S | acceleration 2 [0,100] m/s², soft radius .1 [.01,10] m, kill radius 0 [0,10] |
| Vortex | S,A → S | axis Y, tangential acceleration 3 [0,100], inward acceleration 1 [0,100], radius falloff 1 [.01,20] m |
| GroundCollision | S → S, collision E | plane y=0, mode kill/slide/bounce, restitution .2 [0,1], friction .5 [0,1], max bounces 2 [0,8] |
| OverLife | S → S | size/opacity/color/angular-speed curves; normalizedAge domain; default opacity triangle with 10% attack |
| ParticleEvents | S → birth/death E | emission events inherit position, velocity and stable particle identity |

Force nodes append named operators to a descriptor. Forking S shares an immutable upstream definition, not mutable particle buffers. Divergent downstream motion compiles independent systems with identical initial random samples; several renderers on the identical S share simulation. Motion operators execute in the order encoded by the single-input chain.

Event-conditioned emission supports collision/death child systems. It is one-way and bounded by graph/cast event limits. No feedback or particle-to-parent cycles.

## Render nodes

| Type | Inputs → outputs | Parameters |
| --- | --- | --- |
| BillboardRenderer | S,M → V | alignment camera/velocity/world-axis; size and stretch ratio 1 [1,20]; soft-intersection optional |
| MeshRenderer | S or A,M,mesh → V | built-in/imported static mesh; scale .01–20; tangent orientation optional; instancing |
| RibbonRenderer | P,M → V | width .04 m [.001,10], width-over-path curve, UV stretch/tile; camera-facing or parallel-transport orientation |
| ParticleTrail | S,M → V | history .15 s [1 tick,2 s], max 32 points [2,128], width .015 m; independent trail fade after parent death |
| MotionTrail | A,M → V | same history contract, for projectile/anchor |
| RingRenderer | A,M,window → V | radius curve 0→1 m, width .03 m, orientation quaternion; 64 segments [8,128] |
| SpriteRenderer | A,M,window → V | size curve, axis/camera alignment; charge/impact/core sprites |
| PointLight | A,window → V | color white, intensity curve 0→1→0, max intensity 100, range 5 m [.1,50] |
| CameraImpulse | E → presentation layer | duration 6 ticks, translation max .05 m, rotation max .01 rad; bounded by global setting |
| ScreenFlash | E → presentation layer | color, alpha max .15, duration 3 ticks; disabled by reduced-effects setting |

Each render node exposes render order offset [-32,32], enabled and envelope. Path/ring widths use world units. No original-demo pixel constants are copied into authoring parameters.

## Materials and sound

Material node chooses one semantic template and ordered settings from the material document; its output M may feed multiple renderers. Texture/flipbook/gradient/noise controls are data inputs, not arbitrary shader graph programs.

AudioSource produces an audio layer from Sample or a registered oscillator/noise/chirp generator, with E/window timing. AudioEnvelope, AudioFilter and AudioMix compose it. Full definitions and bounds are in the audio document. AudioGroup is an ordinary expandable Group.

## Registry requirements

Every entry supplies type/version, ports, parameter schema, defaults, unit labels, disabled behavior, compile function, estimated worst-case workload, capability set, help example and tests. Distinguish literal control changes from time/age-driven inputs; only ports explicitly allowing a signal can animate. Node UI is generated from this metadata.

Add menus offer 1) ready-made components, 2) advanced primitive nodes. Selecting a component inserts its complete graph with defaults and asset references. Never insert a disconnected collection whose essential wiring is left to the user.

