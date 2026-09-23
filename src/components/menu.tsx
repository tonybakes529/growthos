'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * The "⋯" menu that sits next to the thing it acts on, instead of a separate management strip
 * somewhere else on the page.
 *
 * It holds ordinary server-action forms and links, so every item keeps whatever permission check the
 * page already applied: an item nobody may use is simply never passed in, and a menu with no items
 * does not render at all. It deliberately does not close when you click inside, so an item can carry
 * a small form (renaming a tab, say) without the menu vanishing mid-type.
 */
export function Menu({ children, label = 'More actions', align = 'end' }: {
  children: ReactNode; label?: string; align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  return (
    <div className="menu" ref={wrap}>
      <button type="button" className="menu-btn" aria-label={label} aria-haspopup="menu"
              aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">···</span>
      </button>
      {open && <div className={`menu-list ${align}`} id={id} role="menu">{children}</div>}
    </div>
  );
}

/** A heading inside a menu, for grouping or for a one-line explanation under an item. */
export function MenuNote({ children }: { children: ReactNode }) {
  return <p className="menu-note">{children}</p>;
}
