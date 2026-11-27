import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommentableText, CommentsPanel, CommentsProvider, ReviewList } from './index.js';
import type { Thread } from './api.js';

const TEXT = 'Use an inside bend radius of at least 1t.';

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't1',
  app: 'practice',
  target: { type: 'item', id: 'PR-SM-001', rev: 'A' },
  anchor: { field: 'statement', quote: 'inside bend radius', prefix: 'Use an ', suffix: ' of at', start: 7 },
  status: 'open',
  resolution: null,
  created_by: 'u1',
  created_at: '2026-11-27T09:00:00Z',
  comments: [{ id: 'c1', author_id: 'u1', author_name: 'Peet', body: 'Too tight for 6082', created_at: '2026-11-27T09:00:00Z', edited_at: null, deleted: false }],
  ...over,
});

type Call = { method: string; url: string; body?: unknown };

const mockApi = (opts: { admin?: boolean; threads?: Thread[] } = {}) => {
  const calls: Call[] = [];
  let threads = opts.threads ?? [thread()];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status });
    const path = new URL(url).pathname;
    if (path.endsWith('/me')) return ok({ id: 'u2', name: 'Anna', can_comment: true, is_admin: Boolean(opts.admin) });
    if (path.endsWith('/threads') && method === 'GET') {
      const status = new URL(url).searchParams.get('status');
      return ok(status === 'open' ? threads.filter(t => t.status === 'open') : threads);
    }
    if (path.endsWith('/threads') && method === 'POST') {
      const t = thread({ id: 't2', anchor: body.anchor, comments: [{ ...thread().comments[0], id: 'c2', author_id: 'u2', author_name: 'Anna', body: body.body }] });
      threads = [...threads, t];
      return ok(t, 201);
    }
    if (method === 'PATCH' && path.includes('/threads/')) {
      const t = { ...threads[0], status: body.status, resolution: { note: body.note, rev: body.resolved_rev, by_name: 'Anna', at: '2026-11-27T10:00:00Z' } };
      threads = [t];
      return ok(t);
    }
    return new Response(JSON.stringify({ success: false, message: 'nope' }), { status: 404 });
  }) as unknown as typeof fetch;
  return calls;
};

const target = { type: 'item', id: 'PR-SM-001', rev: 'A' };

const Page = () => (
  <CommentsProvider apiUrl="https://comments.test/api" app="practice" getToken={() => 'tok'}>
    <p data-testid="text">
      <CommentableText target={target} field="statement" text={TEXT} />
    </p>
    <CommentsPanel target={target} />
  </CommentsProvider>
);

describe('comments components', () => {
  it('highlights an open thread in the text and shows it in the panel', async () => {
    const calls = mockApi();
    render(<Page />);
    const mark = await screen.findByText('inside bend radius', { selector: 'mark' });
    expect(screen.getByTestId('text')).toHaveTextContent(TEXT);
    expect(screen.getByText('Too tight for 6082')).toBeInTheDocument();
    expect(calls.find(c => c.url.includes('/threads?'))!.url).toContain('target_id=PR-SM-001');

    fireEvent.click(mark);
    expect(mark).toHaveClass('slc-mark--focused');
    expect(document.querySelector('[data-slc-thread="t1"]')).toHaveClass('slc-thread--focused');
    // Only admins see the controls for closing threads.
    expect(screen.queryByText('Incorporated')).not.toBeInTheDocument();
  });

  it('flags a thread whose text has changed', async () => {
    mockApi({ threads: [thread({ anchor: { field: 'statement', quote: 'outside radius', prefix: '', suffix: '', start: 0 } })] });
    render(<Page />);
    expect(await screen.findByText(/This text has changed/)).toBeInTheDocument();
  });

  it('starts a comment on the whole target', async () => {
    const calls = mockApi({ threads: [] });
    render(<Page />);
    await screen.findByText(/No open comments/);
    fireEvent.change(screen.getByLabelText('Comment on this page'), { target: { value: 'Needs a figure' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comment' })));
    const post = calls.find(c => c.method === 'POST')!;
    expect(post.body).toMatchObject({ app: 'practice', target_type: 'item', target_id: 'PR-SM-001', target_rev: 'A', anchor: null, body: 'Needs a figure' });
    expect(await screen.findByText('Needs a figure')).toBeInTheDocument();
  });

  it('lets an admin mark a thread incorporated from the review list', async () => {
    const calls = mockApi({ admin: true });
    render(
      <CommentsProvider apiUrl="https://comments.test/api" app="practice" getToken={() => 'tok'}>
        <ReviewList renderTarget={t => <a href={`/i/${t.id}`}>{t.id}</a>} />
      </CommentsProvider>
    );
    expect(await screen.findByRole('link', { name: 'PR-SM-001' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Incorporated' }));
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'B' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mark incorporated' })));
    expect(calls.find(c => c.method === 'PATCH')!.body).toEqual({ status: 'incorporated', note: null, resolved_rev: 'B' });
    await waitFor(() => expect(screen.getByText(/Nothing waiting/)).toBeInTheDocument());
  });

  it('retries once with a fresh token when the old one has expired', async () => {
    let n = 0;
    const tokens: (string | null)[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      tokens.push((init?.headers as Record<string, string>).Authorization ?? null);
      n++;
      if (n === 1) return new Response(JSON.stringify({ success: false, code: 'TOKEN_EXPIRED' }), { status: 401 });
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const { createClient } = await import('./api');
    let token = 'old';
    const client = createClient({ apiUrl: 'https://c.test/api', app: 'practice', getToken: () => token, refreshToken: async () => (token = 'new') });
    await expect(client.threads(target)).resolves.toEqual([]);
    expect(tokens).toEqual(['Bearer old', 'Bearer new']);
  });
});
