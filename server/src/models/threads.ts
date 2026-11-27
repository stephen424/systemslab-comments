import { getClient, query } from '../config/database';

export type ThreadStatus = 'open' | 'incorporated' | 'declined';

export interface Target {
  app: string;
  type: string;
  id: string;
}

export interface Anchor {
  field: string;
  quote: string;
  prefix: string;
  suffix: string;
  start: number | null;
}

export interface Comment {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  /** People mentioned in the body, as @[Name](user id). */
  mentions: string[];
}

export interface Thread {
  id: string;
  app: string;
  target: { type: string; id: string; rev: string | null };
  anchor: Anchor | null;
  status: ThreadStatus;
  resolution: { note: string | null; rev: string | null; by_name: string | null; at: string } | null;
  created_by: string;
  created_at: string;
  comments: Comment[];
}

interface ThreadRow {
  id: string;
  app: string;
  target_type: string;
  target_id: string;
  target_rev: string | null;
  field: string | null;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  start_offset: number | null;
  status: ThreadStatus;
  resolution_note: string | null;
  resolved_rev: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_by: string;
  created_at: string;
}

interface CommentRow {
  id: string;
  thread_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  mentions?: string[] | null;
}

/** A mention in a comment body: @[Name](user id). */
const MENTION = /@\[([^\]\n]{1,200})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export const mentionedIds = (body: string): string[] => [...new Set([...body.matchAll(MENTION)].map(m => m[2].toLowerCase()))];

/** Records who a comment mentions, keeping only real, active accounts. */
const saveMentions = async (
  db: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  commentId: string,
  body: string
): Promise<void> => {
  await db.query('DELETE FROM comments.mentions WHERE comment_id = $1', [commentId]);
  const ids = mentionedIds(body);
  if (ids.length === 0) return;
  await db.query(
    `INSERT INTO comments.mentions (comment_id, user_id)
     SELECT $1, id FROM public.users WHERE is_active AND id = ANY($2::uuid[]) ON CONFLICT DO NOTHING`,
    [commentId, ids]
  );
};

const toComment = (c: CommentRow): Comment => ({
  id: c.id,
  author_id: c.author_id,
  author_name: c.author_name,
  body: c.deleted_at ? '' : c.body,
  created_at: c.created_at,
  edited_at: c.edited_at,
  deleted: c.deleted_at !== null,
  mentions: c.deleted_at ? [] : c.mentions ?? [],
});

const toThread = (t: ThreadRow, comments: CommentRow[]): Thread => ({
  id: t.id,
  app: t.app,
  target: { type: t.target_type, id: t.target_id, rev: t.target_rev },
  anchor:
    t.field !== null && t.quote !== null
      ? { field: t.field, quote: t.quote, prefix: t.prefix ?? '', suffix: t.suffix ?? '', start: t.start_offset }
      : null,
  status: t.status,
  resolution: t.resolved_at
    ? { note: t.resolution_note, rev: t.resolved_rev, by_name: t.resolved_by_name, at: t.resolved_at }
    : null,
  created_by: t.created_by,
  created_at: t.created_at,
  comments: comments.map(toComment),
});

const withComments = async (rows: ThreadRow[]): Promise<Thread[]> => {
  if (rows.length === 0) return [];
  const comments = await query<CommentRow>(
    `SELECT c.*, ARRAY(SELECT m.user_id::text FROM comments.mentions m WHERE m.comment_id = c.id ORDER BY m.user_id) AS mentions
     FROM comments.comments c WHERE c.thread_id = ANY($1::uuid[]) ORDER BY c.created_at, c.id`,
    [rows.map(r => r.id)]
  );
  const byThread = new Map<string, CommentRow[]>();
  for (const c of comments.rows) {
    const list = byThread.get(c.thread_id) ?? [];
    list.push(c);
    byThread.set(c.thread_id, list);
  }
  return rows.map(r => toThread(r, byThread.get(r.id) ?? []));
};

export type StatusFilter = ThreadStatus | 'closed' | 'all';

/** Threads on one target, or, with no target, every thread in the app (the admin's review list). */
export const listThreads = async (
  app: string,
  options: { type?: string; id?: string; status: StatusFilter; mentioning?: string; limit?: number }
): Promise<Thread[]> => {
  const params: unknown[] = [app];
  let sql = 'SELECT * FROM comments.threads WHERE app = $1';
  if (options.type) {
    params.push(options.type);
    sql += ` AND target_type = $${params.length}`;
  }
  if (options.id) {
    params.push(options.id);
    sql += ` AND target_id = $${params.length}`;
  }
  if (options.mentioning) {
    params.push(options.mentioning);
    sql += ` AND id IN (SELECT c.thread_id FROM comments.comments c JOIN comments.mentions m ON m.comment_id = c.id
      WHERE m.user_id = $${params.length} AND c.deleted_at IS NULL)`;
  }
  if (options.status === 'closed') {
    sql += ` AND status <> 'open'`;
  } else if (options.status !== 'all') {
    params.push(options.status);
    sql += ` AND status = $${params.length}`;
  }
  params.push(options.limit ?? 500);
  sql += ` ORDER BY created_at, id LIMIT $${params.length}`;
  const result = await query<ThreadRow>(sql, params);
  return withComments(result.rows);
};

