// Included procedural meshes (10-ASSETS "Built-in shard, three rock variants, orb, plane, cone"). Deterministic
// (seeded jitter), unit-sized (~1 m across), centred at the origin, +Y is the "forward" axis used by
// velocity orientation. Created once per viewport and shared by every MeshRenderer layer.
import * as THREE from 'three';

export const BUILTIN_MESHES = ['shard', 'rock-a', 'rock-b', 'rock-c', 'orb', 'cone', 'crystal', 'crystal-b', 'cylinder', 'box', 'plane'] as const;
export type BuiltinMesh = typeof BUILTIN_MESHES[number];

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Radially jitters vertices (shared positions stay welded because jitter is keyed by rounded position). */
function jitter(g: THREE.BufferGeometry, seed: number, amount: number, stretch: THREE.Vector3): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute, cache = new Map<string, number>(), r = rng(seed);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let k = cache.get(key);
    if (k === undefined) { k = 1 + (r() - 0.5) * 2 * amount; cache.set(key, k); }
    pos.setXYZ(i, x * k * stretch.x, y * k * stretch.y, z * k * stretch.z);
  }
  g.computeVertexNormals();
  return g;
}

export function createBuiltinMesh(kind: BuiltinMesh): THREE.BufferGeometry {
  switch (kind) {
    case 'shard': return jitter(new THREE.OctahedronGeometry(0.5, 0).toNonIndexed(), 11, 0.25, new THREE.Vector3(0.45, 1.3, 0.35));
    case 'rock-a': return jitter(new THREE.IcosahedronGeometry(0.5, 1).toNonIndexed(), 21, 0.22, new THREE.Vector3(1, 0.75, 0.9));
    case 'rock-b': return jitter(new THREE.DodecahedronGeometry(0.5, 0).toNonIndexed(), 31, 0.2, new THREE.Vector3(1.1, 0.7, 0.85));
    case 'rock-c': return jitter(new THREE.IcosahedronGeometry(0.5, 0).toNonIndexed(), 41, 0.3, new THREE.Vector3(0.9, 0.8, 1.1));
    case 'orb': return new THREE.SphereGeometry(0.5, 24, 16);
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
    case 'box': return new THREE.BoxGeometry(1, 1, 1);
    case 'cone': return new THREE.ConeGeometry(0.35, 1, 16);
    // Flat 1 m card in the XY plane (+Y forward), e.g. ground decals or debris flakes; use Faces = double to see both sides.
    case 'plane': return new THREE.PlaneGeometry(1, 1);
    // Faceted ice crystals: a column with a pointed tip (hexagonal / square), jittered so no two faces match.
    case 'crystal': return jitter(new THREE.LatheGeometry([new THREE.Vector2(0.26, -0.5), new THREE.Vector2(0.3, 0.12), new THREE.Vector2(0.001, 0.5)], 6).toNonIndexed(), 51, 0.12, new THREE.Vector3(1, 1, 0.85));
    case 'crystal-b': return jitter(new THREE.LatheGeometry([new THREE.Vector2(0.3, -0.5), new THREE.Vector2(0.24, 0.25), new THREE.Vector2(0.001, 0.5)], 4).toNonIndexed(), 61, 0.15, new THREE.Vector3(1, 1, 0.8));
  }
}
