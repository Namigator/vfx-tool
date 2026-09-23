# Algorithm details and remaining registry contracts

This document closes mathematical choices shared by the node catalog and effects. Implementations must use these definitions or record an explicit versioned change.

## Path features required by the presets

Add RadialPath to the registry: center anchor + window → pathSet. Modes sphere/disc/cone; count 32 [1,128]; min/max length .6/2.4 m [.001,50]; cone angle 30° [0,180]; orientation quaternion; seed stream. Directions are uniform on the chosen sphere/solid angle or uniform angle for disc. Each path starts at center and ends at center+direction*length. Length uses a declared uniform random range. Stable path IDs derive from index.

PathSet records each path's id, points, widthScale and opacityScale, with defaults 1. BranchPath has countMode total/perParent (default total), opacity range [.2,.48] and width range [.2,.4]. Secondary fork preset uses total=7 so it does not create 7 forks for every primary branch. Parent selection is stable by seeded rank; attachment interpolates parent arc length. Outputs trunk and branches separately to avoid accidentally drawing the trunk twice.

Branch direction: parent tangent plus sampled perpendicular cone displacement, normalized; endpoint start+direction*length. Optional ground-end clamp is explicit and off by default. Jagged amplitude tapers at both endpoints. A perpendicular arch uses a BezierPath input, not a secret lightning-specific offset.

## Signal operators

ScalarMath includes exp and power as unary/binary registered operations in addition to the catalog's basic operators. exp input clamps to [-20,20]; power rejects a negative base with fractional exponent, returning 0 plus a warning. Curves and oscillator domains remain explicit. These permit the original exponential/flicker envelope without hard-coded family code.

Time node outputs effect seconds, local-window seconds and normalized-window progress. Outside its window, normalized progress clamps; a separate window-active boolean/envelope gates rendering. PathLength outputs a constant meters value for a static path. DurationFromSpeed computes round(pathLength/speed*60) ticks, clamps to 1–600 with visible validation; speed .01–100 m/s. It accepts only static paths, preventing a timing/trajectory dependency cycle.

These values are compile-time or time-domain signals, not arbitrary expression evaluation. Registered operations are the only callable math.

## Particle shapes and attributes

Cone emission is uniform in solid angle: cos(theta)=lerp(cos(maxAngle),1,u), azimuth=2πv. Sphere surface uses z=2u-1 and azimuth=2πv; sphere volume multiplies radius by cbrt(w). Disc radius=R*sqrt(u). Box samples each axis uniformly. Path emission samples normalized arc length uniformly. Directions use the emitter's declared local +X axis; quaternion rotates into world/anchor space.

Emitter chooses trigger position when event payload contains one and useEventPosition=true (default); otherwise uses its anchor. Optional inheritVelocity 0–1 defaults 0. Event payload carries tick, position, velocity, normal if collision, source node/particle identity and event sequence. All missing payload fields have explicit zero/identity defaults.

InitialProperties includes nonuniform positive scaleMin/scaleMax vec3 for meshes, default (1,1,1), range .001–20 per component, in addition to uniform size. MeshRenderer scale is vec3 with the same bounds; root transform remains uniform. This supports tall shards without hiding geometry generation inside a family.

Attract acceleration is normalize(target-position)*strength*min(distance/softRadius,1); zero distance returns zero, killRadius removes the particle with one death event. Vortex uses normalized axis, radial offset perpendicular to axis, tangent=cross(axis,radialDirection), and acceleration=(tangent*tangential-inwardDirection*inward)*clamp(1-radius/falloffRadius,0,1). Zero radial distance yields zero tangential acceleration.

## Exact random identity

Object IDs identify nodes/particles/events for ownership and diagnostics. Random keys separately define patterns so an explicit Preserve pattern copy can have new object IDs and identical random samples.

FNV-1a: initial uint32 2166136261; for every UTF-8 byte b, h = Math.imul(h XOR b,16777619) >>> 0. Serialize the random tuple with JSON.stringify over this ordered array:
[2, documentSeedUint32, randomStreamId, eventRandomKey, entityOrdinalUint32, propertyKey, sampleOrdinalUint32].
All strings are exact stored ASCII identifiers; property keys are registry-owned stable strings. Use the resulting hash as Mulberry32 seed and take its first output in [0,1).

Mulberry32: a=(seed+0x6D2B79F5)>>>0; t=Math.imul(a^(a>>>15),a|1); t^=t+Math.imul(t^(t>>>7),t|61); result=((t^(t>>>14))>>>0)/4294967296. Repeated values for one property use sampleOrdinal, not accidental function call order.

Schedule eventRandomKey = JSON.stringify(["schedule",schedule.randomStreamId,tick,repeatOrdinal]). Particle-derived eventRandomKey = JSON.stringify(["particle",parentRandomKey,eventKind,eventOrdinal]); parentRandomKey is JSON.stringify of the emitter tuple without property/sample fields. Path properties use eventRandomKey="" and entityOrdinal=stable path index; regeneration uses sampleOrdinal=regeneration index. Each component (e.g. velocityX, velocityY) has a different property key.

Default duplication assigns new stream IDs and changes pattern. Preserve pattern retains every copied stream ID, therefore corresponding emitter/event keys remain equal while object IDs remain distinct. Moving/renaming/regrouping never changes a stream ID.

## Audio source definitions

Oscillators maintain phase at the canonical sample rate. Sine and triangle use direct phase functions. Saw and pulse use PolyBLEP discontinuity correction: for normalized phase x and dt=f/Fs, correction is 2x/dt-(x/dt)^2-1 when x<dt, and ((x-1)/dt)^2+2*(x-1)/dt+1 when x>1-dt, otherwise 0. Subtract correction from saw; pulse applies the two edge corrections. Clamp frequency below .45*sampleRate.

Pink noise uses a Voss-McCartney construction with 16 independently seeded held rows. Initialize all rows; at sample index n≥1, update row equal to trailing-zero count of n when <16. Output (sum(rows)+freshWhite)/17. Brown noise state b=clamp(.98*b+.02*white,-1,1), output b; gain is authored separately. Neither generator secretly peak-normalizes each render.

RBJ biquad lowpass/highpass/bandpass uses w0=2πf/Fs, alpha=sin(w0)/(2Q), a0=1+alpha, a1=-2cos(w0), a2=1-alpha. Lowpass b=((1-cos)/2,1-cos,(1-cos)/2); highpass b=((1+cos)/2,-(1+cos),(1+cos)/2); bandpass constant-peak b=(alpha,0,-alpha). Divide all coefficients by a0 and use transposed direct form II. Interpolate cutoff per sample in log frequency; coefficient update at fixed 64-sample boundaries for bounded cost, preserving state.

Canonical mix limiter: y=.891250938*tanh(x/.891250938), then authored master gain ≤1 and 5 ms boundary ramps. Report pre-limiter peak and percentage of samples above .891250938 so severe saturation cannot be hidden. Float-to-PCM clamps [-1,1], multiplies negative samples by 32768 and nonnegative by 32767, then rounds.

## Scope of exactness

These formulas define mathematical behavior. Visual assets and exposed preset values still undergo the named visual gates. Artistic tuning is permitted in preset data, but changing a registered algorithm requires tests, semantic version review and documentation.

