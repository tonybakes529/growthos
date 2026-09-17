import { z } from 'zod';
import { AppError, type ErrorCode } from './errors';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[] | undefined> } };

/**
 * Wraps a server action: validates input with zod, converts thrown errors into a
 * serializable result, and never leaks internal error detail to the browser.
 */
export function action<S extends z.ZodTypeAny, T>(schema: S, handler: (input: z.output<S>) => Promise<T>) {
  return async (raw: z.input<S>): Promise<ActionResult<T>> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'validation', message: 'Invalid input', fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined> },
      };
    }
    try {
      return { ok: true, data: await handler(parsed.data) };
    } catch (e) {
      if (e instanceof AppError) {
        if (e.code === 'internal') console.error('[action]', e.details ?? e);
        return { ok: false, error: { code: e.code, message: e.code === 'internal' ? 'Something went wrong' : e.message } };
      }
      console.error('[action] unexpected', e);
      return { ok: false, error: { code: 'internal', message: 'Something went wrong' } };
    }
  };
}

// Shared input fragments
export const zId = z.string().uuid();
export const zSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'lowercase letters, numbers and dashes');
export const zOrg = z.object({ orgSlug: zSlug });
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
