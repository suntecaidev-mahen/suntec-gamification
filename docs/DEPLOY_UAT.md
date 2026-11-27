# Deploying the UAT environment

UAT is a public test copy of Play & Win that you can share with testers. Production is
deployed the same way later, from a **separate** Supabase project and Vercel project.

| | UAT | Production (later) |
|---|---|---|
| Hosting | Vercel project `suntec-play-uat` | Vercel project `suntec-play-prod` |
| Database | Supabase project used so far (with demo data) | New, empty Supabase project (no `seed.sql`) |
| `NEXT_PUBLIC_APP_ENV` | `uat` | `production` |
| `LOYALTY_ADAPTER` | `mock` | `capillary` |
| Test ribbon, demo-member picker, in-app test links | On | Off |

## 1. Create the Vercel project

1. Go to https://vercel.com/signup and choose **Continue with GitHub**, signing in as the
   GitHub account that owns the repository.
2. **Add New… → Project**, then **Import** `suntec-gamification`.
3. Fill in the project settings:
   - **Project Name:** `suntec-play-uat`
   - **Framework Preset:** Next.js
   - **Root Directory:** click **Edit** and choose `apps/web`
4. Open **Environment Variables** and add each of the following:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same as in `apps/web/.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as in `apps/web/.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | same as in `apps/web/.env.local` |
| `FINGERPRINT_SALT` | same as in `apps/web/.env.local` |
| `CRON_SECRET` | same as in `apps/web/.env.local` |
| `LOYALTY_ADAPTER` | `mock` |
| `NEXT_PUBLIC_APP_ENV` | `uat` |
| `NEXT_PUBLIC_APP_URL` | `https://suntec-play-uat.vercel.app` (adjust in step 6 if Vercel gives a different address) |

5. Click **Deploy** and wait about 2 minutes.
6. Copy the address Vercel shows, e.g. `https://suntec-play-uat.vercel.app`. If it differs
   from what you entered for `NEXT_PUBLIC_APP_URL`, open **Settings → Environment Variables**,
   fix that value, then go to **Deployments → ⋯ → Redeploy**.

## 2. Allow sign-in links to the UAT address (Supabase)

In **Authentication → URL Configuration**:
- **Site URL:** `https://suntec-play-uat.vercel.app`
- **Redirect URLs**, keep `http://localhost:3000/**` and add `https://suntec-play-uat.vercel.app/**`

## 3. Let testers receive sign-in emails (Supabase SMTP)

Supabase's built-in email only delivers to members of your Supabase team, a few emails per
hour. To let any tester receive sign-in codes, send the emails through Gmail:

1. On the Google account that will send the emails, turn on 2-Step Verification:
   https://myaccount.google.com/security
2. Create an App Password at https://myaccount.google.com/apppasswords (name it
   "Supabase") and copy the 16-character password.
3. In Supabase, go to **Authentication → Emails → SMTP Settings → Enable custom SMTP** and enter:
   - Sender email: the Gmail address · Sender name: `Suntec+ Play & Win`
   - Host `smtp.gmail.com` · Port `465` · Username: the Gmail address · Password: the App Password
4. Optionally, so testers can type a code instead of tapping the link: in **Authentication → Emails → Magic Link**,
   add a line such as `<p>Your code: <strong>{{ .Token }}</strong></p>`.
5. Under **Authentication → Rate Limits**, raise "emails per hour" (e.g. 100).

Gmail allows about 500 emails a day, which is plenty for UAT. For production, use a
transactional email service on a Suntec domain instead.

## 4. Links to share with testers

| Module | Link | How testers use it |
|---|---|---|
| Play & Win (public link) | `https://<uat-address>/play` | Play straight away as a guest. To test a member, tap **Member sign in**, sign in with their own email, then pick a demo member |
| Play & Win as in the Suntec+ app | Admin → **In-app test links** | You create a single-use link or QR code (valid 10 min) per tester and member; it opens Play & Win signed in, like the app does |
| Admin panel | `https://<uat-address>/admin` | Add each tester in **Staff & roles**; they receive a temporary password |

Give each tester a different demo member so their progress stays separate.

## 5. Scheduled jobs

Vercel runs `/api/v1/jobs/tick` once a day (02:00 SGT; the free plan allows daily only).
Rewards are already delivered instantly when won, and **Admin → Reward transactions →
Process deliveries now** runs a delivery pass on demand. For retries every 5 minutes, run
this once in the Supabase SQL Editor after enabling the **pg_cron** and **pg_net**
extensions (Database → Extensions). Replace both placeholders with your own values:

```sql
select cron.schedule('play-win-tick', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<uat-address>/api/v1/jobs/tick',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  );
$$);
```

## 6. Updating UAT

Every push to the `main` branch on GitHub redeploys UAT automatically. After a push that
adds a new database migration, also re-run `supabase/setup_all.sql` in the SQL Editor.
