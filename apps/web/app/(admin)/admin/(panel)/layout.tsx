import type { Metadata } from 'next';
import type { Permission } from '@suntec/core';
import { Alert } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { signOut } from '@/lib/admin/actions';
import { Sidebar, type NavGroup } from '@/components/admin/Sidebar';
import { isSupabaseConfigured } from '@/lib/env';

export const metadata: Metadata = { title: { default: 'Admin', template: '%s · Play & Win Admin' } };
export const dynamic = 'force-dynamic';

const NAV: { title: string; items: { href: string; label: string; perm: Permission[] }[] }[] = [
  { title: 'Overview', items: [{ href: '/admin', label: 'Dashboard', perm: ['reports.read', 'campaigns.read'] }] },
  {
    title: 'Engagement',
    items: [
      { href: '/admin/r/campaigns', label: 'Campaigns', perm: ['campaigns.read'] },
      { href: '/admin/r/games', label: 'Games', perm: ['campaigns.read'] },
      { href: '/admin/r/missions', label: 'Missions', perm: ['campaigns.read'] },
      { href: '/admin/r/checkin_programs', label: 'Daily check-in', perm: ['campaigns.read'] },
      { href: '/admin/r/checkin_streak_rules', label: 'Streak ladder', perm: ['campaigns.read'] },
      { href: '/admin/r/qr_codes', label: 'QR codes', perm: ['campaigns.read'] },
    ],
  },
  {
    title: 'Rewards',
    items: [
      { href: '/admin/r/rewards', label: 'Rewards & inventory', perm: ['rewards.read'] },
      { href: '/admin/r/reward_categories', label: 'Categories', perm: ['rewards.read'] },
      { href: '/admin/transactions', label: 'Reward transactions', perm: ['rewards.read', 'customers.read'] },
      { href: '/admin/r/merchants', label: 'Merchants', perm: ['campaigns.read'] },
    ],
  },
  {
    title: 'Audience',
    items: [
      { href: '/admin/customers', label: 'Customers', perm: ['customers.read'] },
      { href: '/admin/fraud', label: 'Fraud signals', perm: ['customers.read'] },
      { href: '/admin/test-links', label: 'In-app test links', perm: ['customers.act'] },
      { href: '/admin/r/segments', label: 'Segments', perm: ['campaigns.read'] },
      { href: '/admin/r/eligibility_rules', label: 'Eligibility rules', perm: ['campaigns.read'] },
      { href: '/admin/r/notification_templates', label: 'Notifications', perm: ['campaigns.read'] },
    ],
  },
  { title: 'Insights', items: [{ href: '/admin/reports', label: 'Reports', perm: ['reports.read'] }] },
  {
    title: 'Administration',
    items: [
      { href: '/admin/staff', label: 'Staff & roles', perm: ['staff.manage'] },
      { href: '/admin/api-clients', label: 'API clients', perm: ['api_clients.manage'] },
      { href: '/admin/audit', label: 'Audit log', perm: ['audit.read', 'audit.read_own'] },
      { href: '/admin/settings', label: 'Settings', perm: ['settings.manage'] },
    ],
  },
];

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <Alert tone="warning" title="Supabase is not configured">
          Copy .env.example to apps/web/.env.local and fill in your Supabase keys (see SETUP.md), then restart the server.
        </Alert>
      </main>
    );
  }
  const staff = await requireStaff();
  const groups: NavGroup[] = NAV.map((g) => ({ title: g.title, items: g.items.filter((i) => i.perm.some((p) => staff.can(p))) })).filter((g) => g.items.length > 0);
  return (
    <div className="min-h-dvh bg-surface-muted lg:flex">
      <Sidebar groups={groups} user={{ name: staff.displayName, roles: staff.roles.map((r) => r.replace(/_/g, ' ')).join(', ') }} signOut={signOut} />
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-8">
        {children}
      </main>
    </div>
  );
}
