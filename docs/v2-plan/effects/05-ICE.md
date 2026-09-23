# Ice — faceted shard eruption

Default target (0,0,0), source (-3,1.3,0), seed 42, duration 192 ticks. Charge 0–24, eruption/growth 24–54, hold 54–90, fracture/frost 90–150, tail to 192.

## Composition

| Component | Nodes and values |
| --- | --- |
| Charge frost | 20 small cold motes converge on target; subtle low-opacity ring |
| Ground shards | burst 28 static shard meshes in disc radius 1.1 m; base-pivot geometry, heights .5–2 m, widths .06–.2 m; growth curve 0→1 over 24 ticks |
| Facet highlights | MeshLit roughness .18, low metalness, pale cyan tint, controlled rim/emission; optional translucent material on selected shards |
| Fragments | event at tick 90, burst 36 smaller mesh particles, speed 1–3 m/s, gravity -9.81Y, fade over 45–72 ticks |
| Frost cloud | textured cold mist burst 30, radius .8 m, upward .3–.8 m/s, life 48–84 ticks |
| Ground ring | narrow cold ring expands .2→1.5 m then fades |
| Sound | crystalline anticipation, sharp fracture, small falling ticks, airy tail |

Shard meshes have origin at the base so growth does not sink or float. Use three deterministic shape variations, not identical cones. Fracture is a composed fragment burst and original-shard dissolve, not physical mesh destruction.

Published controls: shard count, height, spread, growth time, fracture timing, frost density, edge brightness. Height and width can be independent through mesh scale/initial properties; count changes do not increase every secondary layer automatically.

Variants: low radial ice fan with short outward shards; tall sparse crystal cluster with slower growth and restrained frost. Preserve rough facet definition with bloom disabled.

Acceptance: grounded bases, clear faceted silhouette, no flat cyan cones pretending to be translucent crystals, no unexplained shard intersection artifacts, coordinated fracture sound and particle burst, all fragments/tails disappear. Inspect two angles and both backgrounds; listen for painful high-frequency peaks.

