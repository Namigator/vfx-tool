// Auto-reloading stdio wrapper for the vfx MCP server (registered in .mcp.json). The real server
// (mcp/vfx-mcp.ts) runs as a child process; when files under src/ or mcp/ change, the child is restarted so
// agents always use the current tool code without the user reconnecting. The client's `initialize` handshake
// is replayed to each new child (its reply swallowed), requests arriving mid-restart are queued, and the client
// is told the tool list changed. Open documents survive because the server reloads them from work/mcp/<id>.json.
// A reload never strands a call: it waits (up to MAX_RELOAD_WAIT_MS) for in-flight requests to answer, and any request
// still open when the old child goes away gets a JSON-RPC error ("server reloaded; retry") instead of silence (a lost
// reply used to leave the client waiting for its 30-minute timeout).
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';

const serverArgs = ['--experimental-strip-types', '--no-warnings', 'mcp/vfx-mcp.ts'];
let child = null, ready = false, init = null, initialized = null, pending = [], restarting = false, timer = null;
/** Request ids forwarded to the current child and not answered yet (id -> method). */
const inFlight = new Map();
const MAX_RELOAD_WAIT_MS = 90_000;
let reloadWanted = false, reloadDeadline = 0;
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
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        inFlight.delete(msg.id);
        if (reloadWanted && inFlight.size === 0) setTimeout(maybeReload, 0);
      }
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
  // A crash (e.g. a syntax error mid-edit) restarts after a back-off, not in a tight loop; the next file change
  // restarts it at once anyway.
  const startedAt = Date.now();
  child.on('exit', code => {
    failInFlight(`the VFX server exited (code ${code})`);
    if (restarting) return;
    const wait = Date.now() - startedAt < 3000 ? 3000 : 0;
    log(`server exited (${code}); restarting${wait ? ' in 3 s' : ''}`);
    clearTimeout(timer);
    timer = setTimeout(restart, wait);
  });
  if (replay && init) { const m = JSON.parse(init); m.id = REPLAY_ID; child.stdin.write(JSON.stringify(m) + '\n'); }
}

/** Answer every still-open request with an error so no caller waits forever. */
function failInFlight(why) {
  for (const [id, method] of inFlight) {
    send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: `${method} was interrupted: ${why}. Nothing is wrong with your document; retry the call.` } }));
  }
  inFlight.clear();
}

/** Reload now if nothing is in flight (or the wait ran out), else check again when the last reply arrives. */
function maybeReload() {
  if (!reloadWanted) return;
  if (inFlight.size > 0 && Date.now() < reloadDeadline) { clearTimeout(timer); timer = setTimeout(maybeReload, 1000); return; }
  reloadWanted = false;
  failInFlight('the VFX server reloaded after a code change');
  restart();
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
    try { const m = JSON.parse(line); if (m.id !== undefined && m.method) inFlight.set(m.id, m.method === 'tools/call' ? `tools/call ${m.params?.name ?? ''}` : m.method); } catch { /* not JSON */ }
    if (ready) child.stdin.write(line + '\n'); else pending.push(line);
  }
});
process.stdin.on('end', () => { child?.kill(); process.exit(0); });

const onChange = (_e, file) => {
  if (!file || !/\.(ts|mjs|js|json)$/.test(String(file)) || /generated|work[\\/]/.test(String(file))) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    log(`change in ${file}; reloading${inFlight.size ? ` after ${inFlight.size} in-flight call(s) finish` : ''}`);
    reloadWanted = true; reloadDeadline = Date.now() + MAX_RELOAD_WAIT_MS; maybeReload();
  }, 400);
};
for (const dir of ['src', 'mcp']) { try { watch(dir, { recursive: true }, onChange); } catch (e) { log(`cannot watch ${dir}: ${e.message}`); } }
start(false);
