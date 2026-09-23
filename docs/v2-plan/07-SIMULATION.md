# Deterministic simulation and transport

## Fixed clock and update order

Simulation runs at 60 Hz for at most 600 ticks. Render sampling interpolates state between adjacent ticks; it never drives random generation or birth counts. Time/curve envelopes may interpolate visually, but discrete events and particle identities remain tick-based.

At tick 0, dispatch events scheduled for 0, evaluate rate accumulators for windows containing 0, and initialize resulting particles at age 0. For each next tick: advance existing systems in dependency order, detect collision/death events, dispatch same-tick events to downstream systems, create births at that tick, then produce the snapshot. New births are not integrated a second time on their birth tick. Event graph cycles are forbidden.

For a constant rate r, accumulator starts at zero and each eligible tick adds r/60; spawn floor(accumulator), retain fractional remainder. Active window start <= tick < end. A burst spawns once per unique trigger event. Burst randomness is identity-based, not queue-order based.

At age >= lifetime, remove the particle after generating its single death event. Trail points may outlive the particle until their own expiry. At document end, all geometry, lights, events, trails and audio are forcibly empty. Particle opacity/size zero does not keep GPU objects active.

## Integration and space

Semi-implicit Euler: sum accelerations in declared modifier order; velocity += acceleration*dt; apply exponential drag exp(-coefficient*dt); position += velocity*dt; resolve ground collision; update orientation/age and appearance. Clamp only documented physical limits, not unexpected NaNs. Nonfinite state stops the affected system and reports the node.

World-space emission samples the anchor's world transform at birth. Existing particles do not follow later emitter motion. Local-space emission stores local particle coordinates and transforms through the current emitter anchor at render time. Collision with the world ground is permitted only for world-space particles; reject that local-space combination rather than invent coordinate-dependent bounce behavior.

Ground collision crosses y=radius from above; solve the segment-plane fraction within the step, place at contact, reflect/slide velocity, then integrate the remaining fraction once. Maximum 2 collision resolutions per particle per tick. Emit one collision event for each resolved contact, with position/normal/incoming velocity. Restitution and friction are bounded. Resting particles do not fire collisions every tick.

## Paths and trajectories

Line and cubic Bezier use their standard equations, sampled uniformly in parameter then resampled by arc length for width/reveal/travel where required. Helix uses a stable perpendicular frame and radius/taper curve. A coincident source and target yields a zero-length path and no ribbon triangles; anchor sprites still render. Do not generate NaNs.

JaggedPath displaces interior resampled vertices in the stable perpendicular plane, multiplies displacement by sin(πu), and pins endpoints exactly. Update random shape at floor(effectLocalSeconds*regenerationHz). A rate of 0 freezes one seeded shape. BranchPath attaches to interpolated positions on the parent, preserves that attachment exactly and emits stable path IDs. Branch lengths and angles use independent streams.

PathFollower uses a normalized progress curve over its window, samples the path by arc length, and emits arrival once when progress first reaches 1. Schedule-driven "impact" is used where no moving projectile exists. Do not automatically infer impact from an element label.

Ribbon frames use parallel transport; camera-facing ribbons handle tangent/view alignment with a stable fallback axis. Particle trails record world positions each simulation tick and drop expired samples. Preserve history when rendering at a different frame rate.

## Noise and random streams

Use uint32 Mulberry32. Seed each quantity using the exact random-key tuple and FNV-1a definition in [algorithm details](24-ALGORITHMS.md), separating runtime object IDs from random identity. Add conformance fixtures for the hash and PRNG. Never use Math.random, object iteration order, Date or GPU noise to determine simulation state.

Procedural value noise uses a seeded integer lattice, trilinear interpolation and smoothstep f(x)=x*x*(3-2*x). Curl mode takes the curl of three independent scalar noise fields using central differences epsilon .01 in noise coordinates, then normalizes with zero-vector protection before amplitude scaling. Time is a fourth deterministic input implemented as smoothstep interpolation between adjacent seeded 3D fields. Define this algorithm once in runtime math; shader noise affects appearance only and need not determine particle motion.

One unrelated node added/disabled does not change another stream. Regrouping preserves stream IDs. Duplicate defaults to an independent stream; Preserve pattern is explicit.

## Seeking and worker scheduling

Seek cancels obsolete requests and replays from a valid checkpoint to the requested tick. Cache checkpoints every 30 ticks, at most 21 per active document, with a 64 MiB cache ceiling and oldest nonzero checkpoints evicted first. Tick 0 remains reconstructible. Snapshots include RNG-independent counters, birth accumulators, pending events, particles, trails and operator state.

A checkpoint is keyed by semantic simulation hash, not material colors or graph layout. Changing forces/timing/seed invalidates affected state; correctness-first implementation may invalidate all. Changing renderer-only color/opacity can reuse state.

Normal playback follows audio output time when sound is active; otherwise performance.now with a preserved origin. Never accumulate visual time by counting animation frames. If rendering falls behind, advance simulation through missing ticks in the worker; do not drop simulation steps. Display "Catching up" and reduce render frequency rather than block the UI. For a user seek, keep the old image visibly marked pending until the matching response arrives.

## Audio and visibility

Normal-speed audio starts only after user activation. Pause stops scheduled sources and stores canonical position. Resume schedules from that offset. Slow motion and scrub are silent. Returning to 1x starts from current visual time.

Hidden page: pause transport and stop voices; on visibility return remain paused with Resume, avoiding unexpected sound. This deliberately replaces v1 auto-resume. Audio engine and visual timeline share the same cast generation; stop/restart cannot leak prior-generation callbacks.

## Tests and determinism scope

Compare state at equal ticks under 30/60/144 Hz render schedules, random seeks, pause/resume and replay. Integers/IDs/events exact; normalized float state tolerance 1e-6 within the pinned runtime. This is simulation determinism, not identical GPU pixels or identical browser audio-device latency.

