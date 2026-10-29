# Feature grid

Checks the engine exports feature by feature instead of effect by effect. Each case is a tiny effect that uses one
feature: an emitter shape, a force, a renderer, a material option, a path node, and so on. A user's effect is built
from these features, so a feature row that passes in an engine says that feature exports correctly there.

```
node tools/feature-grid/build-docs.mjs                                    # 1. cases -> work/feature-grid/docs/<id>.json (MCP)
node --experimental-strip-types tools/feature-grid/render-tool.mjs        # 2a. editor renders (needs npm run dev)
node --experimental-strip-types tools/feature-grid/render-unity.mjs       # 2b. Unity: export + one batch launch (Unity Hub running)
node tools/feature-grid/score.mjs                                         # 3. grid.json / grid.md / grid.html / grid.png
```

Every stage takes an optional case-id filter and writes files the next stage reads, so any stage can be rerun alone.
To add an engine, write `render-<engine>.mjs` that saves `work/feature-grid/<engine>/<id>.png` (including `empty.png`)
and `work/feature-grid/<engine>-pkg/<id>/report.json` (`{ report: [{ level, item, message }] }` or `{ exportError }`).
The scorer picks it up as a new column.

`tests/v2-feature-grid.test.ts` fails when a node type that draws something has no case. Add one to `cases.mjs`, or
list the type in `NOT_VISUAL` with the reason. The score only tells you where to look; trust a row once someone has
looked at its images.
