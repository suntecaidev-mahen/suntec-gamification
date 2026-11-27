import Link from 'next/link';
import { Card } from '@suntec/ui';

const entries = [
  { href: '/portal', title: 'Customer Portal', body: 'Play, track missions and view your rewards.' },
  { href: '/embed', title: 'In-app (embed)', body: 'Mobile-first experience loaded inside the Suntec+ app.' },
  { href: '/admin', title: 'Admin Control Panel', body: 'Campaigns, games, rewards, customers and reports.' },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">Suntec+</p>
      <h1 className="mt-2 text-3xl font-bold">Play &amp; Win</h1>
      <p className="mt-2 text-text-muted">Gamification &amp; customer engagement platform.</p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-3">
        {entries.map((e) => (
          <li key={e.href}>
            <Link href={e.href} className="block h-full rounded-lg focus-visible:outline-2">
              <Card className="h-full transition-shadow hover:shadow-md">
                <h2 className="font-semibold text-text">{e.title}</h2>
                <p className="mt-1 text-sm text-text-muted">{e.body}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
