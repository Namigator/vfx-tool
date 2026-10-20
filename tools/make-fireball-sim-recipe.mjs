// Writes mcp/examples/fireball-sim.steps.json: the Fireball recipe rebuilt on the simulated (Unity Labs CC0) sprites —
// sim-flame trail with bigger particles, a dark wispy smoke trail behind it, a sim-fireball body on the core and a
// sim-explosion fire burst on impact. The original fireball.steps.json is left as is.
// Usage: node tools/make-fireball-sim-recipe.mjs   (then node tools/build-components.mjs)
import { readFileSync, writeFileSync } from 'node:fs';

const DOC = 'fireball-sim';
const steps = JSON.parse(readFileSync('mcp/examples/fireball.steps.json', 'utf8'))
  .map(([tool, a]) => [tool, JSON.parse(JSON.stringify({ ...a, docId: DOC }).replaceAll('"id":"fireball"', `"id":"${DOC}"`))]);
const node = id => steps.find(([t, a]) => t === 'vfx_add_node' && a.id === id)[1].params;
const curve = keys => ({ domain: 'normalized', interpolation: 'linear', keys: keys.map(([x, y]) => ({ x, y })) });
const grad = stops => ({ stops: stops.map(([position, srgb, alpha = 1]) => ({ position, color: { srgb, alpha } })) });
const add = (type, id, params) => ['vfx_add_node', { docId: DOC, type, id, params }];
const wire = (from, to) => ['vfx_connect', { docId: DOC, from, to }];

// Flame trail: simulated flame tongues, additive, bigger and fewer.
Object.assign(node('flamemat'), { sprite: 'sim-flame', blend: 'additive', opacity: 0.85 });
Object.assign(node('trailip'), { sizeMin: 0.7, sizeMax: 1.2 });
Object.assign(node('trailem'), { rate: 520, lifetimeMin: 0.3, lifetimeMax: 0.55 });
node('flames').colorOverLife = grad([[0, '#FFF2D0'], [0.35, '#FFA040'], [0.75, '#C03808'], [1, '#401004']]);

// Core: a rolling simulated fireball body over the soft glow.
const extra = [
  add('Material', 'bodymat', { template: 'SpriteTextured', sprite: 'sim-fireball', blend: 'additive', tint: { srgb: '#FFB060', alpha: 1 }, emission: 1.3 }),
  add('SpriteRenderer', 'body', { size: 1.1, spin: 4 }),
  wire('ball.anchor', 'body.anchor'), wire('bodymat.material', 'body.material'), wire('flight.window', 'body.window'),
  wire('body.visual', 'node-output.visual'),

  // Smoke trail: dark wisps shed behind the flames, rising and spreading.
  add('Emitter', 'smokeem', { shape: 'sphere', radius: 0.2, rate: 90, burst: 0, speedMin: 0.1, speedMax: 0.4, lifetimeMin: 0.8, lifetimeMax: 1.4 }),
  add('InitialProperties', 'smokeip', { sizeMin: 0.9, sizeMax: 1.5, rotationMin: -3, rotationMax: 3, angularVelocityMin: -0.6, angularVelocityMax: 0.6 }),
  add('Gravity', 'smokelift', { acceleration: [0, 0.8, 0] }),
  add('Material', 'smokemat', { template: 'SpriteTextured', sprite: 'sim-smoke-wispy', blend: 'normal', tint: { srgb: '#3A302A', alpha: 1 }, opacity: 0.55 }),
  add('BillboardRenderer', 'smoke', { flipbookMode: 'overLife', renderOrderOffset: -1,
    sizeOverLife: curve([[0, 0.6], [1, 1.9]]), opacityOverLife: curve([[0, 0], [0.2, 1], [1, 0]]) }),
  wire('ball.anchor', 'smokeem.anchor'), wire('flight.window', 'smokeem.window'),
  wire('smokeem.particles', 'smokeip.particles'), wire('smokeip.particles', 'smokelift.particles'), wire('smokelift.particles', 'smoke.particles'),
  wire('smokemat.material', 'smoke.material'), wire('smoke.visual', 'node-output.visual'),

  // Impact: a few big simulated explosion puffs at the hit.
  add('Emitter', 'blastem', { shape: 'sphere', radius: 0.3, burst: 7, rate: 0, speedMin: 0.6, speedMax: 1.8, lifetimeMin: 0.55, lifetimeMax: 0.9, useEventPosition: true }),
  add('InitialProperties', 'blastip', { sizeMin: 1.6, sizeMax: 2.6, rotationMin: -3, rotationMax: 3, angularVelocityMin: -1, angularVelocityMax: 1 }),
  add('Material', 'blastmat', { template: 'SpriteTextured', sprite: 'sim-explosion', blend: 'additive', opacity: 0.95 }),
  add('BillboardRenderer', 'blast', { flipbookMode: 'overLife', sizeOverLife: curve([[0, 0.5], [0.3, 1], [1, 1.3]]),
    opacityOverLife: curve([[0, 1], [0.6, 0.8], [1, 0]]), colorOverLife: grad([[0, '#FFFFFF'], [0.4, '#FFB050'], [1, '#802008']]) }),
  wire('ball.arrival', 'blastem.trigger'), wire('blastem.particles', 'blastip.particles'), wire('blastip.particles', 'blast.particles'),
  wire('blastmat.material', 'blast.material'), wire('blast.visual', 'node-output.visual'),
];
const at = steps.findIndex(([t]) => t === 'vfx_compile');
steps.splice(at, 0, ...extra);
for (const [t, a] of steps) if (t !== 'vfx_new_document' && a.docId !== DOC) throw new Error('docId');
writeFileSync('mcp/examples/fireball-sim.steps.json', JSON.stringify(steps, null, 1) + '\n');
console.log(`wrote mcp/examples/fireball-sim.steps.json (${steps.length} steps)`);
