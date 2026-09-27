'use client';

import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';

/**
 * The "⋯" menu that sits next to the thing it acts on, instead of a separate management strip
 * somewhere else on the page.
 *
 * It holds ordinary server-action forms and links, so every item keeps whatever permission check the
 * page already applied: an item nobody may use is simply never passed in, and a menu with no items
 * does not render at all. It deliberately does not close when you click inside, so an item can carry
 * a small form (renaming a tab, say) without the menu vanishing mid-type.
 *
 * The open menu is positioned against the viewport rather than against the button. Most of these sit
 * in a table inside `.tablewrap`, which scrolls sideways and therefore clips anything overflowing it:
 * positioned the obvious way, a menu on the last row was cut off at the edge of the card and its
 * first item could not be read or clicked.
 */
export function Menu({ children, label = 'More actions', align = 'end' }: {
  children: ReactNode; label?: string; align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<CSSProperties | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const h = list.current?.offsetHeight ?? 0;
    const below = window.innerHeight - b.bottom - 8;
    // open upwards when the menu is taller than the room under the button and there is more room over it
    const up = h > below && b.top - 8 > below;
    setBox({
      top: up ? Math.max(8, b.top - h - 4) : b.bottom + 4,
      ...(align === 'end'
        ? { right: Math.max(8, window.innerWidth - b.right) }
        : { left: Math.max(8, b.left) }),
    });
  }, [align]);

  // measured before paint, so the menu never appears in the wrong place first
  useLayoutEffect(() => { if (open) place(); else setBox(null); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // capture, so scrolling the table underneath moves the menu with its button
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, place]);

  return (
    <div className="menu" ref={wrap}>
      <button type="button" ref={btn} className="menu-btn" aria-label={label} aria-haspopup="menu"
              aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">···</span>
      </button>
      {open && (
        <div className={`menu-list ${align}`} id={id} role="menu" ref={list}
             style={{ ...box, visibility: box ? undefined : 'hidden' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** A heading inside a menu, for grouping or for a one-line explanation under an item. */
export function MenuNote({ children }: { children: ReactNode }) {
  return <p className="menu-note">{children}</p>;
}
