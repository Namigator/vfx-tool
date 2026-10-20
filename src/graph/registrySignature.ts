import type { NodeSpec } from '../model/types.ts';
import { SCHEMA_VERSION } from '../model/types.ts';

// Metadata fingerprint, not a renderer/content hash.
export function registrySignature(registry: ReadonlyMap<string, NodeSpec>): string {
  const rows = [...registry.values()].map(s => JSON.stringify([s.type, s.definitionVersion, s.parameters.map(p => p.id).sort()])).sort();
  const text = JSON.stringify([SCHEMA_VERSION, rows]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
