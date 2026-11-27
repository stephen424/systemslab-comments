import { FormEvent, useEffect, useRef, useState } from 'react';
import type { CommentsClient, Me, Thread } from './api.js';
import { MentionTextarea } from './MentionTextarea.js';
import { decode, DraftText, emptyDraft, encode, parts } from './mentions.js';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** A comment body with its mentions shown as names; mentions of the reader stand out. */
export function Body({ body, me }: { body: string; me: Me | null }) {
  return (
    <>
      {parts(body).map((p, i) =>
        'mention' in p ? (
          <span key={i} className={`slc-mention${p.mention.id === me?.id ? ' slc-mention--me' : ''}`}>@{p.mention.name}</span>
        ) : (
          p.text
        )
      )}
    </>
  );
}

const STATUS_LABEL = { open: 'Open', incorporated: 'Incorporated', declined: 'Declined' } as const;

export interface ThreadCardProps {
  thread: Thread;
  client: CommentsClient;
  me: Me | null;
  /** Called with the thread as it now is, or null once it has been removed. */
  onChange: (thread: Thread | null) => void;
  focused?: boolean;
  onFocus?: () => void;
  /** The quoted text can no longer be found in the target. */
  lost?: boolean;
}

/** One thread: the quote, the comments, a reply box, and for admins the incorporate / decline controls. */
export function ThreadCard({ thread, client, me, onChange, focused, onFocus, lost }: ThreadCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState<DraftText>(emptyDraft);
  const [editing, setEditing] = useState<{ id: string; draft: DraftText } | null>(null);
  const [closing, setClosing] = useState<'incorporated' | 'declined' | null>(null);
  const [note, setNote] = useState('');
  const [rev, setRev] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [focused]);

  const run = async (fn: () => Promise<Thread | null>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!reply.text.trim()) return;
    if (await run(() => client.reply(thread.id, encode(reply)))) setReply(emptyDraft());
  };

  const saveEdit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!editing?.draft.text.trim()) return;
    if (await run(() => client.edit(editing.id, encode(editing.draft)))) setEditing(null);
  };

  const close = async (e: FormEvent) => {
    e.preventDefault();
    if (!closing) return;
    if (await run(() => client.setStatus(thread.id, closing, note.trim(), rev.trim()))) {
      setClosing(null);
      setNote('');
      setRev('');
    }
  };

  const canRemoveThread =
    me && (me.is_admin || (thread.created_by === me.id && thread.comments.every(c => c.author_id === me.id)));

  return (
    <div
      ref={ref}
      className={`slc-thread slc-thread--${thread.status}${focused ? ' slc-thread--focused' : ''}`}
      data-slc-thread={thread.id}
      onClick={onFocus}
    >
      {thread.anchor && (
        <blockquote className="slc-quote">
          {thread.anchor.quote}
          {lost && <span className="slc-lost">This text has changed since the comment was made</span>}
        </blockquote>
      )}
      {thread.status !== 'open' && (
        <div className="slc-resolution">
          {STATUS_LABEL[thread.status]}
          {thread.resolution?.rev && ` in rev ${thread.resolution.rev}`}
          {thread.resolution?.by_name && ` by ${thread.resolution.by_name}`}
          {thread.resolution?.note && <div className="slc-note">{thread.resolution.note}</div>}
        </div>
      )}
      <ol className="slc-comments">
        {thread.comments.map(c => (
          <li key={c.id} className="slc-comment">
            <div className="slc-meta">
              <strong>{c.author_name}</strong> <span>{when(c.created_at)}</span>
              {c.edited_at && !c.deleted && <span> · edited</span>}
            </div>
            {c.deleted ? (
              <div className="slc-body slc-deleted">Comment deleted</div>
            ) : editing?.id === c.id ? (
              <form onSubmit={saveEdit} className="slc-form">
                <MentionTextarea label="Edit comment" value={editing.draft} onChange={draft => setEditing({ id: c.id, draft })} onSubmit={saveEdit} />
                <div className="slc-actions">
                  <button type="submit" disabled={busy}>Save</button>
                  <button type="button" className="slc-link" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <>
                <div className="slc-body">
                  <Body body={c.body} me={me} />
                </div>
                {me && (c.author_id === me.id || me.is_admin) && (
                  <div className="slc-actions slc-actions--quiet">
                    {c.author_id === me.id && (
                      <button type="button" className="slc-link" onClick={() => setEditing({ id: c.id, draft: decode(c.body) })}>Edit</button>
                    )}
                    <button type="button" className="slc-link" disabled={busy} onClick={() => run(() => client.removeComment(c.id))}>
                      Delete
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      {me?.can_comment && (
        <form onSubmit={sendReply} className="slc-form">
          <MentionTextarea label="Reply" placeholder="Reply, or @ to mention someone" value={reply} onChange={setReply} rows={reply.text ? 3 : 1} onSubmit={sendReply} />
          {reply.text && (
            <div className="slc-actions">
              <button type="submit" disabled={busy}>Reply</button>
            </div>
          )}
        </form>
      )}
      {me?.is_admin && !closing && (
        <div className="slc-actions slc-admin">
          {thread.status === 'open' ? (
            <>
              <button type="button" onClick={() => setClosing('incorporated')}>Incorporated</button>
              <button type="button" onClick={() => setClosing('declined')}>Decline</button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => run(() => client.setStatus(thread.id, 'open'))}>Reopen</button>
          )}
          {canRemoveThread && (
            <button type="button" className="slc-link" disabled={busy} onClick={() => run(async () => (await client.removeThread(thread.id), null))}>
              Remove thread
            </button>
          )}
        </div>
      )}
      {!me?.is_admin && canRemoveThread && (
        <div className="slc-actions slc-actions--quiet">
          <button type="button" className="slc-link" disabled={busy} onClick={() => run(async () => (await client.removeThread(thread.id), null))}>
            Remove thread
          </button>
        </div>
      )}
      {closing && (
        <form onSubmit={close} className="slc-form slc-admin">
          {closing === 'incorporated' && (
            <input aria-label="Revision" placeholder="Went into revision (e.g. B)" value={rev} onChange={e => setRev(e.target.value)} />
          )}
          <textarea
            aria-label={closing === 'incorporated' ? 'What changed' : 'Why not'}
            placeholder={closing === 'incorporated' ? 'What changed (optional)' : 'Why not (optional)'}
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
          />
          <div className="slc-actions">
            <button type="submit" disabled={busy}>{closing === 'incorporated' ? 'Mark incorporated' : 'Decline'}</button>
            <button type="button" className="slc-link" onClick={() => setClosing(null)}>Cancel</button>
          </div>
        </form>
      )}
      {error && <div className="slc-error">{error}</div>}
    </div>
  );
}
