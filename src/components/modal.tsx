'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A button that opens a centred dialog. Native <dialog>, so it needs no library, traps focus,
 * closes on Escape, and the form inside is an ordinary server-action form.
 * `open` forces it open on load, used to bring a failed submission back up with its error.
 */
export function Modal({ label, title, children, primary, open, small }: {
  label: string; title: string; children: ReactNode; primary?: boolean; open?: boolean; small?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && ref.current && !ref.current.open) ref.current.showModal(); }, [open]);
  return (
    <>
      <button type="button" className={`btn${primary ? ' primary' : ''}${small ? ' small' : ''}`} onClick={() => ref.current?.showModal()}>{label}</button>
      <dialog ref={ref} className="modal" onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="modal-body">
          <div className="head" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <button type="button" className="btn small" onClick={() => ref.current?.close()} aria-label="Close">✕</button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
