import { redirect } from 'next/navigation';

/** Customers became Students. Old links, bookmarks and sent emails keep working. */
export default async function CustomerMoved({ params }: { params: Promise<{ orgSlug: string; customerId: string }> }) {
  const { orgSlug, customerId } = await params;
  redirect(`/w/${orgSlug}/students/${customerId}`);
}
