import { Alert, Card, Field, Select } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { createEmbedTestLink } from '@/lib/admin/actions';
import { listDemoMembers } from '@/lib/play/member';
import { appEnv } from '@/lib/env';
import { ActionForm } from '@/components/admin/ActionForm';
import { PageHeader } from '@/components/admin/ui';

export const metadata = { title: 'In-app test links' };

export default async function TestLinksPage() {
  await requireStaff('customers.act');
  const production = appEnv() === 'production';
  const members = production ? [] : await listDemoMembers();
  return (
    <>
      <PageHeader
        title="In-app test links"
        description="Open the in-app (embed) experience on any phone without the Suntec+ app. This does what the Suntec+ backend does in production: it signs the member in with a single-use link."
      />
      {production ? (
        <Alert tone="info">Test links are disabled in production.</Alert>
      ) : (
        <Card className="max-w-2xl">
          <ActionForm
            action={createEmbedTestLink}
            submitLabel="Create test link"
            render={(s) =>
              s.data?.url ? (
                <div className="space-y-3 rounded-md border border-border bg-surface-muted p-4">
                  <p className="text-sm font-medium">Scan with the tester&apos;s phone camera, or send them the link:</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={String(s.data.qr)} alt="QR code for the in-app test link" width={200} height={200} className="rounded border border-border bg-white" />
                  <code className="block break-all rounded bg-surface p-2 font-mono text-xs">{String(s.data.url)}</code>
                  <p className="text-xs text-text-muted">Single use · expires in 10 minutes. Create a new link for each tester or device.</p>
                </div>
              ) : null
            }
          >
            <Field id="member_id" label="Sign in as demo member" required help="Give each tester a different member so their progress stays separate.">
              <Select id="member_id" name="member_id" required defaultValue="">
                <option value="" disabled>
                  Choose a member…
                </option>
                {members.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {`${m.name} · ${m.tier} · ${m.member_id}${m.linked ? ' (also used in portal)' : ''}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="entry" label="Open at">
              <Select id="entry" name="entry" defaultValue="home">
                <option value="home">Home (games and check-in)</option>
                <option value="missions">Missions</option>
                <option value="rewards">Rewards</option>
                <option value="badges">Badges</option>
                <option value="leaderboard">Leaderboard</option>
                <option value="inbox">Inbox</option>
              </Select>
            </Field>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
