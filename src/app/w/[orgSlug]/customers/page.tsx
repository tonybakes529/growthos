import { redirect } from 'next/navigation';

/** Customers became Students. Old links, bookmarks and sent emails keep working. */
export default async function CustomersMoved({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') qs.set(k, v);
  const q = qs.toString();
  redirect(`/w/${orgSlug}/students${q ? `?${q}` : ''}`);
}
