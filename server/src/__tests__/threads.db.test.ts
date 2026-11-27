import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app';
import pool from '../config/database';
import { migrate } from '../database/migrate';

const PEET = '11111111-1111-1111-1111-111111111111';
const ANNA = '22222222-2222-2222-2222-222222222222';
const BOSS = '33333333-3333-3333-3333-333333333333';
const VERA = '44444444-4444-4444-4444-444444444444';
const LENA = '55555555-5555-5555-5555-555555555555';

const as = (userId: string, role = 'user') => ({
  Authorization: `Bearer ${jwt.sign({ userId, email: `${userId}@example.com`, role }, 'test-secret', { expiresIn: '5m' })}`,
});

const anchor = { field: 'statement', quote: 'inside bend radius', prefix: 'Use an ', suffix: ' of at least', start: 7 };

beforeAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS comments CASCADE');
  await pool.query('DROP TABLE IF EXISTS public.users');
  await pool.query(`CREATE TABLE public.users (
    id UUID PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user', is_active BOOLEAN NOT NULL DEFAULT TRUE)`);
  await pool.query(
    `INSERT INTO public.users (id, email, full_name, role, is_active) VALUES
     ($1, 'peet@example.com', 'Peet', 'user', TRUE), ($2, 'anna@example.com', 'Anna', 'user', TRUE),
     ($3, 'boss@example.com', 'Boss', 'admin', TRUE), ($4, 'vera@example.com', 'Vera', 'viewer', TRUE),
     ($5, 'lena@example.com', 'Lena', 'user', FALSE)`,
    [PEET, ANNA, BOSS, VERA, LENA]
  );
  await migrate();
});

afterAll(() => pool.end());

