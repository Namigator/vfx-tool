// Direct mode: the web page calls the model provider itself (OpenAI, Gemini and Claude all allow browser requests with
// the user's own key), so the public site works without the local companion. The documentation the companion would
// attach is bundled as a lazy chunk and loaded the first time a draft needs it.
import { requestAi, validateAiRequest } from './provider.ts';
import { aiGuideContext, parseAiGuide, type GuideSection } from './guideContext.ts';
import type { AiReply, AiRequest } from './types.ts';

let guide: Promise<GuideSection[]> | null = null;

/** docs/ai-guide as sections (internal "_" files excluded by parseAiGuide); fetched once per page. */
export function loadBrowserGuide(): Promise<GuideSection[]> {
  guide ??= (async () => {
    const modules = import.meta.glob('../../docs/ai-guide/**/*.md', { query: '?raw', import: 'default' });
    const files = await Promise.all(Object.entries(modules).map(async ([path, load]) => ({ path: path.replace(/^.*docs\/ai-guide\//, ''), text: String(await load()) })));
    return parseAiGuide(files);
  })();
  guide.catch(() => { guide = null; }); // a failed download is retried next time
  return guide;
}

export async function requestAiDirect(input: AiRequest, signal?: AbortSignal): Promise<AiReply> {
  validateAiRequest(input);
  // Same rule as the companion: draft requests (guideTopics present, possibly empty) get the documentation.
  if (input.guideTopics !== undefined) {
    input = { ...input, system: input.system + aiGuideContext(await loadBrowserGuide(), input) };
    validateAiRequest(input);
  }
  return requestAi(input, { signal, browser: true });
}
