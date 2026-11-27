import { KeyboardEvent, useRef, useState } from 'react';
import { useCommentsState } from './context.js';
import { DraftText, mentionQuery, Person, suggest } from './mentions.js';

export interface MentionTextareaProps {
  value: DraftText;
  onChange: (value: DraftText) => void;
  label: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  /** Ctrl/Cmd+Enter. */
  onSubmit?: () => void;
}

/** A comment box where typing @ offers the Systemslab.ai people to mention. */
export function MentionTextarea({ value, onChange, label, placeholder, rows = 3, autoFocus, onSubmit }: MentionTextareaProps) {
  const { people } = useCommentsState();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const options = query ? suggest(people, query.query) : [];

  const update = (text: string, caret: number) => {
    onChange({ ...value, text });
    setQuery(mentionQuery(text, caret));
    setActive(0);
  };

  const pick = (person: Person) => {
    if (!query) return;
    const caret = ref.current?.selectionStart ?? value.text.length;
    const inserted = `@${person.name} `;
    const text = value.text.slice(0, query.start) + inserted + value.text.slice(caret);
    onChange({ text, picked: [...value.picked.filter(p => p.id !== person.id), person] });
    setQuery(null);
    const at = query.start + inserted.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (options.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(i => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(options[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="slc-mention-box">
      <textarea
        ref={ref}
        aria-label={label}
        placeholder={placeholder}
        value={value.text}
        rows={rows}
        autoFocus={autoFocus}
        onChange={e => update(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        aria-autocomplete="list"
        aria-expanded={options.length > 0}
      />
      {options.length > 0 && (
        <ul className="slc-suggest" role="listbox" aria-label="People">
          {options.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'slc-suggest--on' : undefined}
              onMouseDown={e => {
                e.preventDefault();
                pick(p);
              }}
            >
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
