// Runs a list of MCP tool calls from a JSON file against the stdio VFX server: node mcp/run-steps.mjs mcp/examples/sparks.steps.json
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const steps = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const c = new Client({ name: 'runner', version: '0' });
await c.connect(new StdioClientTransport({ command: 'node', args: ['--experimental-strip-types', '--no-warnings', 'mcp/vfx-mcp.ts'] }));
for (const [name, args, print] of steps) {
  const r = await c.callTool({ name, arguments: args });
  const text = r.content.map(x => x.text).join('\n');
  if (r.isError) { console.error(`${name} FAILED: ${text}`); process.exitCode = 1; break; }
  if (print) console.log(text);
}
await c.close();
