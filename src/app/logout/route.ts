import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Signs out. `next` sends them somewhere other than the login page, e.g. back to an invitation they opened. */
export async function POST(req: Request) {
  const sb = await createClient();
  await sb.auth.signOut();
  const form = await req.formData().catch(() => null);
  const next = String(form?.get('next') ?? '');
  // only relative paths of our own, never an address someone put in the link
  const target = /^\/(?!\/)/.test(next) ? next : '/login';
  return NextResponse.redirect(new URL(target, req.url), { status: 303 });
}
