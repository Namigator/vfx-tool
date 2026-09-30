# Bounded particle preview evidence

[RAN] Full223 tests passed (tests-223.log). TypeScript and Vite build passed after the20 vetted packages were installed. Production build retains a >500kB Three/OrbitControls chunk warning.

[PROXY] Independent static review accepted group expansion, corrected particle simulation, the graph-to-particle adapter and history/preview lifecycle. See runtime-review.md and history-preview-review.md. The multi-window ambiguity noted by the reviewer now has a passing production compiler regression test. Review findings and scope limits are not hidden by the PASS verdict.

[SAW] In the actual in-app browser1280x720: F01 white particle renders over empty grid at tick0; at120 it is gone; Home restores tick0/live1. Transport overflow was observed, corrected by Claude, and visually rechecked. Primitive source is the graph fixture through real compilation and simulation. This does NOT establish lightning parity, complete node authoring, complex materials, audio or performance.

The new graph canvas/workspace integration is a subsequent active task; its acceptance needs a separate browser check. Existing v1 is preserved.
