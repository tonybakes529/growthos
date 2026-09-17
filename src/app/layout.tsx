import type { ReactNode } from 'react';
import { Public_Sans } from 'next/font/google';
import './globals.css';
import { getSession } from '@/lib/auth/session';
import { endImpersonation } from '@/modules/impersonation/actions';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

// Self-hosted at build time: no render-blocking request to fonts.googleapis.com, no layout shift.
const publicSans = Public_Sans({ subsets: ['latin'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-sans' });

export const metadata = { title: 'Growth OS' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession().catch(() => null);
  const imp = session?.ctx.impersonation;
  return (
    <html lang="en" className={publicSans.variable}>
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
