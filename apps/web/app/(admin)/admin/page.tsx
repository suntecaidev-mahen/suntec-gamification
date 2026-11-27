import { EmptyState } from '@suntec/ui';

export const metadata = { title: 'Admin Control Panel' };

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <EmptyState
        title="Admin Control Panel"
        description="This area is built in Phase 3. The database foundation is ready."
      />
    </main>
  );
}
