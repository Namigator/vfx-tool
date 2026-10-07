// "Send feedback" form: users submit a suggestion / bug / question as a ticket (see src/feedback.ts for delivery).
import { useState } from 'react';
import { FEEDBACK_ACCESS_KEY, FEEDBACK_KINDS, sendFeedback, type FeedbackKind } from '../feedback.ts';

export function FeedbackDialog({ onClose, initial }: { onClose: () => void; initial?: { kind: FeedbackKind; message: string } }) {
  const [kind, setKind] = useState<FeedbackKind>(initial?.kind ?? 'Suggestion');
  const [message, setMessage] = useState(initial?.message ?? '');
  const [replyTo, setReplyTo] = useState('');
  const [botcheck, setBotcheck] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  const send = async () => {
    setState('sending');
    setError('');
    try {
      await sendFeedback({ kind, message, replyTo, source: location.href, botcheck });
      setState('sent');
    } catch (e) {
      setError(`Could not send: ${e instanceof Error ? e.message : String(e)}. Please try again later.`);
      setState('idle');
    }
  };

  if (state === 'sent') {
    return (
      <div className="pv2-banner pv2-feedback" role="dialog" aria-label="Send feedback">
        <strong>Thanks, your ticket was sent.</strong>
        <div><button type="button" onClick={onClose}>Close</button></div>
      </div>
    );
  }

  const busy = state === 'sending';
  return (
    <div className="pv2-banner pv2-feedback" role="dialog" aria-label="Send feedback">
      <strong>Send feedback</strong>
      <span className="pv2-note">Suggestions, bugs, questions: it goes straight to the developer.</span>
      {!FEEDBACK_ACCESS_KEY && <p className="pv2-error" role="alert">Feedback is not set up on this build yet.</p>}
      <label>Type <select value={kind} disabled={busy} onChange={e => setKind(e.currentTarget.value as FeedbackKind)}>{FEEDBACK_KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
      <textarea value={message} disabled={busy} rows={6} maxLength={5000} placeholder="What would you like to tell us?" onChange={e => setMessage(e.currentTarget.value)} />
      <label>Your email (optional, only if you want a reply) <input type="email" value={replyTo} disabled={busy} onChange={e => setReplyTo(e.currentTarget.value)} /></label>
      {/* Honeypot: hidden from people, bots tick it and Web3Forms drops the ticket. */}
      <input type="checkbox" tabIndex={-1} aria-hidden="true" style={{ display: 'none' }} checked={botcheck} onChange={e => setBotcheck(e.currentTarget.checked)} />
      {error && <p className="pv2-error" role="alert">{error}</p>}
      <div>
        <button type="button" disabled={busy || !FEEDBACK_ACCESS_KEY || message.trim().length < 3} onClick={() => void send()}>{busy ? 'Sending…' : 'Send'}</button>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
