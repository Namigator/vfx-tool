# Migration from the existing editor

## Preserve v1

Do not overwrite old localStorage presets, JSON, WAV files or v1 bundles. Preserve the original schemaVersion 1/generatorVersion 1.0.0 modules and tests as a legacy adapter. v2 saves use separate format/version/storage. The existing application remains launchable in Legacy view during transition.

Import detection:
- schemaVersion 1 raw recipe → legacy document viewer.
- format vfx-studio-bundle, bundleVersion 1 → validate embedded v1 recipe, preserve raw package.
- format vfx-studio, schemaVersion 2 → v2 graph.
- format vfx-studio-package packageVersion 2 → v2 archive importer.
Unknown versions get an explicit unsupported-version message and raw-data recovery, never treated as v1.

## Two explicit actions

Open original (legacy) reproduces the existing generator and controls. Convert to editable graph creates a new v2 document and retains the original as metadata/backup. Conversion uses improved component templates; it preserves authored intent and parameter values where possible, not old pixels. Display that distinction before conversion.

No automatic conversion on application startup. Library shows a Legacy section with the count of old presets and Convert a copy.

## Conversion rules

Preserve name with " — graph copy", seed, source/target coordinates, primary/accent colors, root scale, total timing within 600 ticks and audio volume/pitch. Allocate new stable IDs and store migration provenance containing source version, original recipe hash and warnings.

Timing seconds round to ticks; record before/after values. Original counts map to burst counts for burst components or rate=count/activeSeconds for continuous components, rounded to the nearest integer with a report. This count is attached to the primary component only; new decorative smoke/foam/halo defaults remain separately labeled new components.

| Family | Primary mapping |
| --- | --- |
| Lightning | Branch count → BranchPath; width → core ribbon; turbulence/spread → jagged amplitude; count → impact spark burst |
| Fire | Count → flame emission rate; speed → launch velocity multiplier; spread → cone/radius; turbulence → NoiseForce |
| Ice | Count → shard burst; scale → root; spread → disc radius; speed → growth-time inverse |
| Water | Width → body ribbon width; count → droplet burst; spread → splash cone; turbulence → path/UV perturbation |
| Wind | Count → tracer emission rate; width → ribbon width; speed → travel/twist speed; spread → helix radius |
| Earth | Count → rock burst; spread → launch spread; speed → initial velocity multiplier |
| Light | Count → ray count; spread → ray length multiplier; intensity → emission/light gain |
| Shadow | Count → wisp rate; spread → vortex radius; speed → inward/tangential acceleration multiplier |
| Poison | Count → cloud emission rate; spread → plume radius; speed → rise velocity; turbulence → NoiseForce |
| Energy | Count → trail spark rate; width → trail width; speed → inverse follower duration; spread → trail spread |

Use normalized mapping relative to the old family's default and the new preset's default: newValue = newDefault*(oldValue/oldDefault) for multiplicative quantities. For zero-default quantities use direct documented mapping. Clamp to the new supported range only during explicit migration and include each clamped value in the conversion report; normal v2 import does not clamp.

Old fields unused by that family are preserved in migration provenance and reported as unused, not assigned arbitrarily. New decorative layers can be disabled immediately. New waveform quality may differ; the original WAV remains available in the preserved v1 package.

## Transition rollout

1. Freeze v1 source/config/presets and capture baseline tests.
2. Introduce v2 behind a visible Graph editor choice while Legacy remains usable.
3. Test conversion for all ten defaults and lower/upper values.
4. After v2 acceptance, make Graph editor default; retain Legacy import/view path for this release.
5. Remove neither v1 modules nor migration tests in this project phase.

## Acceptance

Legacy round-trip retains original fields and generator outputs at fixture ticks. Conversion never mutates original storage/files. Every converted graph passes validation or reports its exact missing capability. Name/seed/anchors/colors/timing mappings match the report. Opening, converting, undoing, saving and reimporting cannot cross-write the wrong storage version.

