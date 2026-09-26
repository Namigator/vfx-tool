// stdio entry point: node --experimental-strip-types mcp/vfx-mcp.ts  (registered in .mcp.json).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createVfxServer } from './server.ts';

await createVfxServer({ root: process.env.VFX_ROOT ?? process.cwd() }).connect(new StdioServerTransport());
