/**
 * Anchoring a comment to text that may later change. A thread keeps the quoted text, a few characters
 * either side and where it started; when the text is shown again the quote is looked for, preferring the
 * occurrence whose surroundings and position match best. If the quote is gone, the thread has lost its
 * place, and the panel says so instead of guessing.
 */

export interface TextAnchor {
  field: string;
  quote: string;
  prefix: string;
  suffix: string;
  start: number | null;
}

export interface Range {
  start: number;
  end: number;
}

export const CONTEXT_CHARS = 32;

/** The anchor for text[start, end), with surrounding whitespace left out of the quote. Null if nothing but whitespace is selected. */
export const makeAnchor = (field: string, text: string, start: number, end: number): TextAnchor | null => {
  let s = Math.max(0, Math.min(start, end));
  let e = Math.min(text.length, Math.max(start, end));
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (s === e) return null;
  return {
    field,
    quote: text.slice(s, e),
    prefix: text.slice(Math.max(0, s - CONTEXT_CHARS), s),
    suffix: text.slice(e, e + CONTEXT_CHARS),
    start: s,
  };
};

const commonSuffix = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};

const commonPrefix = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/** Where the anchor's quote is in text now, or null if it is no longer there. */
export const locate = (text: string, anchor: Pick<TextAnchor, 'quote' | 'prefix' | 'suffix' | 'start'>): Range | null => {
  const { quote } = anchor;
  if (!quote) return null;
  let best: { at: number; score: number } | null = null;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    const before = text.slice(Math.max(0, at - anchor.prefix.length), at);
    const after = text.slice(at + quote.length, at + quote.length + anchor.suffix.length);
    const distance = anchor.start === null ? 0 : Math.abs(at - anchor.start);
    // Matching context outweighs position: one matching character is worth 100 characters of drift.
    const score = (commonSuffix(before, anchor.prefix) + commonPrefix(after, anchor.suffix)) * 100 - distance;
    if (!best || score > best.score) best = { at, score };
  }
  return best ? { start: best.at, end: best.at + quote.length } : null;
};

export interface Segment {
  text: string;
  start: number;
  /** The highlights covering this piece, in the order they were given. */
  ids: string[];
}

/** Splits text into pieces at every highlight edge, so overlapping highlights can each be shown. */
export const segments = (text: string, ranges: (Range & { id: string })[]): Segment[] => {
  const cuts = new Set<number>([0, text.length]);
  for (const r of ranges) {
    cuts.add(Math.max(0, Math.min(text.length, r.start)));
    cuts.add(Math.max(0, Math.min(text.length, r.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [s, e] = [points[i], points[i + 1]];
    if (s === e) continue;
    out.push({ text: text.slice(s, e), start: s, ids: ranges.filter(r => r.start <= s && r.end >= e).map(r => r.id) });
  }
  return out;
};
