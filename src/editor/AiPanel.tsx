import { useEffect, useRef, useState } from 'react';
import type { EffectDocumentV2 } from '../model/types.ts';
import type { Patch } from './history.ts';
import type { AiConnection, AiRequest, AiReply } from '../ai/types.ts';
import { AI_EDIT_FIELDS, runAiSession, type AiSessionResult } from '../ai/session.ts';
import { renderAiFrames } from '../ai/render.ts';

type Props = { document: EffectDocumentV2; onEdit: (label: string, patches: Patch[]) => void };
const roots = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta', custom: 'http://127.0.0.1:11434/v1' };
/** Private / self-hosted models that speak the OpenAI chat-completions format (base URL + example model ID). */
const PRIVATE_PRESETS: { label: string; url: string; model: string; vision: boolean; note: string }[] = [
  { label: 'Ollama (this PC)', url: 'http://127.0.0.1:11434/v1', model: 'qwen3:14b', vision: false, note: 'ollama pull qwen3:14b. Raise the context: OLLAMA_CONTEXT_LENGTH=32768 (the default 4096 cuts the graph and docs off).' },
  { label: 'LM Studio (this PC)', url: 'http://127.0.0.1:1234/v1', model: 'qwen/qwen3-14b', vision: false, note: 'Start the server in LM Studio (Developer tab) and load the model with a context length of 32k or more.' },
  { label: 'vLLM / llama.cpp server', url: 'http://127.0.0.1:8000/v1', model: 'Qwen/Qwen3-14B', vision: false, note: 'Use the model name your server was started with; context 32k or more.' },
  { label: 'Qwen (Alibaba Model Studio)', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', vision: false, note: 'API key from Alibaba Cloud Model Studio. qwen-vl-max accepts images.' },
  { label: 'GLM (Zhipu / Z.ai)', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.5', vision: false, note: 'API key from open.bigmodel.cn (international: https://api.z.ai/api/paas/v4). glm-4.5v accepts images.' },
  { label: 'OpenRouter (many models)', url: 'https://openrouter.ai/api/v1', model: 'qwen/qwen3-235b-a22b', vision: false, note: 'One key for Qwen, GLM, DeepSeek, Llama and more.' },
];
const SETTINGS_KEY = 'vfx-ai-connection';
type Saved = { provider?: 'openai' | 'anthropic' | 'gemini' | 'custom'; baseUrl?: string; model?: string; vision?: boolean; companion?: string; maxRounds?: number };
function loadSaved(): Saved { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Saved; } catch { return {}; } }

export default function AiPanel({ document: doc, onEdit }: Props) {
  // Non-secret connection settings are remembered in this browser; API keys and the pairing token never are.
  const saved = useRef(loadSaved()).current;
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'gemini' | 'custom'>(saved.provider ?? 'openai');
  const [baseUrl, setBaseUrl] = useState<string>(saved.baseUrl ?? roots.openai), [model, setModel] = useState(saved.model ?? ''), [apiKey, setApiKey] = useState('');
  const [vision, setVision] = useState(saved.vision ?? true), [companion, setCompanion] = useState(saved.companion ?? 'http://127.0.0.1:5181'), [token, setToken] = useState('');
  const [prompt, setPrompt] = useState(''), [maxRounds, setMaxRounds] = useState(saved.maxRounds ?? 4), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [presetNote, setPresetNote] = useState('');
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ provider, baseUrl, model, vision, companion, maxRounds } satisfies Saved)); } catch { /* private mode */ }
  }, [provider, baseUrl, model, vision, companion, maxRounds]);
  const [result, setResult] = useState<AiSessionResult | null>(null), [base, setBase] = useState('');
  const abort = useRef<AbortController | null>(null), currentDoc = useRef(doc); currentDoc.current = doc;
  useEffect(() => () => abort.current?.abort(), []);
  const stale = !!result && base !== JSON.stringify(doc);
  const connection: AiConnection = { provider: provider === 'custom' ? 'openai' : provider, baseUrl, model: model.trim(), apiKey: apiKey || undefined, vision };
  const root = () => {
    const url = new URL(companion);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter a complete companion URL without credentials or query parameters.');
    if (!token.trim()) throw new Error('Enter the companion pairing token.');
    return companion.replace(/\/+$/, '');
  };
  const request = async (input: AiRequest, signal?: AbortSignal): Promise<AiReply> => {
    const r = await fetch(`${root()}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` }, body: JSON.stringify(input), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(70_000)]) : AbortSignal.timeout(70_000) });
    const body = await r.json(); if (!r.ok) throw new Error(body.error || `Companion returned HTTP ${r.status}.`); return body;
  };
  const start = async (test: boolean) => {
    const controller = new AbortController(); abort.current = controller; setBusy(true); setStatus(test ? 'Testing the model…' : 'Starting a draft…');
    try {
      if (test) {
        const r = await request({ connection: { ...connection, vision: false }, system: 'You are testing an AI model connection. Respond briefly.', messages: [{ role: 'user', text: 'Reply with: Connection ready.' }], maxTokens: 128 }, controller.signal);
        if (!controller.signal.aborted) setStatus(`Model replied: ${r.text.slice(0, 500)}`);
      } else {
        setResult(null); const snapshot = structuredClone(currentDoc.current); setBase(JSON.stringify(snapshot));
        const r = await runAiSession({ document: snapshot, prompt, connection, maxRounds, signal: controller.signal, request, render: renderAiFrames, onProgress: setStatus });
        if (!controller.signal.aborted) { setResult(r); setStatus(`Draft ready after ${r.rounds} rounds. ${r.visuallyReviewed ? 'The model received and reviewed the latest frames.' : 'Final visual review was not completed.'}`); }
      }
    } catch (e) {
      if (controller.signal.aborted) setStatus('Cancelled. Your effect was not changed.');
      else setStatus(e instanceof Error && e.name !== 'TypeError' ? e.message : 'Cannot reach the AI companion. Start it, then check the URL, pairing token and allowed site.');
    } finally { if (abort.current === controller) { setBusy(false); abort.current = null; } }
  };
  const apply = () => {
    if (!result) return;
    if (base !== JSON.stringify(currentDoc.current)) { setStatus('Your effect changed during this run. Discard the draft and run again against the current effect.'); return; }
    const patches: Patch[] = AI_EDIT_FIELDS.filter(k => JSON.stringify(doc[k]) !== JSON.stringify(result.document[k])).map(k => ({ op: 'set', path: [k], value: result.document[k] }));
    if (patches.length) onEdit('Apply AI draft', patches);
    setResult(null); setStatus(patches.length ? 'Applied as one edit. Undo restores your previous effect.' : 'The draft contains no changes.');
  };
  return <div className="ai-panel">
    <p>Describe a change. The AI edits a draft and checks rendered frames before you apply it.</p>
    <details open><summary>AI connection</summary>
      <fieldset disabled={busy}>
        <label>Provider<select aria-label="AI provider" value={provider} onChange={e => { const p = e.target.value as typeof provider; setProvider(p); setBaseUrl(roots[p]); setModel(''); setApiKey(''); setVision(p !== 'custom'); }}>
          <option value="openai">GPT / OpenAI API</option><option value="anthropic">Claude API</option><option value="gemini">Gemini API</option><option value="custom">Private / custom model</option>
        </select></label>
        {provider === 'custom' && <label>Quick setup<select aria-label="Private model preset" value="" onChange={e => {
          const p = PRIVATE_PRESETS[Number(e.target.value)]; if (!p) return;
          setBaseUrl(p.url); setModel(p.model); setVision(p.vision); setPresetNote(p.note);
        }}><option value="">Choose a server or service…</option>{PRIVATE_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}</select></label>}
        {provider === 'custom' && presetNote && <p>{presetNote}</p>}
        <label>API base URL<input aria-label="AI API base URL" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} spellCheck={false} /></label>
        <label>Model ID<input aria-label="AI model ID" value={model} placeholder="Your server's model name" onChange={e => setModel(e.target.value)} spellCheck={false} /></label>
        <label>API key{provider === 'custom' ? ' (optional)' : ''}<input type="password" aria-label="AI API key" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} /></label>
        <label className="ai-check"><input type="checkbox" checked={vision} onChange={e => setVision(e.target.checked)} />Model accepts images</label>
        {provider === 'custom' && <p>Any OpenAI-compatible server works (Qwen, GLM, DeepSeek, Llama…). The model needs a large context window (32k tokens or more): each request carries the effect graph and the relevant documentation. Reasoning models are fine; their thinking is ignored. Keep "accepts images" off for text-only models.</p>}
        {!vision && <p>Text-only mode edits and validates the graph. It renders thumbnails for you, but the model cannot inspect them.</p>}
        <label>Companion URL<input aria-label="AI companion URL" value={companion} onChange={e => setCompanion(e.target.value)} spellCheck={false} /></label>
        <label>Pairing token<input type="password" aria-label="AI pairing token" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>
        <button type="button" disabled={!model.trim() || !token.trim()} onClick={() => void start(true)}>Test model connection</button>
      </fieldset>
      <p>Start the local companion with <code>pnpm ai:server</code>, then copy its pairing token here. Keys and tokens stay in memory and are not saved with your effect. Requests and, when enabled, preview images go to your chosen model endpoint.</p>
      <p>These are API connections. Chat-subscription sign-in is not included in this version.</p>
    </details>
    <label>Your request<textarea aria-label="AI request" value={prompt} maxLength={8000} rows={4} disabled={busy} onChange={e => setPrompt(e.target.value)} placeholder="Make the sparks spread wider and fade more slowly…" /></label>
    <label>Maximum rounds<select aria-label="AI maximum rounds" value={maxRounds} disabled={busy} onChange={e => setMaxRounds(Number(e.target.value))}>{[2, 3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}</select></label>
    <div className="ai-actions"><button type="button" disabled={busy || !prompt.trim() || !model.trim() || !token.trim()} onClick={() => void start(false)}>Create draft</button>
      {busy && <button type="button" onClick={() => abort.current?.abort()}>Cancel AI run</button>}</div>
    <p role="status" aria-live="polite">{status}</p>
    {result && <section aria-label="AI draft"><p style={{ whiteSpace: 'pre-wrap' }}>{result.summary}</p>
      <p>{result.visuallyReviewed ? 'Model reviewed the latest rendered frames. Review them yourself before applying.' : 'Visual review incomplete. Inspect the draft frames before applying.'}</p>
      <div className="ai-frames">{result.frames.map((f, i) => <figure key={i}><img src={f.image} alt={`AI draft at tick ${f.tick}`} /><figcaption>Tick {f.tick}</figcaption></figure>)}</div>
      {stale && <p role="alert">Your effect changed. Run again to make a new draft.</p>}
      <div className="ai-actions"><button type="button" disabled={busy || stale} onClick={apply}>Apply draft</button><button type="button" disabled={busy} onClick={() => { setResult(null); setStatus('Draft discarded.'); }}>Discard draft</button></div>
    </section>}
    <style>{`.ai-panel{display:flex;flex-direction:column;gap:10px;font-size:13px}.ai-panel p{margin:4px 0;color:#aab5c8;overflow-wrap:anywhere}.ai-panel fieldset{border:0;padding:0;display:flex;flex-direction:column;gap:8px;min-width:0}.ai-panel label{display:flex;flex-direction:column;gap:4px}.ai-panel input:not([type=checkbox]),.ai-panel select,.ai-panel textarea{box-sizing:border-box;width:100%;min-width:0;background:#171c26;color:#e4eaf4;border:1px solid #3a4558;border-radius:4px;padding:7px;font:inherit}.ai-panel .ai-check{flex-direction:row;align-items:center}.ai-panel summary{cursor:pointer;margin-bottom:8px}.ai-actions{display:flex;gap:6px;flex-wrap:wrap}.ai-frames{display:flex;flex-direction:column;gap:8px}.ai-frames figure{margin:0}.ai-frames img{max-width:100%;height:auto;display:block;border-radius:4px}.ai-frames figcaption{font-size:11px;color:#aab5c8}`}</style>
  </div>;
}
