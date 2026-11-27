import { FormEvent, useState } from 'react';
import type { Target, Thread } from './api.js';
import { useCommentsState, useThreads } from './context.js';
import { ThreadCard } from './ThreadCard.js';

export interface CommentsPanelProps {
  target: Target;
  /** Heading above the threads. */
  title?: string;
  /** Placeholder for a comment on the target as a whole. */
  placeholder?: string;
}

/**
 * The threads on one target: the comment being started from a text selection, the open threads, a box for
 * a comment on the whole target, and the closed threads on request.
 */
export function CommentsPanel({ target, title = 'Comments', placeholder = 'Comment on this page' }: CommentsPanelProps) {
  const state = useCommentsState();
  const { key, threads, error } = useThreads(target);
  const [body, setBody] = useState('');
  const [general, setGeneral] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const draft = state.draft?.key === key ? state.draft : null;
  const located = state.located[key] ?? {};
  const open = (threads ?? []).filter(t => t.status === 'open');
  const closed = (threads ?? []).filter(t => t.status !== 'open');

  const changed = (id: string) => (thread: Thread | null) => {
    state.put(key, thread, id);
    state.bump();
  };

  const start = async (e: FormEvent, text: string, anchored: boolean) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      const thread = await state.client.start(target, text.trim(), anchored && draft ? draft.anchor : null);
      state.put(key, thread);
      state.bump();
      if (anchored) {
        state.setDraft(null);
        setBody('');
      } else setGeneral('');
      state.focus(thread.id);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'The comment was not saved');
    } finally {
      setBusy(false);
    }
  };

  const card = (t: Thread) => (
    <ThreadCard
      key={t.id}
      thread={t}
      client={state.client}
      me={state.me}
      onChange={changed(t.id)}
      focused={state.focused === t.id}
      onFocus={() => {
        state.focus(t.id);
        document.querySelector(`mark[data-slc-threads~="${t.id}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      }}
      lost={Boolean(t.anchor && t.status === 'open' && located[t.anchor.field] && !located[t.anchor.field].includes(t.id))}
    />
  );

  return (
    <section className="slc-panel" aria-label={title}>
      <h3 className="slc-title">
        {title}
        {open.length > 0 && <span className="slc-count">{open.length}</span>}
      </h3>
      {error && <div className="slc-error">{error}</div>}
      {draft && (
        <form className="slc-thread slc-thread--focused slc-form" onSubmit={e => start(e, body, true)}>
          <blockquote className="slc-quote">{draft.anchor.quote}</blockquote>
          <textarea aria-label="New comment" autoFocus placeholder="Add a comment" value={body} onChange={e => setBody(e.target.value)} rows={3} />
          <div className="slc-actions">
            <button type="submit" disabled={busy || !body.trim()}>Comment</button>
            <button type="button" className="slc-link" onClick={() => state.setDraft(null)}>Cancel</button>
          </div>
        </form>
      )}
      {threads && open.length === 0 && !draft && (
        <p className="slc-empty">{state.me?.can_comment ? 'No open comments. Select any text to comment on it.' : 'No open comments.'}</p>
      )}
      {open.map(card)}
      {state.me?.can_comment && (
        <form className="slc-form" onSubmit={e => start(e, general, false)}>
          <textarea aria-label={placeholder} placeholder={placeholder} value={general} onChange={e => setGeneral(e.target.value)} rows={general ? 3 : 1} />
          {general && (
            <div className="slc-actions">
              <button type="submit" disabled={busy}>Comment</button>
            </div>
          )}
        </form>
      )}
      {failure && <div className="slc-error">{failure}</div>}
      {closed.length > 0 && (
        <button type="button" className="slc-link" onClick={() => setShowClosed(v => !v)}>
          {showClosed ? 'Hide' : 'Show'} {closed.length} closed
        </button>
      )}
      {showClosed && closed.map(card)}
    </section>
  );
}
