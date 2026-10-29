#!/usr/bin/env node
// Feature grid stage 1: builds every case in tools/feature-grid/cases.mjs through the MCP server (same calls an agent
// makes) and saves work/feature-grid/docs/<id>.json. A case whose steps fail is reported and skipped; the rest go on.
//   node tools/feature-grid/build-docs.mjs [id-filter]
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CASES, stepsFor } from './cases.mjs';

const only = process.argv[2];
mkdirSync('work/feature-grid/docs', { recursive: true });
const c = new Client({ name: 'feature-grid', version: '0' });
await c.connect(new StdioClientTransport({ command: 'node', args: ['--experimental-strip-types', '--no-warnings', 'mcp/vfx-mcp.ts'] }));
const failed = {};
for (const fc of CASES) {
  if (only && !fc.id.includes(only)) continue;
  for (const [name, args] of stepsFor(fc)) {
    const r = await c.callTool({ name, arguments: args });
    if (r.isError) { failed[fc.id] = `${name} ${JSON.stringify(args).slice(0, 160)}: ${r.content.map(x => x.text).join(' ').slice(0, 300)}`; break; }
  }
  console.log(`${failed[fc.id] ? 'FAIL' : 'ok  '} ${fc.id}${failed[fc.id] ? ' - ' + failed[fc.id] : ''}`);
}
await c.close();
writeFileSync('work/feature-grid/build-failures.json', JSON.stringify(failed, null, 1));
process.exit(Object.keys(failed).length ? 1 : 0);
