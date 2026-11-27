/**
 * Mentions. In the box people type "@Anna Smith"; the comment is saved with each mention as
 * @[Anna Smith](user id), so the service knows exactly who was meant even if two people share a name.
 */

export interface Person {
  id: string;
  name: string;
}

/** What is being typed: the text as shown, and the people picked from the list while typing it. */
export interface DraftText {
  text: string;
  picked: Person[];
}

export const emptyDraft = (): DraftText => ({ text: '', picked: [] });

const TOKEN = /@\[([^\]\n]{1,200})\]\(([0-9a-f-]{36})\)/gi;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body to save: every "@Name" of a picked person that is still in the text becomes a mention. */
export const encode = (draft: DraftText): string => {
  let body = draft.text.trim();
  const people = [...new Map(draft.picked.map(p => [p.id, p])).values()].sort((a, b) => b.name.length - a.name.length);
  for (const p of people) {
    body = body.replace(new RegExp(`(^|[^\\w@\\[])@${escape(p.name)}(?![\\w])`, 'g'), (_m, lead: string) => `${lead}@[${p.name}](${p.id})`);
  }
  return body;
};

/** Back from a saved body to what the box shows, for editing. */
export const decode = (body: string): DraftText => {
  const picked: Person[] = [];
  const text = body.replace(TOKEN, (_m, name: string, id: string) => {
    if (!picked.some(p => p.id === id)) picked.push({ id, name });
    return `@${name}`;
  });
  return { text, picked };
};

export type Part = { text: string } | { mention: Person };

/** A saved body split into plain text and mentions, for showing it. */
export const parts = (body: string): Part[] => {
  const out: Part[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    if (m.index! > last) out.push({ text: body.slice(last, m.index) });
    out.push({ mention: { name: m[1], id: m[2] } });
    last = m.index! + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
};

/** The "@query" being typed just before the caret, if any. */
export const mentionQuery = (text: string, caret: number): { start: number; query: string } | null => {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])@([^\s@][^@\n]{0,40})?$/.exec(before);
  if (!m) return null;
  const query = m[2] ?? '';
  // Stop suggesting once the query has two spaces in a row or ends a sentence.
  if (/\s\s|[.,;:!?]$/.test(query)) return null;
  return { start: before.length - query.length - 1, query };
};

/** People whose name matches the query, best first. */
export const suggest = (people: Person[], query: string, limit = 6): Person[] => {
  const q = query.trim().toLowerCase();
  if (!q) return people.slice(0, limit);
  const scored = people
    .map(p => {
      const name = p.name.toLowerCase();
      const score = name.startsWith(q) ? 0 : name.split(/\s+/).some(w => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : 3;
      return { p, score };
    })
    .filter(x => x.score < 3)
    .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name));
  return scored.slice(0, limit).map(x => x.p);
};
