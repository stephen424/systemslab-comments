import type { TextAnchor } from './anchor.js';

export type ThreadStatus = 'open' | 'incorporated' | 'declined';

/** What a thread is on: e.g. { type: 'item', id: 'PR-SM-001', rev: 'A' } in Practice. */
export interface Target {
  type: string;
  id: string;
  /** The target's current revision, recorded when a thread is started. */
  rev?: string | null;
}

export interface Comment {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
}

export interface Thread {
  id: string;
  app: string;
  target: { type: string; id: string; rev: string | null };
  anchor: TextAnchor | null;
  status: ThreadStatus;
  resolution: { note: string | null; rev: string | null; by_name: string | null; at: string } | null;
  created_by: string;
  created_at: string;
  comments: Comment[];
}

export interface Me {
  id: string;
  name: string;
  can_comment: boolean;
  is_admin: boolean;
}

export interface ClientConfig {
  /** The comments API, e.g. https://comments.systemslab.ai/api */
  apiUrl: string;
  /** This app's name in the comments service: practice, lifecycle or form. */
  app: string;
  /** The current Systemslab.ai access token. */
  getToken: () => string | null | Promise<string | null>;
  /** Gets a fresh access token when the current one has expired (the app's own refresh). */
  refreshToken?: () => Promise<string>;
}

export class CommentsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const createClient = (config: ClientConfig) => {
  const base = config.apiUrl.replace(/\/+$/, '');

  const send = async <T>(method: string, path: string, body?: unknown, retried = false): Promise<T> => {
    const token = await config.getToken();
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; code?: string };
    if (res.status === 401 && json.code === 'TOKEN_EXPIRED' && config.refreshToken && !retried) {
      await config.refreshToken();
      return send<T>(method, path, body, true);
    }
    if (!res.ok) throw new CommentsError(json.message || `Comments request failed (${res.status})`, res.status);
    return json.data as T;
  };

  const q = (params: Record<string, string | undefined>) =>
    new URLSearchParams(Object.entries({ app: config.app, ...params }).filter(([, v]) => v !== undefined) as [string, string][]).toString();

  return {
    app: config.app,
    me: () => send<Me>('GET', `/me?${q({})}`),
    threads: (target: Target) => send<Thread[]>('GET', `/threads?${q({ target_type: target.type, target_id: target.id })}`),
    /** Every thread in the app with this status: the admin's review list. */
    allThreads: (status: 'open' | 'closed' | 'all' = 'open') => send<Thread[]>('GET', `/threads?${q({ status })}`),
    counts: (targetType?: string) => send<{ type: string; id: string; open: number }[]>('GET', `/counts?${q({ target_type: targetType })}`),
    start: (target: Target, body: string, anchor: TextAnchor | null) =>
      send<Thread>('POST', '/threads', {
        app: config.app,
        target_type: target.type,
        target_id: target.id,
        target_rev: target.rev ?? null,
        anchor,
        body,
      }),
    reply: (threadId: string, body: string) => send<Thread>('POST', `/threads/${threadId}/comments`, { body }),
    edit: (commentId: string, body: string) => send<Thread>('PATCH', `/comments/${commentId}`, { body }),
    removeComment: (commentId: string) => send<Thread>('DELETE', `/comments/${commentId}`),
    removeThread: (threadId: string) => send<{ id: string }>('DELETE', `/threads/${threadId}`),
    setStatus: (threadId: string, status: ThreadStatus, note?: string, resolvedRev?: string) =>
      send<Thread>('PATCH', `/threads/${threadId}`, { status, note: note || null, resolved_rev: resolvedRev || null }),
  };
};

export type CommentsClient = ReturnType<typeof createClient>;
