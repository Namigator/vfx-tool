import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Roblox pack: README is XML-escaped StringValue documentation, not a disabled Script', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vfx-roblox-pack-'));
  try {
    const doc = join(tmp, 'effect.json');
    const readme = join(tmp, 'README.md');
    const out = join(tmp, 'pack.rbxmx');
    writeFileSync(doc, JSON.stringify(insertComponent(createBlankDocument(), 'fireball', undefined, { group: true }).doc));
    writeFileSync(readme, 'Pack <guide> & notes\nKeep ]==] and ]]> unchanged.\n');
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types', join(ROOT, 'tools', 'build-roblox-pack.mjs'),
      '--name', 'Test Pack', '--out', out, '--readme', readme, `Effect=${doc}`,
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const xml = readFileSync(out, 'utf8');
    assert.match(xml, /<Item class="StringValue" referent="[^"]+"><Properties><string name="Name">README<\/string><string name="Value">Pack &lt;guide&gt; &amp; notes\nKeep ]==] and ]]&gt; unchanged\.\n<\/string><\/Properties><\/Item>/);
    // Demo is executable playback code; only documentation Scripts are removed.
    const scripts = [...xml.matchAll(/<Item class="Script"[^>]*><Properties>([\s\S]*?)<\/Properties>/g)];
    assert.ok(scripts.length > 0, 'playback Demo is preserved');
    for (const script of scripts) {
      assert.doesNotMatch(script[1], /<string name="Name">README<\/string>/);
      assert.match(script[1], /<string name="Name">Demo<\/string>/);
      assert.match(script[1], /EffectPlayer\.play\(model/);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
