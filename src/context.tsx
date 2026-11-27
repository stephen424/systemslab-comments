import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { TextAnchor } from './anchor.js';
import { ClientConfig, CommentsClient, createClient, Me, Target, Thread } from './api.js';
import type { Person } from './mentions.js';

export const targetKey = (t: Pick<Target, 'type' | 'id'>) => `${t.type}:${t.id}`;

interface Draft {
  key: string;
  anchor: TextAnchor;
}

interface CommentsState {
  client: CommentsClient;
  me: Me | null;
  /** Everyone who can be mentioned. */
  people: Person[];
  threads: Record<string, Thread[] | undefined>;
  errors: Record<string, string | undefined>;
  load: (target: Target) => Promise<void>;
  /** Replaces one thread (or removes it, with null) in whatever target it belongs to. */
  put: (key: string, thread: Thread | null, id?: string) => void;
  /** Bumped after every change, so counts and review lists know to reload. */
  version: number;
  bump: () => void;
  focused: string | null;
  focus: (id: string | null) => void;
  draft: Draft | null;
  setDraft: (draft: Draft | null) => void;
  /** For each target and field on screen, the threads whose quote was found in the text. */
  located: Record<string, Record<string, string[]>>;
  report: (key: string, field: string, ids: string[]) => void;
}

const Ctx = createContext<CommentsState | null>(null);

export const useCommentsState = (): CommentsState => {
  const state = useContext(Ctx);
  if (!state) throw new Error('Comments components must be inside <CommentsProvider>');
  return state;
};

export interface CommentsProviderProps extends ClientConfig {
  children: ReactNode;
}

/** Holds the comments client and what is loaded. Put it once near the top of the app, inside sign-in. */
export function CommentsProvider({ children, apiUrl, app, getToken, refreshToken }: CommentsProviderProps) {
  // The token callbacks may be new functions on every render; the client always calls the latest ones.
  const callbacks = useRef({ getToken, refreshToken });
  callbacks.current = { getToken, refreshToken };
  const client = useMemo(
    () =>
      createClient({
        apiUrl,
        app,
        getToken: () => callbacks.current.getToken(),
        refreshToken: () => (callbacks.current.refreshToken ? callbacks.current.refreshToken() : Promise.reject(new Error('No refresh'))),
      }),
    [apiUrl, app]
  );
  const [me, setMe] = useState<Me | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [threads, setThreads] = useState<Record<string, Thread[] | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [version, setVersion] = useState(0);
  const [focused, focus] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [located, setLocated] = useState<Record<string, Record<string, string[]>>>({});

  useEffect(() => {
    client.me().then(setMe, () => setMe(null));
    client.people().then(setPeople, () => setPeople([]));
  }, [client]);

  const load = useCallback(
    async (target: Target) => {
      const key = targetKey(target);
      try {
        const list = await client.threads(target);
        setThreads(prev => ({ ...prev, [key]: list }));
        setErrors(prev => ({ ...prev, [key]: undefined }));
      } catch (error) {
        setErrors(prev => ({ ...prev, [key]: error instanceof Error ? error.message : 'Comments could not be loaded' }));
      }
    },
    [client]
  );

  const put = useCallback((key: string, thread: Thread | null, id?: string) => {
    setThreads(prev => {
      const list = prev[key] ?? [];
      const target = thread?.id ?? id;
      const rest = list.filter(t => t.id !== target);
      if (!thread) return { ...prev, [key]: rest };
      const at = list.findIndex(t => t.id === thread.id);
      const next = at === -1 ? [...list, thread] : list.map(t => (t.id === thread.id ? thread : t));
      return { ...prev, [key]: next };
    });
  }, []);

  const bump = useCallback(() => setVersion(v => v + 1), []);

  const report = useCallback((key: string, field: string, ids: string[]) => {
    setLocated(prev => {
      const old = prev[key]?.[field];
      if (old && old.length === ids.length && old.every((id, i) => id === ids[i])) return prev;
      return { ...prev, [key]: { ...prev[key], [field]: ids } };
    });
  }, []);

  const value = useMemo<CommentsState>(
    () => ({ client, me, people, threads, errors, load, put, version, bump, focused, focus, draft, setDraft, located, report }),
    [client, me, people, threads, errors, load, put, version, bump, focused, draft, located, report]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The threads on one target, loaded on first use. */
export const useThreads = (target: Target) => {
  const state = useCommentsState();
  const key = targetKey(target);
  const { load } = state;
  useEffect(() => {
    void load({ type: target.type, id: target.id });
  }, [load, target.type, target.id]);
  return { key, threads: state.threads[key], error: state.errors[key] };
};

/** Open threads per target id, for badges in contents and lists. Reloads after any change. */
export const useOpenCounts = (targetType?: string): Record<string, number> => {
  const { client, version } = useCommentsState();
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    client.counts(targetType).then(
      rows => live && setCounts(Object.fromEntries(rows.map(r => [targetType ? r.id : `${r.type}:${r.id}`, r.open]))),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [client, targetType, version]);
  return counts;
};
