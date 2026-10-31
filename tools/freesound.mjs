#!/usr/bin/env node
// Finds and downloads CC0 sounds from Freesound without an API key: search pages and sound pages are public HTML, and
// each sound's HQ preview (128 kbps mp3) is a public CDN file. Only sounds whose page says "Creative Commons 0" are kept.
//   node tools/freesound.mjs search "thunder clap" [--maxdur 8] [--n 15]   -> id, seconds, downloads, title, user
//   node tools/freesound.mjs fetch 446753 194364 ...                       -> work/sounds-raw/freesound/<id>.mp3 + <id>.json
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..'), DIR = join(ROOT, 'work/sounds-raw/freesound');
const UA = { 'User-Agent': 'Mozilla/5.0 (VFX Studio sound library builder)' };
const [cmd, ...rest] = process.argv.slice(2);
const flag = (k, d) => { const i = rest.indexOf(`--${k}`); return i < 0 ? d : Number(rest[i + 1]); };
const attr = (card, k) => card.match(new RegExp(`data-${k}="([^"]*)"`))?.[1] ?? '';
const unescape = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

async function page(url) {
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return { url: r.url, html: await r.text() };
}
// A result card (search page) or the sound page's player both carry the data-* attributes; license is in a title attr.
function cards(html) {
  return html.split('data-sound-id="').slice(1).map(c => ({ id: Number(c.slice(0, c.indexOf('"'))), c: 'data-sound-id="' + c }))
    .map(({ id, c }) => ({ id, user: attr(c, 'username'), title: unescape(attr(c, 'title')), sec: Number(attr(c, 'duration')),
      downloads: Number(attr(c, 'num-downloads')), mp3: attr(c, 'mp3').replace('-lq.mp3', '-hq.mp3'), cc0: /License: Creative Commons 0/.test(c) }));
}

if (cmd === 'search') {
  const q = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--')).join(' ');
  const maxdur = flag('maxdur', 10), n = flag('n', 15);
  const url = `https://freesound.org/search/?q=${encodeURIComponent(q)}&f=license:%22Creative+Commons+0%22+duration:[0+TO+${maxdur}]&s=Downloads+(most+first)`;
  const seen = new Set();
  for (const s of cards((await page(url)).html)) {
    if (seen.has(s.id) || !s.cc0) continue; seen.add(s.id);
    if (seen.size > n) break;
    console.log(`${s.id}\t${s.sec.toFixed(1)}s\t${s.downloads}\t${s.title}\t${s.user}`);
  }
} else if (cmd === 'fetch') {
  mkdirSync(DIR, { recursive: true });
  for (const id of rest.map(Number)) {
    if (existsSync(join(DIR, `${id}.json`))) { console.log(`${id}: have it`); continue; }
    const { url, html } = await page(`https://freesound.org/s/${id}/`);
    const s = cards(html).find(x => x.id === id);
    if (!s) throw new Error(`${id}: no player on ${url}`);
    if (!/Creative Commons 0|creativecommons\.org\/publicdomain\/zero/.test(html)) throw new Error(`${id}: not CC0, skipped`);
    const r = await fetch(s.mp3, { headers: UA });
    if (!r.ok) throw new Error(`${id}: preview HTTP ${r.status}`);
    writeFileSync(join(DIR, `${id}.mp3`), Buffer.from(await r.arrayBuffer()));
    // The sound page's player has no username attribute; the canonical URL /people/<user>/sounds/<id>/ does.
    const author = s.user || decodeURIComponent(url.match(/\/people\/([^/]+)\//)?.[1] ?? '');
    writeFileSync(join(DIR, `${id}.json`), JSON.stringify({ id, title: s.title, author, url, license: 'CC0 1.0', durationSec: s.sec, file: s.mp3 }, null, 1));
    console.log(`${id}: ${s.title} by ${author} (${s.sec.toFixed(1)}s)`);
  }
} else {
  console.log('usage: freesound.mjs search <query> [--maxdur s] [--n k] | fetch <id...>');
  process.exit(1);
}
