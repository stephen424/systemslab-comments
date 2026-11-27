import { ElementType, useEffect, useMemo, useRef, useState } from 'react';
import { locate, makeAnchor, segments } from './anchor.js';
import type { Target } from './api.js';
import { targetKey, useCommentsState, useThreads } from './context.js';

export interface CommentableTextProps {
  target: Target;
  /** Which part of the target this text is, e.g. 'statement' or 'table.2.1'. Stable across edits. */
  field: string;
  text: string;
  /** The element to render, 'span' by default. */
  as?: ElementType;
  className?: string;
}

/** Offset of (node, offset) within root's text, counting only text nodes. */
const textOffset = (root: Node, node: Node, offset: number): number => {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
};

/**
 * Plain text that people can select to start a comment. Open threads on it are highlighted; clicking a
 * highlight opens its thread in the panel.
 */
export function CommentableText({ target, field, text, as: Tag = 'span', className }: CommentableTextProps) {
  const state = useCommentsState();
  const { threads, key } = useThreads(target);
  const ref = useRef<HTMLElement>(null);
  const [button, setButton] = useState<{ top: number; left: number; start: number; end: number } | null>(null);

  const ranges = useMemo(() => {
    const out: { id: string; start: number; end: number }[] = [];
    for (const t of threads ?? []) {
      if (t.status !== 'open' || !t.anchor || t.anchor.field !== field) continue;
      const r = locate(text, t.anchor);
      if (r) out.push({ id: t.id, ...r });
    }
    return out;
  }, [threads, field, text]);

  const { report } = state;
  const located = ranges.map(r => r.id).join(',');
  useEffect(() => {
    if (threads) report(key, field, located ? located.split(',') : []);
  }, [report, key, field, located, threads]);

  const draft = state.draft?.key === targetKey(target) && state.draft.anchor.field === field ? locate(text, state.draft.anchor) : null;
  const all = draft ? [...ranges, { id: '__draft', ...draft }] : ranges;

  // Hide the button when the selection goes away or moves elsewhere.
  useEffect(() => {
    if (!button) return;
    const onChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !ref.current?.contains(sel.anchorNode)) setButton(null);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [button]);

  const onMouseUp = () => {
    if (!state.me?.can_comment) return;
    const sel = window.getSelection();
    const root = ref.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const start = textOffset(root, range.startContainer, range.startOffset);
    const end = textOffset(root, range.endContainer, range.endOffset);
    if (!makeAnchor(field, text, start, end)) return;
    const rect = range.getBoundingClientRect();
    setButton({ top: rect.bottom + 6, left: rect.left + rect.width / 2, start, end });
  };

  const startComment = () => {
    if (!button) return;
    const anchor = makeAnchor(field, text, button.start, button.end);
    if (anchor) state.setDraft({ key: targetKey(target), anchor });
    state.focus('__draft');
    window.getSelection()?.removeAllRanges();
    setButton(null);
  };

  return (
    <Tag ref={ref} className={className} onMouseUp={onMouseUp} onKeyUp={onMouseUp}>
      {segments(text, all).map(seg => {
        if (seg.ids.length === 0) return seg.text;
        const isDraft = seg.ids.includes('__draft');
        const real = seg.ids.filter(id => id !== '__draft');
        const focused = seg.ids.includes(state.focused ?? '');
        return (
          <mark
            key={seg.start}
            className={`slc-mark${focused ? ' slc-mark--focused' : ''}${isDraft && real.length === 0 ? ' slc-mark--draft' : ''}`}
            data-slc-threads={real.join(' ')}
            onClick={real.length ? () => state.focus(real.includes(state.focused ?? '') ? real[(real.indexOf(state.focused!) + 1) % real.length] : real[0]) : undefined}
          >
            {seg.text}
          </mark>
        );
      })}
      {button && (
        <button
          type="button"
          className="slc-add"
          style={{ top: button.top, left: button.left }}
          onMouseDown={e => e.preventDefault()}
          onClick={startComment}
        >
          Comment
        </button>
      )}
    </Tag>
  );
}
