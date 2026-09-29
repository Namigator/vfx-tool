// 17 Gate D evidence: every family default + two variants, charge → decay, at two oblique angles, dark and light.
// Cameras are placed from each effect's own Source/Target layout. Output: work/mcp/frames/rv-<id>-<angle>-<bg>.png
// Run: node tools/make-gate-d-steps.mjs && node mcp/run-steps.mjs work/gate-d.steps.json
import { readFileSync, writeFileSync } from 'node:fs';

export const FAMILIES = {
  lightning: ['lightning-strike', 'lightning-thin-fork', 'lightning-heavy-strike'],
  fire: ['fire-jet', 'fire-torch', 'fire-burst'],
  water: ['water-stream', 'water-narrow', 'water-broad'],
  wind: ['wind-gust', 'wind-cut', 'wind-whirl'],
  earth: ['earth-upheaval', 'earth-heavy', 'earth-gravel'],
  ice: ['ice-eruption', 'ice-fan', 'ice-cluster'],
  poison: ['poison-caustic', 'poison-pool', 'poison-plume'],
  light: ['light-pulse', 'light-cone', 'light-blessing'],
  shadow: ['shadow-collapse', 'shadow-puff', 'shadow-tendril'],
  energy: ['energy-bolt', 'energy-needle', 'energy-orb'],
};

const steps = [];
for (const ids of Object.values(FAMILIES)) for (const id of ids) {
  const doc = JSON.parse(readFileSync(`work/mcp/rv-${id}.json`, 'utf8'));
  const at = k => doc.anchors.find(a => a.id === k).position;
  const s = at('source'), t = at('target');
  const c = [(s[0] + t[0]) / 2, Math.max(0.8, (s[1] + t[1]) / 2 + 0.5), (s[2] + t[2]) / 2];
  const d = Math.max(4, Math.hypot(t[0] - s[0], t[1] - s[1], t[2] - s[2]) * 1.0);
  const cams = {
    a: { position: [c[0] + d * 0.35, c[1] + d * 0.42, c[2] + d * 0.88], target: c, fov: 45 },
    b: { position: [c[0] - d * 0.75, c[1] + d * 0.3, c[2] - d * 0.62], target: c, fov: 45 },
  };
  steps.push(['vfx_open_document', { path: `work/mcp/rv-${id}.json` }]);
  for (const [angle, camera] of Object.entries(cams)) for (const background of ['dark', 'light']) {
    steps.push(['vfx_contact_sheet', { docId: `rv-${id}`, count: 6, columns: 6, camera, background, name: `${angle}-${background}` }, true]);
  }
}
writeFileSync('work/gate-d.steps.json', JSON.stringify(steps));
console.log(`${steps.length} steps, ${steps.filter(s => s[0] === 'vfx_contact_sheet').length} sheets`);
