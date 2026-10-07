// Feedback tickets, shared by the editor's Feedback dialog and the MCP tool vfx_submit_feedback. Delivery goes
// through Web3Forms (https://web3forms.com), which forwards each ticket to the owner's inbox; the code only holds
// a public access key, never the owner's address. Set FEEDBACK_ACCESS_KEY to enable sending.

/** Web3Forms access key (public by design: it can only deliver mail to the address it was created for). */
export const FEEDBACK_ACCESS_KEY = 'dab7c08d-2ffe-4117-b117-69932e3e8d39';
export const FEEDBACK_KINDS = ['Suggestion', 'Bug', 'Question', 'Other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
const ENDPOINT = 'https://api.web3forms.com/submit';
/** The public editor; a "#feedback=..." link opens its Feedback form pre-filled. */
export const SITE_URL = 'https://demo.xpo.dev/avi/vfx-tool/index.html';

/** Link that opens the editor's Feedback form pre-filled (hash, so the text never reaches a server log). */
export function feedbackLink(kind: FeedbackKind, message: string, base = SITE_URL): string {
  return `${base}#feedback=${encodeURIComponent(kind)}&message=${encodeURIComponent(message.slice(0, 1500))}`;
}

/** Reads a feedbackLink() hash; null when the hash is not one. */
export function parseFeedbackHash(hash: string): { kind: FeedbackKind; message: string } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const kind = p.get('feedback');
  if (kind === null) return null;
  return { kind: (FEEDBACK_KINDS as readonly string[]).includes(kind) ? kind as FeedbackKind : 'Suggestion', message: p.get('message') ?? '' };
}

export type FeedbackTicket = {
  kind: FeedbackKind;
  message: string;
  /** Optional address the sender wants a reply at. */
  replyTo?: string;
  /** Where the ticket came from, e.g. the page URL or "MCP". */
  source: string;
  /** Honeypot value; true drops the ticket at Web3Forms. */
  botcheck?: boolean;
};

export async function sendFeedback(t: FeedbackTicket, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!FEEDBACK_ACCESS_KEY) throw new Error('Feedback is not set up on this build yet');
  const message = t.message.trim();
  if (message.length < 3) throw new Error('The message is empty');
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      access_key: FEEDBACK_ACCESS_KEY,
      subject: `VFX Studio ticket: ${t.kind}`,
      from_name: 'VFX Studio feedback',
      kind: t.kind,
      message: message.slice(0, 5000),
      ...(t.replyTo?.trim() ? { email: t.replyTo.trim() } : {}),
      source: t.source,
      ...(typeof navigator !== 'undefined' ? { browser: navigator.userAgent } : {}),
      botcheck: !!t.botcheck,
    }),
  });
  const json = await res.json().catch(() => ({})) as { success?: boolean; message?: string };
  if (!res.ok || !json.success) throw new Error(json.message || `Server answered ${res.status}`);
}
