// Generates src/graph/components.generated.ts from the verified MCP recipes in mcp/examples/.
// Each recipe's add_node / connect / set_anchor(custom) / set_document(duration) steps become a component
// template; compile/render/preview steps and Source/Target anchor moves are dropped (components adapt to
// the document's anchors). Usage: node tools/build-components.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const COMPONENTS = [
  ['spark-burst', 'Spark burst', 'Velocity-stretched sparks with glowing trails, three bursts.', 'spark-trails'],
  ['flame-jet', 'Flame jet', 'Textured flame flipbooks aimed Source→Target with turbulence, core glow and a flickering floor light.', 'flame-jet'],
  ['smoke-plume', 'Smoke plume', 'Rising curl-noise smoke with growth and fade over life.', 'smoke'],
  ['fountain', 'Water fountain', 'Upward cone of droplets with gravity and bouncing ground collision.', 'fountain'],
  ['rain-splash', 'Rain with splashes', 'Falling droplets that die on the ground and spawn splash bursts.', 'rain-splash'],
  ['impact-flash', 'Impact flash', 'Timed glow sprite with a spark burst at Target.', 'impact-flash'],
  ['arc-beam', 'Arc beam', 'Textured electric arc Source→Target on a jagged, re-rolling path with a soft glow ribbon.', 'arc-beam'],
  ['rock-burst', 'Rock burst', 'Lit tumbling rock chunks that bounce and settle, with a rolling dust cloud (earth impact).', 'rock-burst'],
  ['charge-up', 'Charge-up', 'Motes pulled and swirled into a growing glowing orb at Source with a rising light (Attract + Vortex).', 'charge-up'],
  ['tornado', 'Tornado', 'Dust funnel: rising particles swirled and pulled toward a vertical axis at Source (Vortex + lift).', 'tornado'],
  ['ice-shards', 'Ice shards', 'Lit crystal shards erupting from Target with frost mist and glints; shards slide to rest.', 'ice-shards'],
  ['poison-cloud', 'Poison cloud', 'Seeping green cloud with rising bubbles and a sickly floor glow; ramps in and fades.', 'poison-cloud'],
  ['shadow-vortex', 'Shadow vortex', 'Dark wisps pulled and swirled into a violet void core with a flickering violet light.', 'shadow-vortex'],
  ['holy-light', 'Holy light', 'Radiating light rays, a white-gold core, a spinning ground halo and a warm light.', 'holy-light'],
  ['helix-beam', 'Helix beam', 'Two spinning helix strands braided around a bright core line Source→Target (HelixPath + ribbons).', 'helix-beam'],
  ['fireball', 'Fireball', 'Projectile along an arc: glowing core, flame trail, moving light, impact sparks, flash and light.', 'fireball'],
];

