import { ReactNode, useEffect, useState } from 'react';
import type { Thread } from './api.js';
import { targetKey, useCommentsState } from './context.js';
import { ThreadCard } from './ThreadCard.js';

export interface ReviewListProps {
  /** How to show a target's heading, usually a link to it, e.g. the item's ID and title. */
  renderTarget?: (target: Thread['target']) => ReactNode;
  /** Orders the targets, e.g. in reading order. By default the oldest thread comes first. */
  sortKey?: (target: Thread['target']) => string | number;
}

/** Every thread in the app, grouped by what it is on: the admin's list to work through. */
export function ReviewList({ renderTarget, sortKey }: ReviewListProps) {
  const state = useCommentsState();
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { client, version } = state;

  useEffect(() => {
    let live = true;
    client.allThreads(status).then(
      list => live && (setThreads(list), setError(null)),
      e => live && setError(e instanceof Error ? e.message : 'Comments could not be loaded')
    );
    return () => {
      live = false;
    };
  }, [client, status, version]);

  const groups = new Map<string, Thread[]>();
  for (const t of threads ?? []) {
    const key = targetKey(t.target);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const ordered = [...groups.values()];
  if (sortKey) {
    ordered.sort((a, b) => {
      const [x, y] = [sortKey(a[0].target), sortKey(b[0].target)];
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }

  return (
    <div className="slc-review">
      <div className="slc-tabs" role="tablist">
        {(['open', 'closed'] as const).map(s => (
          <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? 'slc-tab slc-tab--on' : 'slc-tab'} onClick={() => setStatus(s)}>
            {s === 'open' ? 'Open' : 'Closed'}
          </button>
        ))}
      </div>
      {error && <div className="slc-error">{error}</div>}
      {threads && threads.length === 0 && <p className="slc-empty">{status === 'open' ? 'Nothing waiting. Every comment has been dealt with.' : 'No closed comments yet.'}</p>}
      {ordered.map(list => (
        <section key={targetKey(list[0].target)} className="slc-group">
          <h3 className="slc-group-title">
            {renderTarget ? renderTarget(list[0].target) : `${list[0].target.type} ${list[0].target.id}`}
            <span className="slc-count">{list.length}</span>
          </h3>
          {list.map(t => (
            <ThreadCard
              key={t.id}
              thread={t}
              client={client}
              me={state.me}
              onChange={next => {
                state.put(targetKey(t.target), next, t.id);
                setThreads(prev => (prev ?? []).flatMap(x => (x.id !== t.id ? [x] : next && (next.status === 'open') === (status === 'open') ? [next] : [])));
                state.bump();
              }}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
