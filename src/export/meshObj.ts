// Built-in meshes (src/render/builtinMeshes.ts) as Wavefront OBJ text for engine exports (Unity, Godot): the same
// geometry the editor draws, so mesh particles keep their silhouette. Positions and normals in metres, +Y up,
// right-handed like the editor; each engine's own OBJ importer converts handedness.
import { createBuiltinMesh, BUILTIN_MESHES, type BuiltinMesh } from '../render/builtinMeshes.ts';

export const isBuiltinMesh = (id: string): id is BuiltinMesh => (BUILTIN_MESHES as readonly string[]).includes(id);

/** scaleY stretches the height (MeshRenderer scaleY), baked for engines whose particles scale uniformly. */
export function builtinMeshObj(kind: BuiltinMesh, scaleY = 1): string {
  const src = createBuiltinMesh(kind), g = src.index ? src.toNonIndexed() : src;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const f = (v: number) => (Math.round(v * 1e5) / 1e5).toString();
  const lines = [`# VFX Studio built-in mesh "${kind}"`, `o ${kind}`];
  for (let i = 0; i < p.count; i++) lines.push(`v ${f(p.getX(i))} ${f(p.getY(i) * scaleY)} ${f(p.getZ(i))}`);
  for (let i = 0; i < n.count; i++) { const x = n.getX(i), y = n.getY(i) / scaleY, z = n.getZ(i), l = Math.hypot(x, y, z) || 1; lines.push(`vn ${f(x / l)} ${f(y / l)} ${f(z / l)}`); }
  for (let i = 0; i + 2 < p.count; i += 3) lines.push(`f ${i + 1}//${i + 1} ${i + 2}//${i + 2} ${i + 3}//${i + 3}`);
  return lines.join('\n') + '\n';
}
