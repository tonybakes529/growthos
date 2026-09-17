import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/action';

/** Server-action helper: revalidate, then bounce back with a success or error message. */
export function done<T>(path: string, res: ActionResult<T>, ok: string | ((d: T) => string)): never {
  revalidatePath(path);
  if (!res.ok) {
    const detail = res.error.fieldErrors ? ` (${Object.keys(res.error.fieldErrors).join(', ')})` : '';
    redirect(`${path}?err=${encodeURIComponent(res.error.message + detail)}`);
  }
  redirect(`${path}?msg=${encodeURIComponent(typeof ok === 'function' ? ok(res.data) : ok)}`);
}
