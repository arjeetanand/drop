import { redirect } from 'next/navigation';

export default async function LegacyDispatchRoute({ searchParams }: { searchParams: Promise<{ letter?: string }> }) {
  const { letter } = await searchParams;
  const query = new URLSearchParams({ mode: 'relay' });
  if (letter) query.set('letter', letter);
  redirect(`/compose?${query.toString()}`);
}
