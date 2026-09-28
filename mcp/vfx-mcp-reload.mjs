// Auto-reloading stdio wrapper for the vfx MCP server (registered in .mcp.json). The real server
// (mcp/vfx-mcp.ts) runs as a child process; when files under src/ or mcp/ change, the child is restarted so
// agents always use the current tool code without the user reconnecting. The client's `initialize` handshake
// is replayed to each new child (its reply swallowed), requests arriving mid-restart are queued, and the client
// is told the tool list changed. Open documents survive because the server reloads them from work/mcp/<id>.json.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';

const serverArgs = ['--experimental-strip-types', '--no-warnings', 'mcp/vfx-mcp.ts'];
let child = null, ready = false, init = null, initialized = null, pending = [], restarting = false, timer = null;
const REPLAY_ID = '__vfx_reload_init__';

const send = line => process.stdout.write(line + '\n');
const log = msg => process.stderr.write(`[vfx-mcp-reload] ${msg}\n`);

function start(replay) {
  ready = !replay;
  child = spawn(process.execPath, serverArgs, { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
  let buf = '';
  child.stdout.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { send(line); continue; }
      if (msg.id === REPLAY_ID) { // Our replayed handshake: finish it, then flush queued requests.
        if (initialized) child.stdin.write(initialized + '\n');
        ready = true;
        for (const p of pending.splice(0)) child.stdin.write(p + '\n');
        send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }));
        log('server reloaded');
        continue;
      }
      send(line);
    }
  });
  child.on('exit', code => { if (!restarting) { log(`server exited (${code}); restarting`); restart(); } });
  if (replay && init) { const m = JSON.parse(init); m.id = REPLAY_ID; child.stdin.write(JSON.stringify(m) + '\n'); }
}

function restart() {
  restarting = true;
  const old = child;
  if (old) { old.removeAllListeners('exit'); old.kill(); }
  restarting = false;
  start(init !== null);
}

let inBuf = '';
process.stdin.on('data', chunk => {
  inBuf += chunk;
  let i;
  while ((i = inBuf.indexOf('\n')) >= 0) {
    const line = inBuf.slice(0, i); inBuf = inBuf.slice(i + 1);
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m.method === 'initialize') init = line;
      if (m.method === 'notifications/initialized') initialized = line;
    } catch { /* forward as-is */ }
    if (ready) child.stdin.write(line + '\n'); else pending.push(line);
  }
});
process.stdin.on('end', () => { child?.kill(); process.exit(0); });

const onChange = (_e, file) => {
  if (!file || !/\.(ts|mjs|js|json)$/.test(String(file)) || /generated|work[\\/]/.test(String(file))) return;
  clearTimeout(timer);
  timer = setTimeout(() => { log(`change in ${file}; reloading`); restart(); }, 400);
};
for (const dir of ['src', 'mcp']) { try { watch(dir, { recursive: true }, onChange); } catch (e) { log(`cannot watch ${dir}: ${e.message}`); } }
start(false);
