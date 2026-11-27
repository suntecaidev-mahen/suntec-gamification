import { EmptyState } from '@suntec/ui';

export const metadata = { title: 'In-app Play & Win' };

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <EmptyState
        title="In-app Play & Win"
        description="This area is built in Phase 4. The database foundation is ready."
      />
    </main>
  );
}
