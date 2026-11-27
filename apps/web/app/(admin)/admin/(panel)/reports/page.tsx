import { EmptyState } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { PageHeader } from '@/components/admin/ui';

export const metadata = { title: 'Reports' };

export default async function ReportsPage() {
  await requireStaff('reports.read');
  return (
    <>
      <PageHeader title="Reports" description="Campaign performance, engagement, rewards, missions, retention and fraud reports with CSV/Excel export." />
      <EmptyState title="Reports arrive in Phase 5" description="The dashboard already shows today’s KPIs. Phase 5 adds the 10 reports from the brief, date/campaign filters, exports and Power BI-ready daily rollups." />
    </>
  );
}
