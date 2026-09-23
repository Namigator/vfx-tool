# Graph behavior and compilation

## Typed connections

Port types: number, boolean, color, vec3, anchor, pathSet, eventStream, timeWindow, particleSystem, material, meshAsset, textureAsset, audioAsset, visualLayer, audioLayer and presentationLayer. Numeric signals additionally declare units/domain. Exact type matching is required except constant-to-signal promotion. Vector/scalar conversions require explicit nodes.

Single-input ports allow one incoming edge; reconnect replaces it as one undo command. Multi-input ports explicitly allow ordered lists. The root EffectOutput accepts ordered visual/audio/presentation layers. There is no implicit merging of particle systems or materials.

All nodes form a directed acyclic graph including event dependencies. Reject cycles on connect and import with a path of offending node IDs. Maximum group depth 4, expanded nodes 512, total edges 1024; group expansion is counted, not just visible boxes.

Unused unconnected branches are retained as authoring drafts and warn; they do not execute. Required-input errors in a branch reachable from Output block compilation. Missing inputs in unreachable branches warn. Literal defaults satisfy optional inputs. Unknown node definitions always block playback, including disabled records, to prevent ambiguous recovery.

## Enable, disable, bypass and solo

- A disabled generator/emitter/light/audio source emits nothing.
- A disabled motion/path modifier passes its primary input through unchanged.
- A disabled material/value provider makes its connection inactive; consumers use their stored literal/default if available, otherwise emit an explicit missing-input diagnostic.
- A disabled renderer contributes no output but does not disable a shared upstream system used elsewhere.
- A disabled Group suppresses its contained systems and event outputs; other groups continue.
- Input/output interface bridge nodes and root Output cannot be disabled/deleted through ordinary controls; blank graph includes Output.
- Disabling is authored and saved. Bypass is the modifier's disabled behavior, not another ambiguous flag.
- Solo is a preview mask, not authored enable state. It filters visible/audible sink layers; dependency simulation still executes, preserving timing. Multiple solo nodes form a union. Disabled nodes do not become enabled merely because Solo is selected.

Deleting a node removes its incident edges in the same undo transaction; consumers retain literal settings. Do not reconnect upstream/downstream automatically unless the user explicitly chooses Remove and reconnect and types match. Enable switches never destroy settings or connections.

## Groups and reusable blocks

Double-click a group or use Open internals to enter its graph; breadcrumbs return upward. Selecting the group exposes its published controls. Group input/output ports are declared and mapped through bridge nodes. A Group can wrap a selection, preserving node and random-stream IDs and converting boundary connections to interface ports.

Group templates in the library are immutable revisions. Insert copies graph, asset references and exposed controls into the document. Editing that copy cannot change other instances or documents. Save as block creates a new library revision. There is no live linked-template propagation in v2.

Duplicate creates independent identities and random streams. Provide an explicit Preserve pattern option that copies randomStreamId values throughout the group while still giving objects unique IDs. Collapsing/expanding a block changes presentation only; it must never alter runtime output.

Public controls inside a group bind to internal literals or graph inputs. They cannot reach into siblings or parent graphs. Parent controls may target the Group's exposed parameters.

## Compile pipeline

1. Validate raw document, versions and structural limits without creating GPU resources.
2. Resolve group interfaces and instantiate embedded graph definitions; detect recursion.
3. Resolve parameter precedence, type/domain/unit checks and assets.
4. Resolve enabled/bypass state and trace reachable sinks/dependencies.
5. Topologically order nodes using node ID as deterministic tie-breaker.
6. Build immutable path, system, material, audio and presentation descriptors.
7. Share identical particle chains; separate branches when motion differs.
8. Calculate worst-case budgets and capabilities; reject hard-limit violations.
9. Produce compiled plan plus field-addressable warnings and debug source mappings.

Compiled systems retain originating node IDs and group paths for profiling/selection. Cache identity includes semantic document hash, asset hashes, registry versions and quality-independent runtime version.

## Edit failure behavior

Authoring can temporarily contain an incomplete graph. Preserve the last valid compiled plan and display "Preview paused — graph needs attention" while the user repairs it. Never silently show the old effect as though it reflects the new graph. Invalid graphs can be saved as clearly labeled drafts and exported as project archives, but cannot be exported as validated reusable presets or rendered WAVs.

Compile asynchronously with request generation IDs. Rapid edits cancel obsolete work; only the latest valid revision can replace the preview. Replacing the plan disposes or reuses old resources with explicit ownership. Graph drag/layout does not compile.

## Counts and identity

Integer parameter changes are sampled on cast start unless their port declares event-time sampling. Rate curves are sampled every simulation tick. Particle object identities derive from emitter node ID, source event ID and emission index; random keys use the separate stream/event keys defined in the algorithm supplement, so disabling unrelated components does not reshuffle another component's randomness.

Event order is timestamp tick, topological system rank, emitting node ID, parent particle ID, event sequence. Ordered inputs use explicit edge order. Node coordinates, labels, insertion order and UI sort order never affect the result.

