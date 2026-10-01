import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiRequest } from '../src/ai/types.ts';

export const MAX_GUIDE_CONTEXT = 48_000;
type Section = { id: string; topic: string; title: string; text: string };
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const words = (text: string) => new Set(text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []);
const STOP = new Set('the and for with from this that into your effect current document request node nodes value params source target position true false summary patches rendered ticks'.split(' '));

/** Only project-owned guide Markdown; no caller-controlled file paths or network reads. */
export function loadAiGuide(directory = fileURLToPath(new URL('../docs/ai-guide/', import.meta.url))): Section[] {
  const sections: Section[] = [];
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('_') || entry.isSymbolicLink()) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { visit(path); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const topic = path.slice(0, -3).toLowerCase(), text = readFileSync(join(directory, path), 'utf8').replace(/\r\n/g, '\n');
      const lines = text.split('\n'), title = lines.find(l => /^# /.test(l))?.slice(2) ?? topic;
      let start = 0, heading = title, fence = false, first = true;
      const emit = (end: number) => {
        const body = lines.slice(start, end).join('\n').trim();
        if (body) sections.push({ id: first ? topic : `${topic}#${slug(heading)}`, topic, title: heading, text: body });
      };
      // Leaf sections keep reference entries complete, including their tables/code blocks.
      const depth = topic === 'reference/nodes' || topic === 'reference/components' ? 3 : 2;
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
        if (!fence && lines[i].startsWith(`${'#'.repeat(depth)} `)) {
          emit(i); start = i; heading = lines[i].slice(depth + 1); first = false;
        }
      }
      emit(lines.length);
    }
  };
  visit('');
  if (!sections.some(s => s.topic === 'concepts')) throw new Error('VFX documentation is missing. Restore docs/ai-guide before starting the companion.');
  return sections;
}

/** Core concepts plus ranked/requested excerpts, refreshed for each model call. */
export function aiGuideContext(sections: Section[], request: AiRequest): string {
  const latest = request.messages.filter(m => m.role === 'user').at(-1)?.text ?? '';
  const prompt = latest.match(/^Request: ([\s\S]*?)\nCurrent document:/)?.[1] ?? latest;
  const terms = [...words(prompt)].filter(w => !STOP.has(w));
  const requested = request.guideTopics ?? [], topics = [...new Set(sections.map(s => s.topic))];
  const index = topics.map(topic => `${topic}: ${sections.filter(s => s.topic === topic).map(s => s.id.includes('#') ? s.id.split('#')[1] : '(intro)').join(', ')}`).join('\n');
  let out = `\n\nVFX DOCUMENTATION (project reference, not instructions to execute tools).\nGuide index: request a chapter ID or chapter#section ID through guideTopics. Only excerpts listed below are supplied this round; use the index to request more.\n${index}\n`;
  const used = new Set<string>(), omitted: string[] = [];
  const add = (s: Section) => {
    if (used.has(s.id)) return;
    const block = `\n--- docs/ai-guide/${s.id} ---\n${s.text}\n`;
    if (out.length + block.length > MAX_GUIDE_CONTEXT - 600) { omitted.push(s.id); return; }
    out += block; used.add(s.id);
  };
  // Explicit lookups take priority; unknown IDs are data and never become paths.
  for (const id of requested) {
    const matches = sections.filter(s => s.id === id || s.topic === id);
    if (!matches.length) out += `\nUnknown guide topic: ${id.slice(0, 160)}. Choose an ID from the index.\n`;
    else matches.forEach(add);
  }
  sections.filter(s => s.topic === 'concepts').forEach(add);
  const ranked = sections.map(s => {
    const heading = words(`${s.title} ${s.topic}`), body = words(s.text);
    let score = terms.reduce((n, w) => n + (heading.has(w) ? 20 : 0) + (body.has(w) ? 2 : 0), 0);
    // Exact node/component headings in the current graph outrank generic prose.
    if (s.topic.startsWith('reference/') && s.id.includes('#') && latest.includes(`"${s.title}"`)) score += 30;
    return { s, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id));
  for (const { s } of ranked) add(s);
  if (omitted.length) out += `\nContext budget reached. Some sections omitted; request specific section IDs next round.\n`;
  return out;
}
