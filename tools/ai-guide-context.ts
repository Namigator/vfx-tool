// Companion side of the AI documentation context: reads docs/ai-guide from disk; selection lives in src/ai/guideContext.ts
// (shared with the web page's direct mode).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAiGuide, aiGuideContext, MAX_GUIDE_CONTEXT, type GuideSection } from '../src/ai/guideContext.ts';

export { aiGuideContext, MAX_GUIDE_CONTEXT };

/** Only project-owned guide Markdown; no caller-controlled file paths or network reads. */
export function loadAiGuide(directory = fileURLToPath(new URL('../docs/ai-guide/', import.meta.url))): GuideSection[] {
  const files: { path: string; text: string }[] = [];
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.isSymbolicLink()) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { visit(path); continue; }
      if (entry.isFile() && entry.name.endsWith('.md')) files.push({ path, text: readFileSync(join(directory, path), 'utf8') });
    }
  };
  visit('');
  return parseAiGuide(files);
}