export const getThread = async (id: string): Promise<Thread | null> => {
  const result = await query<ThreadRow>('SELECT * FROM comments.threads WHERE id = $1', [id]);
  return result.rows[0] ? (await withComments(result.rows))[0] : null;
};

/** Open threads per target, for badges in contents and lists. */
export const openCounts = async (app: string, type?: string): Promise<{ type: string; id: string; open: number }[]> => {
  const result = await query<{ type: string; id: string; open: string }>(
    `SELECT target_type AS type, target_id AS id, COUNT(*) AS open FROM comments.threads
     WHERE app = $1 AND status = 'open' AND ($2::text IS NULL OR target_type = $2)
     GROUP BY target_type, target_id ORDER BY target_type, target_id`,
    [app, type ?? null]
  );
  return result.rows.map(r => ({ type: r.type, id: r.id, open: Number(r.open) }));
};

export const createThread = async (input: {
  target: Target;
  rev: string | null;
  anchor: Anchor | null;
  body: string;
  author: { id: string; name: string };
}): Promise<Thread> => {
  const client = await getClient();
  let id: string;
  try {
    await client.query('BEGIN');
    const { target, anchor } = input;
    const t = await client.query<{ id: string }>(
      `INSERT INTO comments.threads (app, target_type, target_id, target_rev, field, quote, prefix, suffix, start_offset, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        target.app,
        target.type,
        target.id,
        input.rev,
        anchor?.field ?? null,
        anchor?.quote ?? null,
        anchor?.prefix ?? null,
        anchor?.suffix ?? null,
        anchor?.start ?? null,
        input.author.id,
      ]
    );
    id = t.rows[0].id;
    const c = await client.query<{ id: string }>(
      'INSERT INTO comments.comments (thread_id, author_id, author_name, body) VALUES ($1, $2, $3, $4) RETURNING id',
      [id, input.author.id, input.author.name, input.body]
    );
    await saveMentions(client, c.rows[0].id, input.body);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return (await getThread(id))!;
};

export const addComment = async (threadId: string, author: { id: string; name: string }, body: string): Promise<void> => {
  const c = await query<{ id: string }>(
    'INSERT INTO comments.comments (thread_id, author_id, author_name, body) VALUES ($1, $2, $3, $4) RETURNING id',
    [threadId, author.id, author.name, body]
  );
  await saveMentions({ query }, c.rows[0].id, body);
};

export const getComment = async (id: string): Promise<(CommentRow & { app: string }) | null> => {
  const result = await query<CommentRow & { app: string }>(
    'SELECT c.*, t.app FROM comments.comments c JOIN comments.threads t ON t.id = c.thread_id WHERE c.id = $1',
    [id]
  );
  return result.rows[0] ?? null;
};

export const editComment = async (id: string, body: string): Promise<void> => {
  await query('UPDATE comments.comments SET body = $2, edited_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [id, body]);
  await saveMentions({ query }, id, body);
};

/** The comment stays, marked deleted, so the replies around it still read in order. */
export const removeComment = async (id: string): Promise<void> => {
  await query('UPDATE comments.comments SET deleted_at = NOW() WHERE id = $1', [id]);
};

export const removeThread = async (id: string): Promise<void> => {
  await query('DELETE FROM comments.threads WHERE id = $1', [id]);
};

export const setStatus = async (
  id: string,
  status: ThreadStatus,
  by: { id: string; name: string },
  note: string | null,
  rev: string | null
): Promise<void> => {
  if (status === 'open') {
    await query(
      `UPDATE comments.threads SET status = 'open', resolution_note = NULL, resolved_rev = NULL,
         resolved_by = NULL, resolved_by_name = NULL, resolved_at = NULL WHERE id = $1`,
      [id]
    );
    return;
  }
  await query(
    `UPDATE comments.threads SET status = $2, resolution_note = $3, resolved_rev = $4,
       resolved_by = $5, resolved_by_name = $6, resolved_at = NOW() WHERE id = $1`,
    [id, status, note, status === 'incorporated' ? rev : null, by.id, by.name]
  );
};
