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

// Flame trail: thin sharp strands shot backwards (aimed at Source) and stretched along their velocity, so every
// strand points back along the flight path; no spin. White-hot at the ball, cooling to crimson at the tail.
const TRAIL_SPRITE = process.env.TRAIL_SPRITE ?? 'flame-tongue-a';
Object.assign(node('flamemat'), { sprite: TRAIL_SPRITE, blend: 'additive', opacity: Number(process.env.TRAIL_OPACITY ?? 0.32) });
Object.assign(node('trailip'), { sizeMin: 0.22, sizeMax: 0.4, rotationMin: 0, rotationMax: 0, angularVelocityMin: 0, angularVelocityMax: 0 });
Object.assign(node('trailem'), { shape: 'cone', coneAngle: 0.18, radius: 0.15, rate: Number(process.env.TRAIL_RATE ?? 650), speedMin: 1.5, speedMax: 4,
  lifetimeMin: 0.35, lifetimeMax: 0.7 });
Object.assign(node('flames'), { alignment: 'velocity', stretchRatio: Number(process.env.TRAIL_STRETCH ?? 7) });
node('flames').sizeOverLife = curve([[0, 1.1], [0.3, 1], [1, 0.35]]);
node('flames').colorOverLife = grad([[0, '#FFD880'], [0.15, '#FFA030'], [0.4, '#F05A10'], [0.75, '#A01810'], [1, '#4A0610']]);
Object.assign(node('lift'), { acceleration: [0, 0.4, 0] });
Object.assign(node('turb'), { amplitude: 1.2 });
steps.splice(steps.findIndex(([t]) => t === 'vfx_compile'), 0, wire('node-source.out', 'trailem.aim'));
// Less wash: smaller, dimmer glow and lights so the strands read instead of one white bloom.
Object.assign(node('core'), { size: 0.9 });
Object.assign(node('coremat'), { emission: 1 });
Object.assign(node('balllight'), { intensity: 12 });
Object.assign(node('streak'), { width: 0.22 });
Object.assign(node('streakmat'), { opacity: 0.45 });

// Core: a rolling simulated fireball body over the soft glow.
const extra = [
  add('Material', 'bodymat', { template: 'SpriteTextured', sprite: 'sim-fireball', blend: 'additive', tint: { srgb: '#FFB060', alpha: 1 }, emission: 0.9, opacity: 0.8 }),
  add('SpriteRenderer', 'body', { size: 0.9, spin: 4 }),
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

  // Embers: small hot specks shed along the trail, drifting and flickering out.
  add('Emitter', 'emberem', { shape: 'sphere', radius: 0.3, rate: 70, burst: 0, speedMin: 0.3, speedMax: 1.4, lifetimeMin: 0.5, lifetimeMax: 1.1 }),
  add('InitialProperties', 'emberip', { sizeMin: 0.03, sizeMax: 0.07, rotationMin: 0, rotationMax: 0, angularVelocityMin: 0, angularVelocityMax: 0 }),
  add('NoiseForce', 'emberturb', { amplitude: 2.5, frequency: 1.5, evolution: 2 }),
  add('Material', 'embermat', { template: 'SpriteTextured', sprite: 'spark-streak', blend: 'additive' }),
  add('BillboardRenderer', 'embers', { alignment: 'velocity', stretchRatio: 2,
    opacityOverLife: curve([[0, 1], [0.7, 0.8], [1, 0]]), colorOverLife: grad([[0, '#FFE080'], [0.5, '#FF7020'], [1, '#801008']]) }),
  wire('ball.anchor', 'emberem.anchor'), wire('flight.window', 'emberem.window'),
  wire('emberem.particles', 'emberip.particles'), wire('emberip.particles', 'emberturb.particles'), wire('emberturb.particles', 'embers.particles'),
  wire('embermat.material', 'embers.material'), wire('embers.visual', 'node-output.visual'),

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
