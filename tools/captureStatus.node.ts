import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRegistry } from '../src/graph/registry.ts';
import { registrySignature } from '../src/graph/registrySignature.ts';
import { classifyCaptureStatus } from '../mcp/captureStatus.ts';

export function captureRun(root: string, tick: number, editor: string) {
  const run = randomUUID(), path = join(root, 'work/mcp/frames/status', `${run}.json`);
  return { run, check(png: string) {
    let raw: string | undefined;
    try { if (existsSync(path)) raw = readFileSync(path, 'utf8'); }
    finally { rmSync(path, { force: true }); }
    const status = classifyCaptureStatus(raw, registrySignature(createRegistry()), tick, editor);
    if (!status.ok) throw new Error(`${status.message}\nPNG for inspection: ${png}`);
  } };
}
