# Normative conformance cases

These cases are independently specified expected behavior, not generated output accepted blindly. Implement them as small test fixtures before expanding the library.

## F01 — minimum graph

One root graph, source and target anchors, one Schedule(start=0,duration=60), Emitter(point at source, burst=1, rate=0, life=60 ticks, speed=0), InitialProperties(size=.1), SpriteUnlit material, BillboardRenderer, EffectOutput. Connect Schedule.start to Emitter trigger, source to Emitter anchor, Emitter→InitialProperties→BillboardRenderer and Material→BillboardRenderer, renderer→Output.

Expected: exactly one particle at source at tick 0; position unchanged at ticks 1/30/59; no particle at tick 60; one birth and one death; no output after document end. Disable emitter → zero particles. Disable InitialProperties → particle uses emitter defaults. Disable renderer → simulation only if another reachable sink/event consumer requires it.

## F02 — rate boundaries

Window [0,60), rate 30/s, burst 0, particle life 120 ticks. At each eligible emission tick add .5 to accumulator; spawn when integer reached. Expected births at ticks 1,3,...,59, exactly 30. Count at ticks 0/1/59/60 is 0/1/30/30. Document duration 180 ticks; lifetime removes each at birth+120. This case defines the start-tick emission accumulator behavior.

## F03 — force integration

One particle at (0,1,0), velocity (1,0,0), gravity (0,-9.81,0), no drag/collision. At tick n:
x=n/60;
y=1-9.81*(1/60)^2*n*(n+1)/2;
z=0.
Compare with tolerance 1e-6. This intentionally uses semi-implicit Euler, not the continuous ballistic formula.

## F04 — decay and boundary

Emitter window [12,42), lifetime 30 ticks. No births at tick 42 or later. Last legal rate-generated birth before 42 dies before or at 71. A separate trail with 12-tick history may remain until its latest point expires, but document duration 90 forces all outputs empty at tick 90. No modulo lifetime wrap may create new particles after emission closes.

## F05 — graph identity

Create a burst with seed 42 and explicit stream "sparks-a". Sample tick 20. Rename nodes, move graph coordinates, insert an unrelated disabled smoke group and wrap the original selection in a group. Particle IDs/positions/colors remain identical. Duplicate normally → different stream. Duplicate Preserve pattern → same sampled quantities but distinct object IDs.

## F06 — group equivalence

A Group input anchor feeds Emitter→Gravity→Billboard with a material. Compare collapsed versus opened internals; output identical. Inline/ungroup with preserved IDs also identical. Two inserted library instances are independent: changing one gravity parameter affects only that instance.

## F07 — same-tick event

A particle dies at tick 12 at position p. Its death output triggers a downstream burst of 2 particles with speed 0 and lifetime 10 ticks. Expected child births at tick 12, both at p, age 0; tick 13 age 1; no child at tick 22. No second dispatch when seeking back and forward. Reversing graph UI positions does not change order.

## F08 — paths and materials

A path from (-1,0,0) to (1,0,0) with pinned JaggedPath keeps exact first/last coordinates at every regeneration tick. Branch first point equals the selected interpolated parent attachment. Reveal .5 ends at half arc length. Width is world-space, not screen-pixel constant.

A 4×4 flipbook with 16 frames sampled at normalized ages 0/.5/(1-epsilon) gives frames 0/8/15; age 1 removes particle. Dissolve amount 1 gives opacity 0 regardless of noise. Color gradients interpolate in linear RGB, not raw hex channel space.

## F09 — public control precedence

A control "size" has authored value 2 and binding target=source*.5+.1; target resolves 1.1. Connect a Constant 3 to that parameter's port → resolved 3, driven field identifies connection. Disconnect → binding resumes at 1.1. Unbind → stored literal resumes, unchanged by prior drivers. Conflicting control owners fail compilation.

## F10 — archive and audio

Export a project with one imported RGBA texture, one static GLB and one WAV, then clear local library in an isolated test origin and import. Byte hashes and graph semantic hash match; graph layout and internals remain editable.

An event at tick 24 maps to sample 19200 at 48 kHz. Render duration 144 ticks maps to 115200 frames per channel. PCM16 stereo WAV byte length = 44+115200*4. Muting preview must not change exported authored audio.

## F11 — rejection and recovery

Cycle A→B→A, missing required asset, unknown node version and oversized event fan-out produce distinct node-addressed errors. Last valid preview is paused/labeled stale, edited graph remains recoverable, and draft export preserves data. No reset to the initial preset.

## Golden vectors to record

During WP01/WP03/WP06, add independently reviewed vectors for FNV-1a UTF-8 hashing, Mulberry32 (seed 0 and 42), value/curl noise, audio oscillator/noise/filter and canonical JSON. Record exact expected inputs/outputs plus derivation. Do not bless values by executing the implementation and copying output without an independent derivation or reference.

