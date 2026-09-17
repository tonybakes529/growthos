'use client';

import { useEffect, useRef, useState } from 'react';

type Value = string | number | boolean | string[] | null;

/**
 * Saves each answer as the customer moves on from it, so closing the tab loses nothing.
 * One field per request: a single invalid value (say a half-typed link) cannot block the rest from saving.
 * Without JavaScript the "Save and finish later" button does the same job.
 */
export function OnboardingAutosave({ formId, save }: { formId: string; save: (questionId: string, value: Value) => Promise<{ ok: boolean; message?: string }> }) {
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' });
  const pending = useRef(0);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const onChange = async (e: Event) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (!el.name?.startsWith('q_')) return;
      const id = el.name.slice(2);
      let value: Value;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') {
        const group = Array.from(form.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${CSS.escape(el.name)}"]`));
        value = group.length > 1 || el.value !== 'on' ? group.filter((b) => b.checked).map((b) => b.value) : el.checked ? true : null;
        if (Array.isArray(value) && value.length === 0) value = null;
      } else {
        value = el.value.trim() === '' ? null : el.value;
      }
      pending.current++;
      setState({ kind: 'saving' });
      const res = await save(id, value).catch(() => ({ ok: false, message: 'Could not save. Check your connection.' }));
      if (--pending.current > 0) return;
      setState(res.ok ? { kind: 'saved' } : { kind: 'error', message: res.message });
    };
    form.addEventListener('change', onChange);
    return () => form.removeEventListener('change', onChange);
  }, [formId, save]);

  return (
    <p className={`autosave ${state.kind}`} role="status" aria-live="polite">
      {state.kind === 'saving' ? 'Saving…' : state.kind === 'saved' ? 'Progress saved' : state.kind === 'error' ? state.message : 'Your answers save as you go'}
    </p>
  );
}
