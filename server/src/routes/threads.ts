import { NextFunction, Response, Router } from 'express';
import { env } from '../config/environment';
import { AuthRequest } from '../middleware/auth';
import { canComment, isAppAdmin, listPeople, SystemslabUser } from '../models/user';
import {
  addComment,
  Anchor,
  createThread,
  editComment,
  getComment,
  getThread,
  listThreads,
  openCounts,
  removeComment,
  removeThread,
  setStatus,
  StatusFilter,
  ThreadStatus,
} from '../models/threads';

const router = Router();

const LIMITS = { key: 200, body: 10_000, quote: 2_000, context: 64, note: 2_000 };

class BadRequest extends Error {}

const text = (value: unknown, name: string, max: number, required = true): string | null => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequest(`${name} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new BadRequest(`${name} must be text`);
  const trimmed = name === 'quote' || name === 'prefix' || name === 'suffix' ? value : value.trim();
  if (required && !trimmed) throw new BadRequest(`${name} is required`);
  if (trimmed.length > max) throw new BadRequest(`${name} is longer than ${max} characters`);
  return trimmed;
};

const appName = (value: unknown): string => {
  const app = text(value, 'app', LIMITS.key)!;
  if (!env.APPS.includes(app)) throw new BadRequest(`Unknown app ${app}`);
  return app;
};

const STATUS_FILTERS: StatusFilter[] = ['open', 'incorporated', 'declined', 'closed', 'all'];
const STATUSES: ThreadStatus[] = ['open', 'incorporated', 'declined'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: string): string => {
  if (!UUID.test(value)) throw new BadRequest('Not a valid id');
  return value;
};

const parseAnchor = (value: unknown): Anchor | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') throw new BadRequest('anchor must be an object');
  const a = value as Record<string, unknown>;
  const start = a.start === undefined || a.start === null ? null : Number(a.start);
  if (start !== null && (!Number.isInteger(start) || start < 0)) throw new BadRequest('anchor.start must be a whole number');
  return {
    field: text(a.field, 'field', LIMITS.key)!,
    quote: text(a.quote, 'quote', LIMITS.quote)!,
    prefix: text(a.prefix, 'prefix', LIMITS.context, false) ?? '',
    suffix: text(a.suffix, 'suffix', LIMITS.context, false) ?? '',
    start,
  };
};

const author = (user: SystemslabUser) => ({ id: user.id, name: user.full_name || user.email });

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle = (fn: Handler) => (req: AuthRequest, res: Response, next: NextFunction) =>
  fn(req, res).catch(error => {
    if (error instanceof BadRequest) res.status(400).json({ success: false, message: error.message });
    else next(error);
  });

const notFound = (res: Response, what = 'Thread') => res.status(404).json({ success: false, message: `${what} not found` });
const forbidden = (res: Response, message: string) => res.status(403).json({ success: false, message });

/** Who the signed-in person is in one app, so the UI shows only what they may do. */
router.get(
  '/me',
  handle(async (req, res) => {
    const user = req.user!;
    const app = appName(req.query.app);
    res.json({
      success: true,
      data: { id: user.id, name: author(user).name, can_comment: canComment(user), is_admin: await isAppAdmin(user, app) },
    });
  })
);

/** Everyone who can be mentioned. */
router.get(
  '/people',
  handle(async (_req, res) => {
    res.json({ success: true, data: await listPeople() });
  })
);

/**
 * Threads with their comments. With target_type and target_id, the threads on that target; without, the
 * whole app (the admin's review list), open threads by default. With mentions=me, only the threads where
 * someone mentioned the signed-in person.
 */
router.get(
  '/threads',
  handle(async (req, res) => {
    const app = appName(req.query.app);
    const type = text(req.query.target_type, 'target_type', LIMITS.key, false) ?? undefined;
    const id = text(req.query.target_id, 'target_id', LIMITS.key, false) ?? undefined;
    const status = (req.query.status ?? (id ? 'all' : 'open')) as StatusFilter;
    if (!STATUS_FILTERS.includes(status)) throw new BadRequest(`status must be one of ${STATUS_FILTERS.join(', ')}`);
    if (req.query.mentions !== undefined && req.query.mentions !== 'me') throw new BadRequest('mentions can only be me');
    const mentioning = req.query.mentions === 'me' ? req.user!.id : undefined;
    res.json({ success: true, data: await listThreads(app, { type, id, status, mentioning }) });
  })
);

router.get(
  '/counts',
  handle(async (req, res) => {
    const app = appName(req.query.app);
    const type = text(req.query.target_type, 'target_type', LIMITS.key, false) ?? undefined;
    res.json({ success: true, data: await openCounts(app, type) });
  })
);

router.post(
  '/threads',
  handle(async (req, res) => {
    const user = req.user!;
    if (!canComment(user)) return void forbidden(res, 'Viewers cannot comment');
    const b = req.body ?? {};
    const thread = await createThread({
      target: {
        app: appName(b.app),
        type: text(b.target_type, 'target_type', LIMITS.key)!,
        id: text(b.target_id, 'target_id', LIMITS.key)!,
      },
      rev: text(b.target_rev, 'target_rev', LIMITS.key, false),
      anchor: parseAnchor(b.anchor),
      body: text(b.body, 'body', LIMITS.body)!,
      author: author(user),
    });
    res.status(201).json({ success: true, data: thread });
  })
);

router.post(
  '/threads/:id/comments',
  handle(async (req, res) => {
    const user = req.user!;
    if (!canComment(user)) return void forbidden(res, 'Viewers cannot comment');
    const thread = await getThread(uuid(req.params.id));
    if (!thread) return void notFound(res);
    await addComment(thread.id, author(user), text(req.body?.body, 'body', LIMITS.body)!);
    res.status(201).json({ success: true, data: await getThread(thread.id) });
  })
);

/** Marks a thread incorporated (with the revision it went into) or declined (with a reason), or reopens it. */
router.patch(
  '/threads/:id',
  handle(async (req, res) => {
    const user = req.user!;
    const thread = await getThread(uuid(req.params.id));
    if (!thread) return void notFound(res);
    if (!(await isAppAdmin(user, thread.app))) return void forbidden(res, 'Only an admin of this app can close or reopen threads');
    const status = req.body?.status as ThreadStatus;
    if (!STATUSES.includes(status)) throw new BadRequest(`status must be one of ${STATUSES.join(', ')}`);
    const note = text(req.body?.note, 'note', LIMITS.note, false);
    const rev = text(req.body?.resolved_rev, 'resolved_rev', LIMITS.key, false);
    await setStatus(thread.id, status, author(user), note, rev);
    res.json({ success: true, data: await getThread(thread.id) });
  })
);

/** Admins can remove any thread; the person who started one can remove it until someone else replies. */
router.delete(
  '/threads/:id',
  handle(async (req, res) => {
    const user = req.user!;
    const thread = await getThread(uuid(req.params.id));
    if (!thread) return void notFound(res);
    const ownAndUnanswered = thread.created_by === user.id && thread.comments.every(c => c.author_id === user.id);
    if (!ownAndUnanswered && !(await isAppAdmin(user, thread.app))) {
      return void forbidden(res, 'Only an admin can remove a thread others have replied to');
    }
    await removeThread(thread.id);
    res.json({ success: true, data: { id: thread.id } });
  })
);

router.patch(
  '/comments/:id',
  handle(async (req, res) => {
    const user = req.user!;
    const comment = await getComment(uuid(req.params.id));
    if (!comment || comment.deleted_at) return void notFound(res, 'Comment');
    if (comment.author_id !== user.id) return void forbidden(res, 'You can only edit your own comments');
    await editComment(comment.id, text(req.body?.body, 'body', LIMITS.body)!);
    res.json({ success: true, data: await getThread(comment.thread_id) });
  })
);

router.delete(
  '/comments/:id',
  handle(async (req, res) => {
    const user = req.user!;
    const comment = await getComment(uuid(req.params.id));
    if (!comment || comment.deleted_at) return void notFound(res, 'Comment');
    if (comment.author_id !== user.id && !(await isAppAdmin(user, comment.app))) {
      return void forbidden(res, 'You can only delete your own comments');
    }
    await removeComment(comment.id);
    res.json({ success: true, data: await getThread(comment.thread_id) });
  })
);

export default router;
