# AI panel and private model connections

Open the inspector's **AI** tab. This panel edits a draft of the active effect, renders it at representative ticks, and asks an image-capable model to inspect the new frames before offering Apply. The original effect stays unchanged until Apply; applying is one undoable edit. If the active effect changes during a run, the draft cannot overwrite it.

## Connect: directly from the page (default) or through the companion

**Directly from the page** is the default and needs nothing installed: pick GPT / OpenAI, Gemini or Claude, paste your
own API key (links next to the key box: platform.openai.com/api-keys, aistudio.google.com/apikey,
console.anthropic.com/settings/keys) and run. The page sends requests straight to the provider, which bills your key;
the documentation is loaded into the page the first time a draft needs it. This works on the published site, on phones
and for anyone using it. OpenAI, Gemini and Claude accept these browser requests (checked 2026-10-01); a self-hosted
OpenAI-compatible server works too if it allows browser requests from the site (Open WebUI does by default for its own
CORS list). A ChatGPT / Gemini / Claude chat subscription is not an API key and cannot be used.

**Through the companion** (tick *Connect through the helper on this PC*) is for models on your own computer (Ollama,
LM Studio, vLLM on 127.0.0.1) or servers that refuse browser requests:

## Start the companion

From the project folder run `pnpm ai:server` (or `node --experimental-strip-types tools/ai-server.ts`). The server binds only to 127.0.0.1:5181 and prints its pairing token. The token is generated once and kept in `~/.vfx-studio/ai-companion-token`, so it stays the same across restarts (delete that file, or set `VFX_AI_TOKEN`, to change it). Copy its URL and token into the AI connection settings. Keep the process running while using the panel. No API keys are written to disk or logged by the companion.

The default allowed browser origins are http://127.0.0.1:5174, :5176, :5177, http://localhost:5174 and the published site https://demo.xpo.dev. For a deployed website, set `VFX_AI_ORIGINS` to its exact origin before launching. It accepts a comma-separated list. Use `VFX_AI_PORT` to change the port; `VFX_AI_TOKEN` can set a pairing token of at least 16 characters. These values configure the local companion, not the model. Browser restrictions on public sites accessing local HTTP services may require browser permission or a trusted HTTPS companion; do not bypass certificate warnings. A static deployed build does not start the Node companion automatically.

## Choose a provider

| Connection | API root | Key |
| --- | --- | --- |
| GPT / OpenAI API | https://api.openai.com/v1 | OpenAI API key |
| Claude API | https://api.anthropic.com/v1 | Claude Console API key |
| Gemini API | https://generativelanguage.googleapis.com/v1beta | Gemini API key (https://aistudio.google.com/apikey) |
| Private / custom model | Your OpenAI-compatible API root, e.g. http://127.0.0.1:11434/v1 | Optional, depending on your server |

Enter the exact model ID available on your account/server. Base URLs are API roots: do not append /chat/completions, /messages or :generateContent. Path prefixes are preserved. This supports private/self-hosted servers, including OpenAI-compatible configurations of Ollama, LM Studio and vLLM; it does not install or start them. The companion connects to the chosen endpoint using Node fetch, so a model server does not need browser CORS support. Custom endpoints must accept Chat Completions JSON and return choices[0].message.content. Streaming and provider function/tool APIs are not required; the model returns structured edit JSON.

### Gemini (tested setup)

