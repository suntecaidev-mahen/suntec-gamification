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
        description="Open Play & Win exactly as the Suntec+ app does (member signed in automatically) on any phone, without the app. This does what the Suntec+ backend does in production: it signs the member in with a single-use link."
      />
      {production ? (
        <Alert tone="info">Test links are disabled in production.</Alert>
      ) : (
        <Card className="max-w-2xl">
          <ActionForm
            action={createEmbedTestLink}
            submitLabel="Create test link"
            result="test-link"
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
                <option value="rewards">My rewards</option>
              </Select>
            </Field>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
