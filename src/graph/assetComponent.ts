// 10 "After import, an explicit Add to effect action creates a suitable ready-made component": an imported asset
// becomes a small, pre-wired component template (inserted with insertComponent, one undoable edit). Import alone
// never changes the graph; this is the explicit step. The template depends only on the asset's kind and role.
import type { AssetReference } from '../model/types.ts';
import type { ComponentTemplate } from './components.ts';

const fadeInOut = { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 0 }, { x: 0.15, y: 1 }, { x: 1, y: 0 }] };
const grow = { domain: 'normalized', interpolation: 'linear', keys: [{ x: 0, y: 0.6 }, { x: 1, y: 1.6 }] };

/** Rising sprite puffs from Source that draw `material` (a Material node's params). */
function puffs(id: string, label: string, description: string, material: Record<string, unknown>): ComponentTemplate {
  return {
    id, label, description, durationTicks: 180, anchors: [],
    nodes: [
      { id: 'sched', type: 'Schedule', params: { startTicks: 0, durationTicks: 120, mode: 'window' } },
      { id: 'em', type: 'Emitter', params: { shape: 'disc', direction: [0, 1, 0], radius: 0.2, rate: 24, burst: 0, speedMin: 0.4, speedMax: 0.9, lifetimeMin: 1.2, lifetimeMax: 1.8 } },
      { id: 'ip', type: 'InitialProperties', params: { sizeMin: 0.35, sizeMax: 0.55, rotationMin: 0, rotationMax: 6.28, angularVelocityMin: -0.6, angularVelocityMax: 0.6 } },
      { id: 'drag', type: 'Drag', params: { coefficient: 0.8 } },
      { id: 'mat', type: 'Material', params: material },
      { id: 'bb', type: 'BillboardRenderer', params: { sizeOverLife: grow, opacityOverLife: fadeInOut } },
    ],
    edges: [['node-source.out', 'em.anchor'], ['sched.window', 'em.window'], ['em.particles', 'ip.particles'], ['ip.particles', 'drag.particles'], ['drag.particles', 'bb.particles'], ['mat.material', 'bb.material'], ['bb.visual', 'node-output.visual']],
    knobs: [
      { id: 'amount', label: 'Amount', value: 24, bindings: [{ node: 'em', parameter: 'rate' }] },
      { id: 'size', label: 'Size', value: 0.55, bindings: [{ node: 'ip', parameter: 'sizeMax' }, { node: 'ip', parameter: 'sizeMin', scale: 0.64 }] },
      { id: 'opacity', label: 'Opacity', value: 1, bindings: [{ node: 'mat', parameter: 'opacity' }] },
    ],
  };
}

/** A burst of lit meshes at Target that tumble, fall and bounce. */
function debris(id: string, label: string, description: string, renderer: Record<string, unknown>, material: Record<string, unknown>): ComponentTemplate {
  return {
    id, label, description, durationTicks: 150, anchors: [],
    nodes: [
      { id: 'hit', type: 'Schedule', params: { startTicks: 0, durationTicks: 1, mode: 'once' } },
      { id: 'em', type: 'Emitter', params: { shape: 'cone', direction: [0, 1, 0], coneAngle: 0.6, radius: 0.2, burst: 12, rate: 0, speedMin: 2.5, speedMax: 5, lifetimeMin: 2, lifetimeMax: 2.4 } },
      { id: 'ip', type: 'InitialProperties', params: { sizeMin: 0.2, sizeMax: 0.35, rotationMin: 0, rotationMax: 6.28, angularVelocityMin: -6, angularVelocityMax: 6 } },
      { id: 'grav', type: 'Gravity' },
      { id: 'ground', type: 'GroundCollision', params: { mode: 'bounce', restitution: 0.3, friction: 0.6, maxBounces: 2 } },
      { id: 'mat', type: 'Material', params: { template: 'MeshLit', blend: 'normal', ...material } },
      { id: 'mesh', type: 'MeshRenderer', params: { orientation: 'tumble', lit: true, ...renderer } },
    ],
    edges: [['node-target.out', 'em.anchor'], ['hit.start', 'em.trigger'], ['em.particles', 'ip.particles'], ['ip.particles', 'grav.particles'], ['grav.particles', 'ground.particles'], ['ground.particles', 'mesh.particles'], ['mat.material', 'mesh.material'], ['mesh.visual', 'node-output.visual']],
    knobs: [
      { id: 'count', label: 'Count', value: 12, bindings: [{ node: 'em', parameter: 'burst' }] },
      { id: 'size', label: 'Size', value: 0.35, bindings: [{ node: 'ip', parameter: 'sizeMax' }, { node: 'ip', parameter: 'sizeMin', scale: 0.57 }] },
      { id: 'force', label: 'Blast speed', value: 5, bindings: [{ node: 'em', parameter: 'speedMax' }, { node: 'em', parameter: 'speedMin', scale: 0.5 }] },
    ],
  };
}

/** Component id prefix for an asset: a short slug of its file name. */
export function assetComponentPrefix(asset: AssetReference): string {
  const slug = asset.provenance.originalFilename.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return /^[a-z]/.test(slug) ? slug : `asset-${slug || asset.sha256.slice(0, 8)}`;
}

/** The ready-made component for an imported asset, or why there is none (e.g. sound, which is parked). */
export function assetComponent(asset: AssetReference): ComponentTemplate | string {
  const name = asset.provenance.originalFilename, id = assetComponentPrefix(asset);
  if (asset.kind === 'mesh') return debris(id, `${name} pieces`, `A burst of ${name} pieces at Target that tumble, fall and bounce.`, { meshAsset: asset.id, importedSize: 'fit' }, { roughness: 0.6 });
  if (asset.kind === 'texture' || asset.kind === 'flipbook') {
    switch (asset.colorSpace) {
      case 'normal': return debris(id, `Rocks with ${name}`, `Lit rocks at Target with ${name} as their normal map (surface relief).`, { mesh: 'rock-a' }, { normalAsset: asset.id, tint: { srgb: '#8A7A6A', alpha: 1 } });
      case 'noise': return puffs(id, `Dissolving puffs (${name})`, `Soft puffs from Source that burn away through the ${name} pattern.`, { template: 'SpriteTextured', sprite: 'smoke-puff', blend: 'normal', dissolve: 0.9, dissolveStart: 0.2, dissolveEdge: 0.06, noiseAsset: asset.id });
      case 'mask': return puffs(id, `${name} glow`, `Glowing ${name} sprites rising from Source (a mask is drawn additively and tinted).`, { template: 'SpriteTextured', textureAsset: asset.id, blend: 'additive', tint: { srgb: '#9FD8FF', alpha: 1 }, emission: 1 });
      default: return puffs(id, `${name} sprites`, `${name} sprites rising from Source${asset.kind === 'flipbook' ? ', playing the flipbook over each life' : ''}.`, { template: 'SpriteTextured', textureAsset: asset.id, blend: 'normal' });
    }
  }
  return `No ready-made component for a ${asset.kind} asset yet.`;
}
