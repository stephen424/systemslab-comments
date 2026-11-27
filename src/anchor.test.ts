import { locate, makeAnchor, segments } from './anchor.js';

const text = 'Use an inside bend radius of at least 1t. For 6082-T6 the inside bend radius is 2t.';

describe('makeAnchor', () => {
  it('records the quote, its surroundings and where it started, without edge whitespace', () => {
    const start = text.indexOf(' inside');
    const a = makeAnchor('statement', text, start, start + ' inside bend radius '.length)!;
    expect(a).toMatchObject({ field: 'statement', quote: 'inside bend radius', start: 7, prefix: 'Use an ' });
    expect(a.suffix.startsWith(' of at least')).toBe(true);
    expect(makeAnchor('statement', text, 3, 4)).toBeNull();
  });
});

describe('locate', () => {
  it('finds the right one of several occurrences by its surroundings', () => {
    const second = text.lastIndexOf('inside bend radius');
    const a = makeAnchor('statement', text, second, second + 18)!;
    expect(locate(text, a)).toEqual({ start: second, end: second + 18 });
  });

  it('follows the quote when text is added before it', () => {
    const a = makeAnchor('statement', text, 7, 25)!;
    const edited = `Always: ${text}`;
    expect(locate(edited, a)).toEqual({ start: 15, end: 33 });
  });

  it('prefers matching surroundings over position', () => {
    const second = text.lastIndexOf('inside bend radius');
    const a = makeAnchor('statement', text, second, second + 18)!;
    const edited = text.replace('Use an inside bend radius of at least 1t. ', '');
    expect(locate(edited, a)?.start).toBe(edited.indexOf('inside bend radius'));
  });

  it('gives null once the quote is gone', () => {
    const a = makeAnchor('statement', text, 7, 25)!;
    expect(locate(text.split('inside bend radius').join('bend radius'), a)).toBeNull();
  });
});

describe('segments', () => {
  it('splits text at every highlight edge, overlaps included', () => {
    expect(segments('abcdef', [{ id: 'x', start: 1, end: 4 }, { id: 'y', start: 3, end: 5 }])).toEqual([
      { text: 'a', start: 0, ids: [] },
      { text: 'bc', start: 1, ids: ['x'] },
      { text: 'd', start: 3, ids: ['x', 'y'] },
      { text: 'e', start: 4, ids: ['y'] },
      { text: 'f', start: 5, ids: [] },
    ]);
    expect(segments('abc', [])).toEqual([{ text: 'abc', start: 0, ids: [] }]);
  });
});
