import type { ReactNode } from 'react';
import './globals.css';
import { getSession } from '@/lib/auth/session';
import { endImpersonation } from '@/modules/impersonation/actions';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export const metadata = { title: 'Growth OS' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession().catch(() => null);
  const imp = session?.ctx.impersonation;
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap" />
      </head>
      <body>
        {imp && (
          <form className="banner" action={async () => { 'use server'; await endImpersonation({}); revalidatePath('/', 'layout'); redirect('/admin/clients'); }}>
            <span>You are viewing as another user ({imp.allow_writes ? 'writes enabled' : 'read-only'}) until {new Date(imp.expires_at).toLocaleTimeString('en-US')}.</span>
            <button className="btn small" type="submit">Stop viewing as</button>
          </form>
        )}
        {children}
      </body>
    </html>
  );
}