const KNOBS = {
  'spark-burst': [['count', 'Sparks per burst', [['em', 'burst']]], ['speed', 'Speed', [['em', 'speedMax'], ['em', 'speedMin', 0.375]]], ['size', 'Spark size', [['ip', 'sizeMax'], ['ip', 'sizeMin', 0.55]]], ['trail', 'Trail length', [['trail', 'history']]], ['gravity-drag', 'Air drag', [['drag', 'coefficient']]]],
  'flame-jet': [['density', 'Density', [['em', 'rate']]], ['reach', 'Reach (speed)', [['em', 'speedMax'], ['em', 'speedMin', 0.78]]], ['spread', 'Spread', [['em', 'coneAngle']]], ['turbulence', 'Turbulence', [['turb', 'amplitude']]], ['size', 'Flame size', [['ip', 'sizeMax'], ['ip', 'sizeMin', 0.625]]], ['light', 'Floor light', [['glow', 'intensity']]]],
  'smoke-plume': [['amount', 'Amount', [['em', 'rate']]], ['swirl', 'Swirl', [['swirl', 'amplitude']]], ['size', 'Puff size', [['ip', 'sizeMax'], ['ip', 'sizeMin', 0.625]]], ['opacity', 'Opacity', [['mat', 'opacity']]], ['drag', 'Air drag', [['drag', 'coefficient']]]],
  'fountain': [['flow', 'Flow', [['em', 'rate']]], ['height', 'Jet speed', [['em', 'speedMax'], ['em', 'speedMin', 0.77]]], ['spread', 'Spread', [['em', 'coneAngle']]], ['bounce', 'Bounce', [['ground', 'restitution']]]],
  'rain-splash': [['rain', 'Rain rate', [['clouds', 'rate']]], ['area', 'Rain area', [['clouds', 'radius']]], ['splash', 'Splash drops', [['splash', 'burst']]], ['splash-speed', 'Splash speed', [['splash', 'speedMax'], ['splash', 'speedMin', 0.42]]]],
  'impact-flash': [['flash', 'Flash size', [['flash', 'size']]], ['sparks', 'Sparks', [['sparks', 'burst']]], ['speed', 'Spark speed', [['sparks', 'speedMax'], ['sparks', 'speedMin', 0.33]]]],
  'arc-beam': [['width', 'Beam width', [['core', 'width']]], ['jagged', 'Jaggedness', [['jag', 'amplitude']]], ['flicker', 'Re-roll rate', [['jag', 'regenerationHz']]], ['glow', 'Glow width', [['halo', 'width']]]],
  'rock-burst': [['count', 'Rock count', [['debris', 'burst']]], ['force', 'Blast speed', [['debris', 'speedMax'], ['debris', 'speedMin', 0.43]]], ['size', 'Rock size', [['rockip', 'sizeMax'], ['rockip', 'sizeMin', 0.36]]], ['dust', 'Dust amount', [['dust', 'burst']]]],
  'charge-up': [['motes', 'Mote rate', [['motes', 'rate']]], ['radius', 'Gather radius', [['motes', 'radius']]], ['pull', 'Pull strength', [['pull', 'acceleration']]], ['swirl', 'Swirl', [['swirl', 'tangential']]], ['core', 'Orb size', [['core', 'size']]]],
  'tornado': [['amount', 'Dust rate', [['base', 'rate']]], ['spin', 'Spin', [['vortex', 'tangential']]], ['pull', 'Funnel pull', [['vortex', 'inward']]], ['base', 'Base radius', [['base', 'radius']]]],
  'ice-shards': [['shards', 'Shard count', [['shards', 'burst']]], ['force', 'Burst speed', [['shards', 'speedMax'], ['shards', 'speedMin', 0.53]]], ['size', 'Shard size', [['shardip', 'sizeMax'], ['shardip', 'sizeMin', 0.45]]], ['frost', 'Frost amount', [['frost', 'burst']]]],
  'poison-cloud': [['amount', 'Cloud rate', [['cloud', 'rate']]], ['spread', 'Spread', [['cloud', 'radius']]], ['bubbles', 'Bubbles', [['bubbles', 'rate']]], ['glow', 'Glow', [['glow', 'intensity']]]],
  'shadow-vortex': [['wisps', 'Wisp rate', [['wisps', 'rate']]], ['radius', 'Gather radius', [['wisps', 'radius']]], ['pull', 'Pull', [['pull', 'acceleration']]], ['swirl', 'Swirl', [['swirl', 'tangential']]], ['core', 'Core size', [['core', 'size']]]],
  'holy-light': [['rays', 'Ray rate', [['rays', 'rate']]], ['length', 'Ray length', [['raybb', 'stretchRatio']]], ['core', 'Core size', [['core', 'size']]], ['halo', 'Halo size', [['halo', 'size']]], ['light', 'Light', [['lamp', 'intensity']]]],
  'helix-beam': [['radius', 'Helix radius', [['strandA', 'radius'], ['strandB', 'radius']]], ['turns', 'Turns', [['strandA', 'turns'], ['strandB', 'turns']]], ['spin', 'Spin', [['strandA', 'spin'], ['strandB', 'spin']]], ['width', 'Strand width', [['ribA', 'width'], ['ribB', 'width']]]],
  'fireball': [['travel', 'Travel ticks', [['ball', 'durationTicks']]], ['trail', 'Trail density', [['trailem', 'rate']]], ['core', 'Core size', [['core', 'size']]], ['impact', 'Impact sparks', [['boom', 'burst']]], ['flash', 'Flash size', [['flash', 'size']]], ['light', 'Ball light', [['balllight', 'intensity']]]],
};

const out = [];
for (const [id, label, description, file] of COMPONENTS) {
  const steps = JSON.parse(readFileSync(`mcp/examples/${file}.steps.json`, 'utf8'));
  const nodes = [], edges = [], anchors = [];
  let durationTicks = 0;
  for (const [tool, a] of steps) {
    if (tool === 'vfx_add_node') nodes.push({ id: a.id, type: a.type, ...(a.params ? { params: a.params } : {}) });
    else if (tool === 'vfx_connect') edges.push([a.from, a.to]);
    else if (tool === 'vfx_set_anchor' && a.anchorId !== 'source' && a.anchorId !== 'target') anchors.push({ id: a.anchorId, position: a.position });
    else if (tool === 'vfx_set_document' && a.durationTicks) durationTicks = a.durationTicks;
  }
  const knobs = (KNOBS[id] ?? []).map(([kid, klabel, binds]) => {
    const [n0, p0, s0 = 1] = binds[0], node = nodes.find(n => n.id === n0);
    if (!node) throw new Error(`${id}: knob ${kid} binds missing node ${n0}`);
    const v = node.params?.[p0];
    if (typeof v !== 'number') throw new Error(`${id}: knob ${kid} needs a literal number at ${n0}.${p0} in the recipe`);
    return { id: kid, label: klabel, value: v / s0, bindings: binds.map(([n, p, s]) => ({ node: n, parameter: p, ...(s ? { scale: s } : {}) })) };
  });
  out.push({ id, label, description, durationTicks, anchors, nodes, edges, knobs });
}
writeFileSync('src/graph/components.generated.ts', `// GENERATED by tools/build-components.mjs from mcp/examples/*.steps.json — do not edit.
import type { ComponentTemplate } from './components.ts';

export const COMPONENT_TEMPLATES: readonly ComponentTemplate[] = ${JSON.stringify(out, null, 1)};
`);
console.log(`wrote ${out.length} components`);
