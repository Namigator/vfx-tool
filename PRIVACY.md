# Privacy

DRAFT (P-02): written from the code on 2026-11-01. The owner still has to confirm the hosting part.

VFX Studio runs in your browser. It has no accounts, sign-in, analytics or advertising, and it sets no cookies. What
you build stays on your device unless you send it somewhere yourself.

## What is stored, and where

Everything below lives in your browser's own storage for this site. Clearing the site's data removes all of it.

| What | Where | Why |
|---|---|---|
| The open effect (an autosaved draft) and your saved projects | localStorage | so a reload keeps your work |
| Images, meshes and sounds you import | IndexedDB | an effect can reference them later |
| Your own components | localStorage | so they appear in the Library |
| Panel sizes and layout | localStorage | so the editor looks the way you left it |
| AI assistant settings (provider, model, address) | localStorage | only if you open the AI panel |
| AI API key or token | localStorage, **only if you tick "remember"** | otherwise it is kept in memory and forgotten when you close the tab |

Exports (packs, images, video, engine packages) are files your browser downloads. They are not uploaded anywhere.

## What leaves your device

Only these two actions send data, and only when you use them:

- **AI assistant.** When you send a message, the editor calls the AI provider you chose (for example OpenAI,
  Anthropic, Google or OpenRouter, or your own local server) with your key. The request contains your message and a
  description of the open effect, plus images of the preview if you turn on vision. That provider's own privacy
  policy applies. The editor never sends your key to anyone else.
- **Feedback form.** Sending feedback posts the message you typed (and a reply address, if you give one) through
  Web3Forms, which emails it to the developer. Nothing is sent until you press Send.

## Hosting

The site is a set of static files. OWNER TO CONFIRM: whether the host (demo.xpo.dev) keeps standard web server logs
(IP address, time, page requested), and for how long.

## Contact

OWNER TO FILL IN: a support address or issue tracker. Until then, use the in-editor **Feedback** form.
