// Second pass of tools/build-components.mjs (10 "duration must include its tail"): inserts each generated
// component into a blank document, measures when its content really ends (graph/truncation.ts) and writes
// that length back into the template, so inserting a component never cuts its tail.
// Run by build-components.mjs; standalone: node --experimental-strip-types tools/fit-component-durations.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { COMPONENT_TEMPLATES, insertComponent } from '../src/graph/components.ts';
import { createBlankDocument } from '../src/graph/fixtures.ts';
import { effectEndTick } from '../src/graph/truncation.ts';
import { MAX_DURATION_TICKS } from '../src/model/types.ts';

const file = 'src/graph/components.generated.ts';
let text = readFileSync(file, 'utf8');
let changed = 0;
for (const c of COMPONENT_TEMPLATES) {
  const { doc } = insertComponent(createBlankDocument(), c.id, undefined, { group: true });
  const end = effectEndTick(doc);
  if (end === undefined) throw new Error(`${c.id}: could not measure its end (does it compile?)`);
  const want = Math.min(MAX_DURATION_TICKS, Math.max(c.durationTicks, end));
  if (want === c.durationTicks) continue;
  const at = text.indexOf(`"id": "${c.id}",`);
  const key = text.indexOf('"durationTicks": ', at);
  const stop = text.indexOf(',', key);
  text = `${text.slice(0, key)}"durationTicks": ${want}${text.slice(stop)}`;
  changed++;
  console.log(`${c.id}: ${c.durationTicks} → ${want} ticks`);
}
writeFileSync(file, text);
console.log(`fitted ${changed} component duration(s)`);
