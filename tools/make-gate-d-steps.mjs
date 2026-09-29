// 17 Gate D evidence: every family default + two variants, charge → decay, at two oblique angles, dark and light.
// Cameras are placed from each effect's own Source/Target layout. Output: work/mcp/frames/rv-<id>-<angle>-<bg>.png
// Run: node tools/make-gate-d-steps.mjs && node mcp/run-steps.mjs work/gate-d.steps.json
import { writeFileSync } from 'node:fs';

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
  // Automatic framing (fits every part of the effect), orbited to two oblique angles: front-right and back-left.
  const cams = { a: { yaw: 30, pitch: 28 }, b: { yaw: -150, pitch: 22 } };
  // Built fresh from the current component (like the editor's Add component), never from a stale saved copy.
  steps.push(['vfx_new_document', { template: 'blank', id: `rv-${id}` }], ['vfx_add_component', { docId: `rv-${id}`, component: id, group: true }]);
  for (const [angle, orbit] of Object.entries(cams)) for (const background of ['dark', 'light']) {
    steps.push(['vfx_contact_sheet', { docId: `rv-${id}`, count: 6, columns: 6, orbit, background, name: `${angle}-${background}` }, true]);
  }
}
writeFileSync('work/gate-d.steps.json', JSON.stringify(steps));
console.log(`${steps.length} steps, ${steps.filter(s => s[0] === 'vfx_contact_sheet').length} sheets`);
