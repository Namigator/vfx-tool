# Gaps found while writing recipes B (lightning, energy-projectiles, wind, poison, shadow, light-holy, impacts)

Logged 2026-09-30 while verifying all seven recipes through the MCP tools (`recB-*` documents). Each entry is a
real repro, not a guess.

## 1. `vfx_render_frames` timed out once (1800s) on a normal request

**Repro**: `vfx_new_document { template: "blank", id: "recB-wind", component: "wind-gust" }` →
`vfx_compile { docId: "recB-wind" }` (clean) → `vfx_render_frames { docId: "recB-wind", ticks: [30, 90, 150] }`.
This call returned no response/progress for 1800s and was aborted by the client-side idle timeout. The document is
small (2 particle systems, 4 ribbon layers) and every other family's identical-shaped request (same ticks count,
similar or larger particle counts, e.g. `recB-lightning` with 7 systems / 8 ribbon layers) succeeded immediately in
the same session, before and after this one. Retrying the *exact same call* a few minutes later succeeded
immediately (`lit 2.1%/2.6%/0.8%`). This looks like an intermittent stall in the headless-Chrome render pipeline
(the guide's workflow.md already warns `shot url` can flake similarly) rather than anything wrong with the document.
**Impact**: an agent that gives up after one timeout will wrongly conclude the effect is broken. Recommend: the
guide's retry advice ("retry once, else use the in-app browser pane or cdp-eval") should explicitly cover
`vfx_render_frames`, not just `shot.ps1 url`.

## 2. "Ray length" knob has a different unit on different components in the same Light family

`holy-light`'s `ctl-holy-light-length` ("Ray length") has **no unit** (`—`), default `14`, and drives
`raybb.stretchRatio` — a multiplier on a small base sprite. `light-pulse` / `light-cone` / `light-blessing`'s
`ctl-<id>-length` (also labelled "Ray length") has unit **meter**, default `1.8`–`3.2`, and drives
`rays.lengthMax`/`lengthMin` directly. Same label, same family, same-sounding purpose, different unit and an order
of magnitude apart in scale. Setting `14` (a reasonable `holy-light` value) on a `light-pulse` control would be
rejected by range validation (`0.00227…–50`) or, if in range, would produce a wildly different-looking result than
intended. **Repro**: `vfx_list_controls { docId: <a holy-light doc> }` vs `vfx_list_controls { docId: <a light-pulse
doc> }`, compare the `ctl-*-length` entries. **Recommendation**: either normalize the unit across the Light family's
four components, or have `docs/ai-guide/reference/components.md`/`look.md` call out per-component units more loudly
for any knob whose label repeats across a family with different underlying units (noted inline in
`recipes/light-holy.md`'s ray-length row as a workaround for now).

## 3. `poison-caustic`'s residue window slightly overlaps the wrong mental model from its own description

The component blurb says the effect "plays at Target" with a single seeping cloud, but the actual graph
(`vfx_get_document` on the shipped component) runs **three independent Schedule windows** with different starts/
lengths relative to the published `start-at` knob: `active` (0–138), `bubblewin` (18–138), `residuewin` (6–238,
i.e. it starts *before* the bubble window and outlives the cloud by 100 ticks). This isn't wrong, and it's actually
the right behaviour (residue should outlast the gas), but nothing in `components.md`'s control table surfaces the
*relative* offsets in a way that explains why `vfx_render_frames` at a tick past the visible "Cloud radius" knob's
effect can still show a faint floor stain — an agent relying only on the knob table (not `vfx_get_document`) could
reasonably conclude the effect fully ends when the cloud does. Not a bug; flagging because it cost a render+lookup
cycle to confirm during recipe verification, and `recipes/poison.md` now calls this out explicitly ("poison should
leave a stain... long after the gas itself has drifted off").

## Not a gap, but worth recording

- Every `rv-<component>.json` file under `work/mcp/` (saved from the Gate D evidence pass) can be reopened with
  `vfx_open_document` and inspected with `vfx_get_document` to get the exact shipped wiring/params for any
  component — this is how the "From scratch" sections of these recipes were verified against the real graphs
  instead of being reconstructed from the control tables alone. Worth keeping these `rv-*` files around (or
  regenerating them) as a reference corpus for future guide work rather than deleting them as scratch files.
