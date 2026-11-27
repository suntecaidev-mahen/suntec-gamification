import { Card, Checkbox, Field, Input } from '@suntec/ui';
import { requireStaff } from '@/lib/admin/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { saveSettings } from '@/lib/admin/actions';
import { ActionForm } from '@/components/admin/ActionForm';
import { PageHeader } from '@/components/admin/ui';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireStaff('settings.manage');
  const { data: s } = await (await createSupabaseServerClient()).from('app_settings').select('*').single();
  return (
    <>
      <PageHeader title="Platform settings" description="Business timezone for daily resets, notifications and anti-fraud thresholds. Customers win Suntec+ Points (credited in Capillary)." />
      <Card className="max-w-2xl">
        <ActionForm action={saveSettings} submitLabel="Save settings">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="timezone" label="Business timezone" help="Daily limits, streaks and leaderboards reset at midnight here.">
              <Input id="timezone" name="timezone" defaultValue={s?.timezone ?? 'Asia/Singapore'} />
            </Field>
            <Field id="push_daily_cap" label="Max push notifications per member per day">
              <Input id="push_daily_cap" name="push_daily_cap" type="number" min={0} max={50} defaultValue={s?.push_daily_cap ?? 3} />
            </Field>
            <Field id="max_plays_per_minute" label="Velocity limit (plays per member per minute)">
              <Input id="max_plays_per_minute" name="max_plays_per_minute" type="number" min={1} defaultValue={s?.max_plays_per_minute ?? 10} />
            </Field>
            <Field id="max_members_per_device" label="Device sharing alert above (members per device)">
              <Input id="max_members_per_device" name="max_members_per_device" type="number" min={1} defaultValue={s?.max_members_per_device ?? 3} />
            </Field>
          </div>
          <Checkbox name="auto_flag_on_high_severity" label="Automatically flag members on high-severity fraud signals" defaultChecked={s?.auto_flag_on_high_severity ?? true} />
        </ActionForm>
      </Card>
    </>
  );
}
