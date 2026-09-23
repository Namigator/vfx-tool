# Instructions for the implementing agent

## Start procedure

1. Read root STATE.md, this package's index, current work-package entry and its linked subsystem/effect specifications.
2. Inspect the actual files affected by that package. Do not infer the whole v2 system exists because the plan describes it.
3. Preserve the v1 baseline and original reference. Check repository status; planning found no Git repository at the project root.
4. Check the current permission profile. F:\Dev2\VFX-Tool was not a default writable root in the planning session; use the permission mechanism rather than bypassing it.
5. Confirm that implementation, not just planning, is now requested. This handoff was created under a planning-only user request.
6. Work solo. Do not spawn built-in agents. The user's earlier fallback to squad/Claude applies only if truly necessary and explicitly justified; this plan requires no delegation.

## Installation and dependencies

Existing React/Three/TypeScript/Vite approval persists. New package approval is needed before installing/running @xyflow/react, fflate or any other new third-party code. Present the concrete package/purpose/license/source; avoid asking again for previously approved packages. Pin exact versions in the manifest and lockfile after compatibility inspection. Keep local library assets bundled, with no runtime CDN.

No new package is installed as part of the planning handoff. Do not assume the package names in architecture constitute installation authorization.

## Work-package completion record

Each completed package gets a short record with:
- WP ID, requirements/tests covered and files changed.
- Concrete behavior now present.
- Exact executed checks and readable output paths.
- Actual screenshot/clip paths that were opened and inspected, when visual.
- Listening evidence and who listened, when audio.
- Failures, skipped scope, risks and next dependency.
- Evidence tags attached to claims.

Update STATE.md under approximately 60 lines. Use the evidence directory for detailed logs. Never replace failed acceptance criteria with "looks plausible" or "should work."

## Change boundaries

Pure contracts/math remain free of DOM/React/Three dependencies. Presets are data. Shared nodes/renderers must not branch on the element name to render an otherwise inaccessible effect. All default art layers and material settings are user-editable. Stable parameter/node versions cannot change semantics silently.

Scope a package so the editor remains launchable; use a visible v2 entry while Legacy remains intact. Add meaningful tests for contracts, state and regressions. Do not add tests that only mirror a constructor or prove a reversible cosmetic change exists.

Do not silently replace unsupported features with defaults, drop assets during import, delete old presets, lower simulation counts by quality setting, or declare a visual gate passed on compilation evidence.

## Review sequence per package

Review behavior against the relevant specification; run targeted tests; run TypeScript/build when integration changes; inspect actual browser output; inspect at least one failure/recovery path. Broaden tests only for new risk or cross-module changes. For visual defects, reproduce and capture before changing multiple unrelated systems.

After three attempts without new evidence, stop and state "I'm guessing now", what is known, and the one missing input needed. Do not continue speculative tweaks. If blocked on user action, ask once with exact steps and continue independent work.

## Technical commands retained

From the project directory:
- node node_modules/typescript/bin/tsc --noEmit
- node --experimental-strip-types --test tests/*.test.ts
- node node_modules/vite/bin/vite.js build
- node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort

These are the existing commands, not proof the new system has tests yet. Maintain a clean separation of legacy tests and new tests. Node strip-types does not support non-erasable TypeScript constructs such as parameter properties; pure modules tested that way must use erasable syntax.

## User-review requests

Prepare the actual comparison clip/recipe first. Ask a focused artistic question such as whether the graph lightning reaches the reference's richness and impact. Do not ask the user to approve a hypothetical future result, and do not reopen implementation choices already decided here without new evidence.

A user rejection identifies a failed gate. Record the defect and reproduction. Revise the reusable capability or composition responsible, then repeat the relevant comparison; do not restart unrelated work or claim all ten effects are complete.