const start = (who: string, body: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/threads')
    .set(as(who))
    .send({ app: 'practice', target_type: 'item', target_id: 'PR-SM-001', target_rev: 'A', anchor, body: 'Too tight for 6082', ...body });

describe('comments API', () => {
  it('needs a Systemslab.ai sign-in from an active account', async () => {
    await request(app).get('/api/threads?app=practice').expect(401);
    await request(app).get('/api/me?app=practice').set(as(LENA)).expect(403);
  });

  it('says what each person may do in an app', async () => {
    expect((await request(app).get('/api/me?app=practice').set(as(PEET)).expect(200)).body.data).toEqual({
      id: PEET,
      name: 'Peet',
      can_comment: true,
      is_admin: false,
    });
    expect((await request(app).get('/api/me?app=practice').set(as(BOSS)).expect(200)).body.data.is_admin).toBe(true);
    expect((await request(app).get('/api/me?app=practice').set(as(VERA)).expect(200)).body.data.can_comment).toBe(false);
    await request(app).get('/api/me?app=quickbuild').set(as(PEET)).expect(400);
  });

  it('starts a thread on quoted text and lists it on the target', async () => {
    const res = await start(PEET).expect(201);
    expect(res.body.data).toMatchObject({
      app: 'practice',
      target: { type: 'item', id: 'PR-SM-001', rev: 'A' },
      anchor,
      status: 'open',
      resolution: null,
      comments: [{ author_name: 'Peet', body: 'Too tight for 6082', deleted: false }],
    });
    const list = await request(app).get('/api/threads?app=practice&target_type=item&target_id=PR-SM-001').set(as(ANNA)).expect(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('takes comments on a whole target, and refuses bad input', async () => {
    await start(ANNA, { anchor: null, target_id: 'PR-SM-002', body: 'Needs a figure' }).expect(201);
    await start(ANNA, { body: '   ' }).expect(400);
    await start(ANNA, { app: 'nope' }).expect(400);
    await start(ANNA, { anchor: { field: 'statement' } }).expect(400);
    await start(ANNA, { body: 'x'.repeat(10_001) }).expect(400);
    await start(VERA).expect(403);
  });

  it('counts open threads per target', async () => {
    const res = await request(app).get('/api/counts?app=practice').set(as(PEET)).expect(200);
    expect(res.body.data).toEqual([
      { type: 'item', id: 'PR-SM-001', open: 1 },
      { type: 'item', id: 'PR-SM-002', open: 1 },
    ]);
  });

  it('takes replies, and lets people edit and delete only their own', async () => {
    const thread = (await start(PEET, { target_id: 'PR-SM-003' }).expect(201)).body.data;
    const reply = await request(app).post(`/api/threads/${thread.id}/comments`).set(as(ANNA)).send({ body: 'Agreed, 2t' }).expect(201);
    const annaComment = reply.body.data.comments[1];
    expect(annaComment).toMatchObject({ author_name: 'Anna', body: 'Agreed, 2t' });

    await request(app).patch(`/api/comments/${annaComment.id}`).set(as(PEET)).send({ body: 'hijack' }).expect(403);
    const edited = await request(app).patch(`/api/comments/${annaComment.id}`).set(as(ANNA)).send({ body: 'Agreed, 2.5t' }).expect(200);
    expect(edited.body.data.comments[1].body).toBe('Agreed, 2.5t');
    expect(edited.body.data.comments[1].edited_at).not.toBeNull();

    await request(app).delete(`/api/comments/${annaComment.id}`).set(as(PEET)).expect(403);
    const deleted = await request(app).delete(`/api/comments/${annaComment.id}`).set(as(ANNA)).expect(200);
    expect(deleted.body.data.comments[1]).toMatchObject({ deleted: true, body: '' });

    // Anna replied, so Peet can no longer remove the whole thread; an admin can.
    await request(app).delete(`/api/threads/${thread.id}`).set(as(PEET)).expect(403);
    await request(app).delete(`/api/threads/${thread.id}`).set(as(BOSS, 'admin')).expect(200);
    await request(app).post(`/api/threads/${thread.id}/comments`).set(as(ANNA)).send({ body: 'gone?' }).expect(404);
  });

  it('lets the starter remove an unanswered thread', async () => {
    const thread = (await start(ANNA, { target_id: 'PR-SM-009' }).expect(201)).body.data;
    await request(app).delete(`/api/threads/${thread.id}`).set(as(ANNA)).expect(200);
  });

  it('lets only an admin of the app close and reopen threads', async () => {
    const [thread] = (await request(app).get('/api/threads?app=practice&target_type=item&target_id=PR-SM-001').set(as(PEET))).body.data;
    await request(app).patch(`/api/threads/${thread.id}`).set(as(PEET)).send({ status: 'incorporated' }).expect(403);

    // A per-app admin can close threads in that app only.
    await pool.query(`INSERT INTO comments.app_admins (app, user_id) VALUES ('practice', $1)`, [ANNA]);
    const done = await request(app)
      .patch(`/api/threads/${thread.id}`)
      .set(as(ANNA))
      .send({ status: 'incorporated', resolved_rev: 'B', note: 'Raised to 2t for 6082-T6' })
      .expect(200);
    expect(done.body.data).toMatchObject({ status: 'incorporated', resolution: { rev: 'B', by_name: 'Anna', note: 'Raised to 2t for 6082-T6' } });

    const queue = await request(app).get('/api/threads?app=practice').set(as(BOSS, 'admin')).expect(200);
    expect(queue.body.data.map((t: { target: { id: string } }) => t.target.id)).toEqual(['PR-SM-002']);
    const closed = await request(app).get('/api/threads?app=practice&status=closed').set(as(BOSS, 'admin')).expect(200);
    expect(closed.body.data).toHaveLength(1);

    const reopened = await request(app).patch(`/api/threads/${thread.id}`).set(as(BOSS, 'admin')).send({ status: 'open' }).expect(200);
    expect(reopened.body.data).toMatchObject({ status: 'open', resolution: null });
    await request(app).patch(`/api/threads/${thread.id}`).set(as(BOSS, 'admin')).send({ status: 'done' }).expect(400);

    const lifecycle = (await start(PEET, { app: 'lifecycle', target_type: 'requirement', target_id: 'REQ-1' }).expect(201)).body.data;
    await request(app).patch(`/api/threads/${lifecycle.id}`).set(as(ANNA)).send({ status: 'declined' }).expect(403);
  });

  it('answers unknown ids with 404 and malformed ones with 400', async () => {
    await request(app).post('/api/threads/00000000-0000-0000-0000-000000000000/comments').set(as(PEET)).send({ body: 'x' }).expect(404);
    await request(app).patch('/api/threads/not-a-uuid').set(as(BOSS, 'admin')).send({ status: 'open' }).expect(400);
  });
});
