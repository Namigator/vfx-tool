# Test when home

The code passes automated checks, but nobody has yet inspected this build in a browser or listened to its sounds. These are pending checks, not reported results.

## Open

Visit http://127.0.0.1:5174/. If unavailable, double-click Start-VFX.cmd in this folder, leave its terminal open, and visit the URL again. Port 5173 is the older demo; this editor uses 5174.

## Quick check (about 10 minutes)

1. Select each of the ten elements. Look for a visible effect, a clean ending, and no error overlay. Orbit the camera and toggle Glow and Light floor.
2. On lightning, change width, branches, spread, and seed. Drag a slider through several values, then press Undo once: it should restore the value before that drag. Try Redo.
3. Type 0.75 into a timing number field, then press Enter. Open Source & target, type -2.5 into Source X, then leave the field. Values should commit after typing; blank or invalid entries should revert.
4. Pause, scrub through charge/active/decay, step one frame, restart, and disable Loop. At the endpoint the effect should be gone. Try slow motion.
5. Enable Sound at normal speed at a comfortable speaker volume. Listen to all ten elements. Check for clipping, clicks, annoying repetition, and sound timing relative to the effect. Slow motion and scrubbing are intentionally silent.
6. With sound playing, switch to another browser tab for several seconds, then return. It should resume without a large time jump or overlapping sounds.
7. Name and Save preset. Reload the page and reopen it from My Presets. Download JSON, change something, then import the downloaded file and compare. Repeat with Download effect bundle under Sound; download and play a WAV too.
8. Open Diagnostics and switch elements repeatedly for a few minutes. Watch for persistent stutter or resource counts that keep growing after all elements have been loaded once. Resize the window and check that important controls remain usable.

## Useful feedback

For any issue, note the element, seed, parameter values, browser, whether Glow/Sound was enabled, and the exact steps. Save its JSON recipe so the same case can be reproduced. A screenshot or short recording is useful for visual defects.

## Automated evidence already recorded

- 46 Node tests: core generation, validation, recipe/bundle round-trips, PCM signals, history, numeric commits, transport, and simulated Web Audio lifecycle.
- Strict TypeScript check and production build pass; build retains an advisory large-JavaScript-chunk warning.
- 30 configurations / 7200 CPU-sampled frames checked. This excludes rendering and does not prove a 60 FPS target.
- evidence/ contains reports. None is evidence that visuals were seen or audio was heard.
