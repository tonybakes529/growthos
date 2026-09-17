import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { Database } from './database.types';

/** Refreshes the auth session cookie on every request (per @supabase/ssr guidance). */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );
  // getClaims() refreshes an expired session like getUser() does, but verifies the JWT locally
  // against the project's cached JWKS instead of calling the Auth server on every request
  // (middleware also runs for every <Link> prefetch, so that call dominated page latency).
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims.sub;

  const path = request.nextUrl.pathname;
  const isProtected = path.startsWith('/admin') || path.startsWith('/w/') || path.startsWith('/start/');
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }
  return response;
}
