# WP03 reusable path core decisions

Scope: runtime/paths.ts and tests/v2-paths.test.ts. No registry, rendering or presets yet. Read docs/v2-plan/07-SIMULATION.md,24-ALGORITHMS.md and05-NODE-CATALOG.md.

Approved API: PathData{id,points:Vec3[],widthScale,opacityScale}; linePath, bezierPath (uniform-t cubic samples then arc-length resampling), resampleByArcLength, pathLength, pointAtArcFraction, stableFrame, regenerationIndex, jaggedPath, revealPath. Use shared random.ts APIs and model Vec3. Parameters/returns must be cloned; object path id never changes random samples.

Stable frame: t=normalize(end-start), use +Y reference unless abs(t.y)>0.99, then +X; n1=normalize(cross(t,ref)), n2=cross(t,n1). Zero-length t=+X. No guessed hidden axes.

Random tuple: eventRandomKey empty, entityOrdinal=pathOrdinal, propertyKey jaggedN1/jaggedN2, sampleOrdinal=regen*128+vertexIndex; samples2..128. Regeneration floor(effectLocalSeconds*hz), hz0 yields0. Validate finite nonnegative time/hz and safe-integer packed ordinal against random.ts actual bounds. Negative/invalid data rejected; no Math.random.

Pinned jagged uses amplitude*sin(pi*u) on interiorvertices and EXACT cloned endpoints. Unpinned jagged uses full amplitude and may move endpoints. Zero-length input remains degenerate, never random cloud. Degenerate handling explicit: empty path length0/resampleempty/revealempty; pointAtArcFraction empty throws RangeError. Single point resampling may duplicate samepoint. Reveal0 returns empty; reveal1 exactclone; interior uses cumulative arc-length clipping and interpolated endpoint.

Validate finite vectors and scalars, nonnegative amplitude/scales, sampleinteger2..128. No huge unbounded loops. Frame definition and ordinal packing are frozen by these decisions before graphs persist this capability.

Tests: exact endpoints and independent straight-line length; arc samples match cumulative POLYLINE arc targets (do not claim curved Euclidean chord lengths are exactly equal); deterministic regeneration boundaries including24Hz, frozenhz0, stream changes vs objectid independence; displacement plane/taper bound; reveal exactmidpoint/full/empty and degenerate finite data; invalid inputs. Native node:test only. No visual acceptance from these tests.