Verified working on 2026-10-01 from the published site: **Provider** Gemini API, **Model ID** `gemini-3-flash-preview`,
**Model accepts images** on (Gemini sees the preview frames). The panel fills this model ID when you pick Gemini.
`gemini-2.5-flash` answers HTTP 404 (retired); if a model ID stops working, the error shows Google's reason and the
AI Studio model list (https://aistudio.google.com) shows the names your key can use.

### Private models (Qwen, GLM, DeepSeek, Llama…)

Choose **Private / custom model**, then **Quick setup** fills the address and an example model ID:

| Quick setup | API root | Notes |
| --- | --- | --- |
| Ollama (this PC) | http://127.0.0.1:11434/v1 | `ollama pull qwen3:14b`; start Ollama with `OLLAMA_CONTEXT_LENGTH=32768` |
| LM Studio (this PC) | http://127.0.0.1:1234/v1 | start the server, load the model with 32k+ context |
| vLLM / llama.cpp server | http://127.0.0.1:8000/v1 | model name as started; 32k+ context |
| Qwen (Alibaba Model Studio) | https://dashscope-intl.aliyuncs.com/compatible-mode/v1 | `qwen-plus`; `qwen-vl-max` sees images |
| GLM (Zhipu / Z.ai) | https://open.bigmodel.cn/api/paas/v4 (intl: https://api.z.ai/api/paas/v4) | `glm-4.5`; `glm-4.5v` sees images |
| OpenRouter | https://openrouter.ai/api/v1 | one key for Qwen, GLM, DeepSeek, Llama… |

**Context size matters.** Each request carries the effect graph, the node catalogue and up to 48,000 characters of
documentation: give the model a context window of 32k tokens or more. Ollama's default (4,096) silently cuts the
request off and the model then answers nonsense. **Reasoning models** (Qwen3, GLM-4.5, DeepSeek-R1) are fine: their
`<think>` text, Markdown fences and surrounding prose are stripped and the JSON object is extracted. Local models are
given 5 minutes per call.

**Open WebUI servers** (for example a team server at chat.server.xpo): API root `https://<server>/api` (https, not
http: plain http redirects to https and the companion refuses redirects); the key comes from Open WebUI → profile →
Settings → Account → **API keys**. That section only exists when an admin has turned on **Admin Panel → Settings →
General → Enable API Key** (newer versions also need the API Keys permission for your user group). Model ID = the name
in Open WebUI's model picker. Servers with an internal HTTPS certificate work because `pnpm ai:server` trusts the
Windows certificate store (`--use-system-ca`).

Only enable **Model accepts images** for a model/server that supports image inputs. Text-only models still edit and compile the graph and produce rendered thumbnails for you, but cannot inspect screenshots or establish visual acceptance. The Test model connection button sends a small inference request and may use provider quota. A successful test establishes text connectivity, not image support or effect quality.

The API key (one per provider) and the pairing token are remembered in this browser while **Remember API keys and pairing token in this browser** is ticked (the default); unticking it deletes them. They are stored in the browser's local storage, which other pages of the same site origin can read: untick it on shared computers or on a site that hosts other people's apps. The other connection settings (provider, API root, model ID, image input, companion URL, rounds) are always remembered in this browser. None of this is ever included in effect JSON, packs or history. Requests send the effect graph and user prompt to the configured endpoint; image-enabled requests also send PNG preview frames. Use your private endpoint to keep inference on your own server. API billing and model terms are those of your configured provider.

## Documentation access

Draft requests automatically receive documentation from `docs/ai-guide/` through the local companion. It supplies core concepts, an index of all published chapters/recipes/references, and relevant sections selected from your request, current graph and repair diagnostics. This includes schedules, anchors, keyframes, component recipes, node parameters and limits. Internal acceptance reports and gap notes (files beginning with `_`) are excluded.

The model can request more by returning `guideTopics: ["reference/nodes#schedule", "recipes/smoke"]` in its edit JSON. Requested sections arrive on the next round, within the same 2–6 call limit. Documentation context is capped at 48,000 characters per call; large chapters can require specific section IDs. MCP examples are reference material, not additional tool permissions. Test model connection does not attach the guide. All providers and private models receive the same documentation context.

The companion reads the guide files when it starts; restart it after changing the documentation. No separate index generation or external search service is needed. Documentation is sent to your chosen model endpoint along with the draft context.

## Run and review

1. Enter a request, such as “Add smoke at the target” or “Make these sparks spread wider”.
2. Choose a maximum of 2–6 rounds and Create draft. The model can adjust published controls, edit graph parameters/connections, and insert built-in components. Compilation errors are returned for repair.
3. Cancel stops the run and leaves the active effect unchanged. Switching inspector tabs preserves the connection and the ongoing run; closing the editor cancels it.
4. Review the summary and rendered thumbnails. “Model reviewed” means images were supplied for a post-edit response; it is not a human quality approval.
5. Apply draft or Discard draft. Undo restores the pre-Apply effect. A round-limited result can be applied, but clearly reports that the model did not complete its final review.

## Troubleshooting the connection

| Message | Cause and fix |
| --- | --- |
| Buttons stay greyed out | Fill in **Model ID** and **Pairing token** (the token printed by `pnpm ai:server`; it changes every start). |
| Cannot reach the AI companion | The companion is not running (keep the `pnpm ai:server` window open), the URL/token does not match what it printed, or, on the published site, Chrome blocked access to this computer: answer **Allow** to its prompt, or icon left of the address → Site settings → allow access to apps on this device (local network). |
| The companion URL is the helper running on this computer… | A model-server address was typed in **Companion URL**. It belongs in **API base URL**; Companion URL stays `http://127.0.0.1:5181`. |
| Cannot reach the model endpoint over plain http | Use `https://` (Open WebUI: `https://<server>/api`). |
| Model returned HTTP 400 (Gemini) | The API key is not valid. |
| Model returned HTTP 401 | Missing or wrong API key. |
| Model returned HTTP 404 | Unknown model ID (or wrong API root); the message includes the server's reason. |

## Current limits and follow-ups

API-key and private-model connections are implemented. ChatGPT/Codex subscription sign-in, Gemini CLI account connections, and externally hosted companion deployment are separate follow-ups. The panel does not extract subscription tokens or offer a nonfunctional sign-in button. Credentials and real hosted model quality have not been exercised without user-provided keys.

Runs use at most six model calls, up to three 384×216 PNGs per round and an 8,192 output-token cap. Each provider call has a 5-minute timeout. The companion rejects unknown browser origins, unpaired calls, redirects, non-HTTP(S) API roots and oversized messages. Model edits cannot manipulate credentials, execute commands, fetch arbitrary URLs, import assets, alter document identity/version, or edit editor settings. Large graph requests may exceed a model's context budget; choose a suitable model or simplify the effect.

Local test harness: `node --experimental-strip-types tools/ai-mock.ts` starts a fake OpenAI-compatible model on 5182 and paired companion on 5181, allowed only from 5177. Use private model ID `test`, API root `http://127.0.0.1:5182/v1`, token `vfx-local-test-token`. It inserts a Smoke plume and returns a review reply. This is a mock for workflow testing, not evidence of real model reasoning.
