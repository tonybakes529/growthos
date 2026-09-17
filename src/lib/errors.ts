export type ErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'validation' | 'internal';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

type PgLikeError = { code?: string | null; message: string; details?: string | null; hint?: string | null };

/** Maps Postgres / PostgREST errors raised by RLS and the app.* workflows to AppError. */
export function fromDbError(err: PgLikeError): AppError {
  switch (err.code) {
    case '42501': // insufficient_privilege (RLS, assert_permission, anti-elevation)
      return new AppError('forbidden', err.message, err.details);
    case 'P0002': // no_data_found
    case 'PGRST116': // .single() returned no rows (usually RLS-hidden)
      return new AppError('not_found', err.message === 'JSON object requested, multiple (or no) rows returned' ? 'Not found' : err.message);
    case '28000':
      return new AppError('unauthenticated', err.message);
    case '23505': {
      const m = /Key \((.+)\)=\((.+)\) already exists/.exec(err.details ?? '');
      return new AppError('conflict', m ? `${m[1]!.replace(/_/g, ' ')} "${m[2]}" is already taken` : 'That already exists');
    }
    case '23503':
    case '23514':
    case '22P02':
    case '22023':
    case 'P0001': // plain RAISE EXCEPTION from workflows: user-facing business rule
      return new AppError('validation', err.message, err.details);
    default:
      return new AppError('internal', 'Database error', { code: err.code, message: err.message });
  }
}

type DbResponse = { data: unknown; error: PgLikeError | null };
type SuccessData<R extends DbResponse> = Extract<R, { error: null }> extends never ? R['data'] : Extract<R, { error: null }>['data'];

/** Throws a mapped AppError on failure; otherwise returns the data exactly as typed by supabase-js. */
export function unwrap<R extends DbResponse>(res: R): SuccessData<R> {
  if (res.error) throw fromDbError(res.error);
  return res.data as SuccessData<R>;
}

/** Same as unwrap, but a null result (e.g. hidden by RLS) becomes a not_found error. */
export function unwrapRequired<R extends DbResponse>(res: R, what = 'Record'): NonNullable<SuccessData<R>> {
  const data = unwrap(res);
  if (data === null || data === undefined) throw new AppError('not_found', `${what} not found`);
  return data as NonNullable<SuccessData<R>>;
}
