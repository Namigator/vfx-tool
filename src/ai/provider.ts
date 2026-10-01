import type { AiRequest, AiReply } from './types.ts';

/** Local models on consumer GPUs can take minutes for a large prompt (graph + documentation); give them time. */
export const MODEL_TIMEOUT_MS = 300_000;

export function validateAiRequest(input: unknown): asserts input is AiRequest {
  const r = input as AiRequest;
  if (!r || !r.connection || !['openai', 'anthropic', 'gemini'].includes(r.connection.provider)) throw new Error('Choose a supported provider.');
  const c = r.connection;
  if (typeof c.model !== 'string' || !c.model.trim() || c.model.length > 200 || /[\r\n]/.test(c.model)) throw new Error('Enter a model ID.');
  if (typeof c.vision !== 'boolean' || (c.apiKey !== undefined && (typeof c.apiKey !== 'string' || c.apiKey.length > 4096 || /[\r\n]/.test(c.apiKey)))) throw new Error('Invalid connection settings.');
  let url: URL;
  try { url = new URL(c.baseUrl); } catch { throw new Error('Enter a complete API base URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) API root without credentials, query or fragment.');
  if (typeof r.system !== 'string' || r.system.length > 300_000 || !Array.isArray(r.messages) || !r.messages.length || r.messages.length > 20) throw new Error('Invalid AI conversation.');
  if (r.guideTopics !== undefined && (!Array.isArray(r.guideTopics) || r.guideTopics.length > 6 || r.guideTopics.some(t => typeof t !== 'string' || t.length > 160))) throw new Error('Request at most six guide topics.');
  if (!Number.isInteger(r.maxTokens) || r.maxTokens < 128 || r.maxTokens > 8192) throw new Error('Output token limit must be 128–8192.');
  for (const m of r.messages) {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.text !== 'string' || m.text.length > 1_000_000) throw new Error('Invalid AI message.');
    if (m.images !== undefined && (!Array.isArray(m.images) || m.images.length > 3 || m.images.some(i => typeof i !== 'string' || i.length > 1_500_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(i)))) throw new Error('Only bounded inline PNG frames are supported.');
    if (m.images?.length && !c.vision) throw new Error('This connection has image input disabled.');
  }
}

export async function requestAi(request: AiRequest, options: { signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<AiReply> {
  validateAiRequest(request);
  const { connection: c, messages, system, maxTokens } = request;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let path: string, body: unknown;
  const root = c.baseUrl.replace(/\/+$/, '');
  if (c.provider === 'openai') {
    path = '/chat/completions';
    if (c.apiKey) headers.Authorization = `Bearer ${c.apiKey}`;
    const tokenLimit = new URL(root).hostname === 'api.openai.com' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
    body = { model: c.model, ...tokenLimit, messages: [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.images?.length ? [{ type: 'text', text: m.text }, ...m.images.map(url => ({ type: 'image_url', image_url: { url } }))] : m.text }))] };
  } else if (c.provider === 'anthropic') {
    path = '/messages';
    if (!c.apiKey) throw new Error('Claude API connections require an API key.');
    headers['x-api-key'] = c.apiKey; headers['anthropic-version'] = '2023-06-01';
    body = { model: c.model, max_tokens: maxTokens, system, messages: messages.map(m => ({ role: m.role, content: [{ type: 'text', text: m.text }, ...(m.images ?? []).map(url => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: url.split(',')[1] } }))] })) };
  } else {
    path = `/models/${encodeURIComponent(c.model)}:generateContent`;
    if (!c.apiKey) throw new Error('Gemini API connections require an API key.');
    headers['x-goog-api-key'] = c.apiKey;
    body = { systemInstruction: { parts: [{ text: system }] }, contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }, ...(m.images ?? []).map(url => ({ inlineData: { mimeType: 'image/png', data: url.split(',')[1] } }))] })), generationConfig: { maxOutputTokens: maxTokens } };
  }
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]) : AbortSignal.timeout(MODEL_TIMEOUT_MS);
  if (signal.aborted) throw new Error('AI request cancelled.');
  let response: Response;
  try { response = await (options.fetch ?? fetch)(root + path, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' }); }
  catch { if (signal.aborted) throw new Error(options.signal?.aborted ? 'AI request cancelled.' : `Model request timed out after ${MODEL_TIMEOUT_MS / 1000} seconds.`); // A plain-http address of a server that redirects to https fails here (redirects are refused): say so.
    if (/^http:\/\//.test(root) && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(root + '/')) throw new Error(`Cannot reach the model endpoint over plain http (${root}). If the server uses https, change the API base URL to start with https:// (Open WebUI: https://<server>/api).`);
    throw new Error('Cannot reach the model endpoint. Check its URL, network and certificate.'); }
  if (!response.ok) {
    // Show the server's structured explanation (e.g. Gemini: "models/x is not found for API version v1beta") - only a
    // JSON error message, never a raw body, with the key and any long token-like strings blanked out.
    let detail = '';
    try { const j = JSON.parse(await response.text()); const m = j?.error?.message ?? (typeof j?.error === 'string' ? j.error : undefined) ?? j?.message ?? j?.detail; if (typeof m === 'string') detail = m; } catch { /* not JSON: show nothing */ }
    if (c.apiKey) detail = detail.split(c.apiKey).join('[key]');
    detail = detail.replace(/[A-Za-z0-9_\-.]{32,}/g, '[redacted]');
    detail = detail.replace(/\s+/g, ' ').trim().slice(0, 240);
    throw new Error(`Model returned HTTP ${response.status}${detail ? `: ${detail}` : ''}. Check credentials, model ID and server availability.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Model returned an empty response.');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4_000_000) throw new Error('Model response exceeds 4 MB.'); chunks.push(value); }
  } catch (e) { await reader.cancel().catch(() => {}); throw e; }
  const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  let data: any;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('Model did not return valid API JSON.'); }
  const text = c.provider === 'openai' ? data.choices?.[0]?.message?.content : c.provider === 'anthropic' ? data.content?.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('\n') : data.candidates?.[0]?.content?.parts?.map((x: any) => x.text ?? '').join('\n');
  if (typeof text !== 'string' || !text.trim()) throw new Error('Model returned no text. Select a model that supports chat output.');
  return { text };
}
