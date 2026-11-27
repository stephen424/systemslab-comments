import { decode, encode, mentionQuery, parts, suggest } from './mentions.js';

const ANNA = { id: '22222222-2222-2222-2222-222222222222', name: 'Anna Smith' };
const AN = { id: '33333333-3333-3333-3333-333333333333', name: 'Ann' };

describe('mentions', () => {
  it('saves picked people as mentions, longest name first, and only where still typed', () => {
    const body = encode({ text: ' @Anna Smith and @Ann, please look. Not Bob@Ann.  ', picked: [AN, ANNA] });
    expect(body).toBe(`@[Anna Smith](${ANNA.id}) and @[Ann](${AN.id}), please look. Not Bob@Ann.`);
    expect(encode({ text: 'nobody here', picked: [ANNA] })).toBe('nobody here');
  });

  it('turns a saved body back into editable text and into parts to show', () => {
    const body = `Hi @[Anna Smith](${ANNA.id})!`;
    expect(decode(body)).toEqual({ text: 'Hi @Anna Smith!', picked: [ANNA] });
    expect(parts(body)).toEqual([{ text: 'Hi ' }, { mention: ANNA }, { text: '!' }]);
    expect(encode(decode(body))).toBe(body);
  });

  it('notices an @ being typed and suggests matching people', () => {
    expect(mentionQuery('ask @An', 7)).toEqual({ start: 4, query: 'An' });
    expect(mentionQuery('ask @', 5)).toEqual({ start: 4, query: '' });
    expect(mentionQuery('mail a@b', 8)).toBeNull();
    expect(mentionQuery('ask @Anna.', 10)).toBeNull();
    expect(suggest([ANNA, AN, { id: 'x', name: 'Joanne' }], 'ann').map(p => p.name)).toEqual(['Ann', 'Anna Smith', 'Joanne']);
    expect(suggest([ANNA, AN], 'smi').map(p => p.name)).toEqual(['Anna Smith']);
  });
});
