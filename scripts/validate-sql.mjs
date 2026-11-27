#!/usr/bin/env node
// Validates the SQL locally — no Supabase project or Docker needed.
//
// Runs every migration TWICE (proves re-runnability) and seed.sql TWICE against
// PGlite (Postgres compiled to WASM) with a minimal Supabase shim (auth schema,
// API roles, storage schema), then runs smoke tests for constraints and RLS.
//
//   npm run db:validate
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migDir = join(root, 'supabase', 'migrations');
const seedFile = join(root, 'supabase', 'seed.sql');

const SHIM = `
  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text unique, created_at timestamptz default now());
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table if not exists storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

let failures = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const fail = (msg, e) => {
  failures++;
  console.log(`  ✘ ${msg}${e ? `\n      ${e.message ?? e}` : ''}`);
};

async function expectError(db, label, sql, pattern) {
  try {
    await db.exec(sql);
    fail(`${label} (expected an error, got none)`);
  } catch (e) {
    if (pattern && !pattern.test(e.message)) fail(`${label} (wrong error)`, e);
    else ok(label);
  }
}

async function asUser(db, role, sub, fn) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

async function main() {
  const db = new PGlite({ extensions: { pgcrypto, citext } });
  await db.exec(SHIM);

  const files = readdirSync(migDir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  for (const pass of [1, 2]) {
    console.log(`\nMigrations — pass ${pass}${pass === 2 ? ' (re-run / idempotency)' : ''}`);
    for (const f of files) {
      try {
        await db.exec(readFileSync(join(migDir, f), 'utf8'));
        ok(f);
      } catch (e) {
        fail(f, e);
        process.exit(1);
      }
    }
  }

  if (existsSync(seedFile)) {
    for (const pass of [1, 2]) {
      console.log(`\nSeed — pass ${pass}`);
      try {
        await db.exec(readFileSync(seedFile, 'utf8'));
        ok('seed.sql');
      } catch (e) {
        fail('seed.sql', e);
        process.exit(1);
      }
    }
  }

  if (existsSync(seedFile)) {
    console.log('\nSeed checks');
    const q = async (sql) => (await db.query(sql)).rows[0];
    const s = await q(`select
      (select count(*)::int from public.games where status = 'active') as active_games,
      (select sum(weight_bp)::int from public.game_outcomes where game_id = '21000000-0000-4000-8000-000000000001') as wheel_bp,
      (select count(*)::int from public.game_outcomes where game_id = '21000000-0000-4000-8000-000000000001') as wheel_segments,
      (select count(*)::int from public.quiz_questions) as questions,
      (select count(*)::int from public.missions where status = 'active') as missions,
      (select count(*)::int from public.badges) as badges,
      (select count(*)::int from public.notification_templates) as templates,
      (select count(*)::int from mock_capillary.members) as mock_members,
      (select count(*)::int from public.voucher_code_pool where status = 'available') as kopi_codes`);
    s.active_games === 3 ? ok('3 active games') : fail(`active games = ${s.active_games}`);
    s.wheel_bp === 10000 && s.wheel_segments === 8 ? ok('wheel: 8 segments totalling 100%') : fail(`wheel ${s.wheel_segments} segs / ${s.wheel_bp} bp`);
    ok(`${s.questions} quiz questions, ${s.missions} missions, ${s.badges} badges, ${s.templates} templates, ${s.mock_members} mock members, ${s.kopi_codes} pool codes`);
  }

  console.log('\nSchema checks');
  const { rows: noRls } = await db.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public','mock_capillary') and c.relkind = 'r' and not c.relrowsecurity`,
  );
  noRls.length === 0 ? ok('RLS enabled on every table') : fail(`RLS missing on: ${noRls.map((r) => r.relname).join(', ')}`);

  const { rows: cnt } = await db.query(
    `select count(*)::int as n from pg_tables where schemaname = 'public'`,
  );
  ok(`${cnt[0].n} tables in public`);

  const r = await db.query(`select public.secure_random_int(10) as v`);
  r.rows[0].v >= 0 && r.rows[0].v < 10 ? ok('secure_random_int in range') : fail('secure_random_int out of range');
  const ref = await db.query(`select public.gen_public_ref('GS') as v`);
  /^GS-\d{8}-[0-9A-Z]{8}$/.test(ref.rows[0].v) ? ok(`gen_public_ref → ${ref.rows[0].v}`) : fail('gen_public_ref format');
  const pk = await db.query(`select public.period_key('weekly', '2026-11-27T04:00:00Z') as w, public.period_key('monthly', '2026-11-30T17:00:00Z') as m`);
  pk.rows[0].w === '2026-W48' && pk.rows[0].m === '2026-12'
    ? ok('period_key uses business timezone (30 Nov 17:00Z = 1 Dec SGT → 2026-12)')
    : fail(`period_key: ${JSON.stringify(pk.rows[0])}`);

  console.log('\nConstraint checks');
  await expectError(db, 'append-only points_ledger rejects UPDATE',
    `update public.points_ledger set delta = delta where false;
     insert into auth.users (id, email) values ('99999999-0000-4000-8000-000000000001','ledger@test') on conflict do nothing;
     insert into public.members (id, suntec_member_id) values ('99999999-0000-4000-8000-000000000002','T-LEDGER') on conflict do nothing;
     insert into public.points_ledger (member_id, delta, balance_after, reason, idempotency_key)
       values ('99999999-0000-4000-8000-000000000002', 10, 10, 'admin_adjust', 'k1') on conflict do nothing;
     update public.points_ledger set delta = 11 where idempotency_key = 'k1';`, /append-only/);

  await expectError(db, 'active spin game with weights ≠ 100% is rejected',
    `begin;
     insert into public.games (id, type, slug, name, status) values ('99999999-0000-4000-8000-0000000000a1','spin_wheel','t-bad','Bad','draft');
     insert into public.game_outcomes (game_id, position, label, weight_bp) values ('99999999-0000-4000-8000-0000000000a1',0,'A',5000);
     update public.games set status = 'active' where id = '99999999-0000-4000-8000-0000000000a1';
     commit;`, /must total 10000/);
  await db.exec('rollback').catch(() => {});

  try {
    await db.exec(`begin;
      insert into public.games (id, type, slug, name, status) values ('99999999-0000-4000-8000-0000000000a2','spin_wheel','t-good','Good','draft');
      insert into public.game_outcomes (game_id, position, label, weight_bp) values
        ('99999999-0000-4000-8000-0000000000a2',0,'A',2500),('99999999-0000-4000-8000-0000000000a2',1,'B',7500);
      update public.games set status = 'active' where id = '99999999-0000-4000-8000-0000000000a2';
      commit;`);
    ok('active spin game with weights = 100% is accepted');
  } catch (e) {
    fail('valid game activation', e);
    await db.exec('rollback').catch(() => {});
  }
  await expectError(db, 'changing an active game\'s weights away from 100% fails at commit',
    `begin; update public.game_outcomes set weight_bp = 7000 where game_id = '99999999-0000-4000-8000-0000000000a2' and position = 1; commit;`,
    /must total 10000/);
  await db.exec('rollback').catch(() => {});

  console.log('\nRLS checks');
  // fixtures: two members, one marketing staff, one super admin
  await db.exec(`
    insert into auth.users (id, email) values
      ('aaaaaaaa-0000-4000-8000-000000000001','m1@test'),('aaaaaaaa-0000-4000-8000-000000000002','m2@test'),
      ('aaaaaaaa-0000-4000-8000-0000000000f1','mkt@test'),('aaaaaaaa-0000-4000-8000-0000000000f2','sa@test')
    on conflict do nothing;
    insert into public.members (id, suntec_member_id, auth_user_id, email) values
      ('bbbbbbbb-0000-4000-8000-000000000001','T-1','aaaaaaaa-0000-4000-8000-000000000001','m1@test'),
      ('bbbbbbbb-0000-4000-8000-000000000002','T-2','aaaaaaaa-0000-4000-8000-000000000002','m2@test')
    on conflict do nothing;
    insert into public.member_profiles (member_id) values
      ('bbbbbbbb-0000-4000-8000-000000000001'),('bbbbbbbb-0000-4000-8000-000000000002') on conflict do nothing;
    insert into public.staff_users (id, email, display_name) values
      ('aaaaaaaa-0000-4000-8000-0000000000f1','mkt@test','Mkt'),('aaaaaaaa-0000-4000-8000-0000000000f2','sa@test','SA')
    on conflict do nothing;
    insert into public.staff_user_roles (user_id, role_key) values
      ('aaaaaaaa-0000-4000-8000-0000000000f1','marketing'),('aaaaaaaa-0000-4000-8000-0000000000f2','super_admin')
    on conflict do nothing;
  `);

  const m1 = 'aaaaaaaa-0000-4000-8000-000000000001';
  await asUser(db, 'authenticated', m1, async () => {
    const a = await db.query(`select id from public.members`);
    a.rows.length === 1 ? ok('member sees only own members row') : fail(`member sees ${a.rows.length} members rows`);
    const b = await db.query(`select member_id from public.member_profiles`);
    b.rows.length === 1 ? ok('member sees only own profile') : fail(`member sees ${b.rows.length} profiles`);
    const c = await db.query(`select id from public.game_outcomes`);
    c.rows.length === 0 ? ok('member cannot read outcome weights') : fail('member can read game_outcomes');
    const d = await db.query(`select id from public.quiz_options`);
    d.rows.length === 0 ? ok('member cannot read quiz answers') : fail('member can read quiz_options');
  });
  await asUser(db, 'authenticated', m1, () =>
    expectError(db, 'member cannot write to points_ledger',
      `insert into public.points_ledger (member_id, delta, balance_after, reason, idempotency_key)
       values ('bbbbbbbb-0000-4000-8000-000000000001', 1000, 1000, 'admin_adjust', 'hack')`, /row-level security|permission denied/));
  await asUser(db, 'authenticated', m1, () =>
    expectError(db, 'member cannot update own PP balance',
      `do $$ declare n int; begin
         update public.member_profiles set pp_balance = 999999 where member_id = 'bbbbbbbb-0000-4000-8000-000000000001';
         get diagnostics n = row_count; if n = 0 then raise exception 'blocked by RLS (0 rows)'; end if; end $$;`, /blocked by RLS|permission denied/));

  await asUser(db, 'anon', null, async () => {
    try {
      const a = await db.query(`select id from public.campaigns`);
      a.rows.length === 0 ? ok('anon reads nothing') : fail('anon can read campaigns');
    } catch {
      ok('anon has no table access');
    }
  });

  await asUser(db, 'authenticated', 'aaaaaaaa-0000-4000-8000-0000000000f1', async () => {
    const a = await db.query(`select id from public.members`);
    a.rows.length === 0 ? ok('marketing staff cannot read unmasked member PII') : fail('marketing can read members');
    const b = await db.query(`select member_id from public.member_profiles`);
    b.rows.length >= 2 ? ok('marketing staff can read gamification profiles') : fail('marketing cannot read profiles');
  });
  await asUser(db, 'authenticated', 'aaaaaaaa-0000-4000-8000-0000000000f1', () =>
    expectError(db, 'marketing staff cannot create campaigns',
      `insert into public.campaigns (slug, name) values ('mkt-try','Nope')`, /row-level security/));
  await asUser(db, 'authenticated', 'aaaaaaaa-0000-4000-8000-0000000000f2', async () => {
    try {
      await db.exec(`insert into public.campaigns (slug, name) values ('sa-camp','SA Campaign') on conflict do nothing`);
      ok('super admin can create campaigns');
    } catch (e) {
      fail('super admin create campaign', e);
    }
  });
  const audit = await db.query(
    `select actor_type::text, action from public.audit_log where entity = 'campaigns' and after->>'slug' = 'sa-camp'`,
  );
  audit.rows[0]?.actor_type === 'staff' && audit.rows[0]?.action === 'campaigns.insert'
    ? ok('audit_log captured staff campaign insert')
    : fail(`audit missing: ${JSON.stringify(audit.rows)}`);

  await engineChecks(db);

  await db.close();

  // The consolidated file the user pastes into the SQL Editor must also work on a fresh database.
  const bundle = join(root, 'supabase', 'setup_all.sql');
  if (existsSync(bundle)) {
    console.log('\nConsolidated setup_all.sql on a fresh database');
    const fresh = new PGlite({ extensions: { pgcrypto, citext } });
    try {
      await fresh.exec(SHIM);
      await fresh.exec(readFileSync(bundle, 'utf8'));
      if (existsSync(seedFile)) await fresh.exec(readFileSync(seedFile, 'utf8'));
      ok('setup_all.sql + seed.sql succeed in one go');
      const stale = readFileSync(bundle, 'utf8');
      const current = files.map((f) => readFileSync(join(migDir, f), 'utf8').trim());
      current.every((c) => stale.includes(c))
        ? ok('setup_all.sql is up to date with migrations')
        : fail('setup_all.sql is STALE — run: npm run db:bundle');
    } catch (e) {
      fail('setup_all.sql', e);
    }
    await fresh.close();
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll SQL checks passed.');
  process.exit(failures ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Engine (Phase 2) behaviour checks — run as the service role equivalent.
// ---------------------------------------------------------------------------
async function engineChecks(db) {
  if (!existsSync(seedFile)) return;
  console.log('\nEngine checks');
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const val = async (sql, params = []) => {
    const r = await one(sql, params);
    return r ? Object.values(r)[0] : undefined;
  };
  const check = (cond, label, extra) => (cond ? ok(label) : fail(`${label}${extra ? ` — ${JSON.stringify(extra)}` : ''}`));
  const expectCode = async (label, sql, code) => {
    try {
      await db.query(sql);
      fail(`${label} (expected ${code})`);
    } catch (e) {
      const hint = e.hint ?? '';
      hint === code || e.message.includes(code) ? ok(label) : fail(`${label} (got ${hint || e.message})`);
    }
  };

  const WHEEL = '21000000-0000-4000-8000-000000000001';
  const QUIZ = '21000000-0000-4000-8000-000000000003';
  const A = await val(`select public.ensure_member('SUN-00010001', '{"first_name":"Ah Kow","last_name":"Tan","tier":"gold","card_no":"6012000010001","email":"tan.demo@example.com"}')`);
  const B = await val(`select public.ensure_member('SUN-00010002', '{"first_name":"Mei Ling","last_name":"Lim","tier":"platinum"}')`);
  const A2 = await val(`select public.ensure_member('SUN-00010001', '{"tier":"platinum"}')`);
  check(A && A === A2, 'ensure_member is idempotent and refreshes profile');

  // Check-in
  const c1 = await val(`select public.checkin($1)`, [A]);
  check(c1.checked_in && c1.streak === 1 && c1.rewards.length === 1, 'daily check-in awards base reward and starts streak', c1);
  const c2 = await val(`select public.checkin($1)`, [A]);
  check(c2.already === true, 'second check-in on the same day is rejected as already done');
  check(c1.rewards[0].type === 'capillary_points' && c1.rewards[0].status === 'pending' && Number(c1.rewards[0].amount) === 10, 'check-in awards 10 Suntec+ Points (queued for Capillary, no local balance)', c1.rewards[0]);
  check((await val(`select count(*)::int from public.member_badges mb join public.badges b on b.id = mb.badge_id where mb.member_id = $1 and b.key = 'first-checkin'`, [A])) === 1, 'First Check-in badge awarded automatically');

  // Spin & Win
  const s1 = await val(`select public.game_start($1, $2, 'spin-test-0001')`, [A, WHEEL]);
  check(s1.status === 'completed' && typeof s1.outcome.position === 'number' && s1.payment_source === 'free', 'spin decided server-side with free daily attempt', s1);
  check(!JSON.stringify(s1).includes('weight'), 'spin response contains no probability weights');
  const s1r = await val(`select public.game_start($1, $2, 'spin-test-0001')`, [A, WHEEL]);
  check(s1r.id === s1.id && s1r.replay === true, 'same Idempotency-Key replays the same session (no double play)');
  await expectCode('cooldown enforced between plays', `select public.game_start('${A}', '${WHEEL}', 'spin-test-0002')`, 'COOLDOWN');

  // Quiz (member B)
  const q1 = await val(`select public.game_start($1, $2, 'quiz-test-0001')`, [B, QUIZ]);
  check(q1.status === 'in_progress' && q1.questions.length === 5, 'quiz session serves 5 questions', q1);
  check(!JSON.stringify(q1).includes('is_correct'), 'quiz questions are served without answers');
  const answers = [];
  for (const q of q1.questions) {
    const right = await val(`select id from public.quiz_options where question_id = $1 and is_correct`, [q.id]);
    answers.push({ question_id: q.id, option_id: right });
  }
  const q2 = await val(`select public.quiz_submit($1, $2, $3)`, [B, q1.id, JSON.stringify(answers)]);
  check(q2.status === 'completed' && q2.correct_count === 5 && q2.outcome.passed && q2.outcome.reward?.name === '100 Suntec+ Points',
    'quiz scored server-side; 5/5 earns the top reward tier', q2.outcome);
  check(q2.results.length === 5 && q2.results.every((r) => r.correct), 'quiz results reveal correct answers only after submission');
  await expectCode('quiz daily limit enforced', `select public.game_start('${B}', '${QUIZ}', 'quiz-test-0002')`, 'LIMIT_REACHED');

  // RNG distribution & out-of-stock fallback
  const draws = (await db.query(`select (public.draw_outcome('${WHEEL}') ->> 'outcome_id') as o from generate_series(1, 4000)`)).rows;
  const counts = {};
  for (const r of draws) counts[r.o] = (counts[r.o] ?? 0) + 1;
  const outs = (await db.query(`select id, weight_bp from public.game_outcomes where game_id = $1`, [WHEEL])).rows;
  let chi = 0;
  for (const o of outs) {
    const exp = (4000 * o.weight_bp) / 10000;
    chi += ((counts[o.id] ?? 0) - exp) ** 2 / exp;
  }
  check(chi < 24.3, `weighted draw matches configured probabilities (chi² = ${chi.toFixed(2)}, df=7, p>0.001)`);
  await db.exec(`update public.reward_inventory set remaining_qty = 0 where reward_id = '12000000-0000-4000-8000-000000000011'`);
  const kopi = await val(`select count(*)::int from (select public.draw_outcome('${WHEEL}') d from generate_series(1, 1500)) x
                          where d->>'outcome_id' = '22000000-0000-4000-8000-000000000005'`);
  const fb = await val(`select count(*)::int from (select public.draw_outcome('${WHEEL}') d from generate_series(1, 1500)) x
                        where d->>'drawn_id' = '22000000-0000-4000-8000-000000000005' and d->>'outcome_id' = '22000000-0000-4000-8000-000000000001'`);
  check(kopi === 0 && fb > 0, 'out-of-stock prize is never awarded; configured fallback outcome is used instead', { kopi, fb });
  await db.exec(`update public.reward_inventory set remaining_qty = 2 where reward_id = '12000000-0000-4000-8000-000000000011'`);
  const k1 = await val(`select public.allocate_reward($1, '12000000-0000-4000-8000-000000000011', 1, 'admin', 'stock-1')`, [B]);
  const k2 = await val(`select public.allocate_reward($1, '12000000-0000-4000-8000-000000000011', 1, 'admin', 'stock-2')`, [B]);
  const k3 = await val(`select public.allocate_reward($1, '12000000-0000-4000-8000-000000000011', 1, 'admin', 'stock-3')`, [B]);
  check(k1.ok && k2.ok && k1.voucher_code && k1.voucher_code !== k2.voucher_code && k3.ok === false && k3.reason === 'out_of_stock',
    'inventory never oversells: unique pool codes, third allocation out of stock', { k1: k1.voucher_code, k2: k2.voucher_code, k3 });

  // Events → missions → rewards
  const ev = `select public.ingest_event('pos', null, 'transaction', 'TX-1001', 'SUN-00010001', now(), '{"amount_cents":6000,"merchant_code":"M-0101"}')`;
  const e1 = await val(ev);
  const e2 = await val(ev);
  check(e1.status === 'processed' && e2.duplicate === true, 'inbound events are processed once (dedupe on external id)');
  const mp = await one(`select p.completed_at, p.rewarded_at from public.mission_progress p join public.missions m on m.id = p.mission_id
                        where m.key = 'spend-50' and p.member_id = $1`, [A]);
  check(mp?.completed_at && mp?.rewarded_at, 'spend $50 mission completed and rewarded from a POS transaction');
  check((await val(`select balance from public.attempt_balances where member_id = $1 and game_id = $2`, [A, WHEEL])) >= 1, 'mission reward granted a bonus spin');

  // Capillary points via outbox + mock adapter
  const cap = await val(`select public.allocate_reward($1, '12000000-0000-4000-8000-000000000007', 1, 'admin', 'cap-test-1')`, [A]);
  check(cap.status === 'pending', 'Suntec+ points reward is queued (pending) — never stored as a local balance');
  const claimed = (await db.query(`select * from public.outbox_claim(10, array[(select id from public.outbox where aggregate_id = '${cap.id}')])`)).rows;
  check(claimed.length === 1 && claimed[0].kind === 'loyalty.award_points', 'outbox job claimed for delivery');
  const award = await val(`select public.mock_cap_award_points('SUN-00010001', 100, $1, 'test')`, [cap.id]);
  const award2 = await val(`select public.mock_cap_award_points('SUN-00010001', 100, $1, 'test')`, [cap.id]);
  check(award.external_ref === award2.external_ref && award2.replay, 'mock Capillary award is idempotent per transaction id');
  await val(`select public.outbox_complete($1, true, $2)`, [claimed[0].id, JSON.stringify({ external_ref: award.external_ref })]);
  const capAfter = await one(`select status::text, external_ref from public.reward_transactions where id = $1`, [cap.id]);
  check(capAfter.status === 'issued' && capAfter.external_ref === award.external_ref, 'delivered reward marked issued with Capillary reference');

  // Guest play: held winnings, claim to a Suntec+ member
  const gTok = 'a'.repeat(64);
  const g1 = await val(`select public.guest_create($1, 'dev-guest-1')`, [gTok]);
  const g1b = await val(`select public.guest_create($1)`, [gTok]);
  check(g1.member_id && g1.member_id === g1b.member_id && /^[2-9A-HJ-NP-TV-Z]{8}$/.test(g1.claim_code), 'guest_create is idempotent per browser token and issues a claim code', g1);
  const G = g1.member_id;
  const gWin = await val(`select public.allocate_reward($1, '12000000-0000-4000-8000-000000000007', 1, 'admin', 'guest-test-1')`, [G]);
  check(gWin.ok && gWin.status === 'held' && gWin.held === true, 'guest win is held (not sent to Capillary)', gWin);
  check((await val(`select count(*)::int from public.outbox where aggregate_id = $1`, [gWin.id])) === 0, 'held guest win creates no outbox delivery');
  const gPool = await val(`select public.allocate_reward($1, '12000000-0000-4000-8000-000000000011', 1, 'admin', 'guest-test-2')`, [G]);
  check(gPool.ok === false, 'code-pool vouchers are not given to guests');
  check((await val(`select public.reward_available('12000000-0000-4000-8000-000000000011', $1)`, [G])) === false, 'draw treats code-pool prizes as unavailable for guests');
  const gCi = await val(`select public.checkin($1)`, [G]);
  check(gCi.checked_in && gCi.rewards[0].status === 'held', 'guest can check in; reward held', gCi.rewards[0]);
  const gSum = await val(`select public.member_summary($1)`, [G]);
  check(gSum.is_guest && gSum.claim.code === g1.claim_code && Number(gSum.held.points) === 110 && gSum.member.suntec_member_id === null,
    'guest summary shows held points and claim code (no fake member id)', gSum.held);
  await expectCode('claim code must be valid', `select public.guest_claim('${A}', 'ZZZZ-ZZZZ')`, 'INVALID_CLAIM');
  await expectCode('a guest cannot claim winnings', `select public.guest_claim('${G}', '${g1.claim_code}')`, 'INVALID');
  const pretty = g1.claim_code.slice(0, 4).toLowerCase() + '-' + g1.claim_code.slice(4);
  const cl = await val(`select public.guest_claim($1, $2)`, [A, pretty]);
  check(cl.claimed && cl.rewards === 2 && Number(cl.points) === 110, 'member claims held winnings with the code (case/dash-insensitive)', cl);
  const moved = await one(`select member_id, status::text from public.reward_transactions where id = $1`, [gWin.id]);
  check(moved.member_id === A && moved.status === 'pending', 'claimed points moved to the member and queued for Capillary', moved);
  check((await val(`select count(*)::int from public.outbox where aggregate_id = $1 and kind = 'loyalty.award_points' and payload->>'suntec_member_id' = 'SUN-00010001'`, [gWin.id])) === 1,
    "claimed points delivered to the member's Suntec+ account (outbox)");
  const cl2 = await val(`select public.guest_claim($1, $2)`, [A, g1.claim_code]);
  check(cl2.already === true, 're-claiming by the same member is a no-op');
  await expectCode('claim code cannot be used by a second member', `select public.guest_claim('${B}', '${g1.claim_code}')`, 'CLAIM_USED');
  const g2 = await val(`select public.guest_create($1)`, ['b'.repeat(64)]);
  await val(`select public.allocate_reward($1, '12000000-0000-4000-8000-000000000009', 1, 'admin', 'guest-test-3')`, [g2.member_id]);
  const invBefore = await val(`select remaining_qty from public.reward_inventory where reward_id = '12000000-0000-4000-8000-000000000009'`);
  await db.query(`update public.reward_transactions set expires_at = now() - interval '1 minute' where member_id = $1`, [g2.member_id]);
  const gm = await val(`select public.guest_maintenance()`);
  const invAfter = await val(`select remaining_qty from public.reward_inventory where reward_id = '12000000-0000-4000-8000-000000000009'`);
  check(gm.held_rewards_expired === 1 && invAfter === invBefore + 1, 'unclaimed held winnings expire and stock is returned', { gm, invBefore, invAfter });
  check((await val(`select count(*)::int from public.rewards where type = 'play_points' or in_catalogue`)) === 0, 'Suntec+ points only: no Play Points rewards or catalogue items');

  // QR + leaderboard + maintenance
  await val(`select public.lb_add($1, 'play_points_earned', 50)`, [A]);
  await val(`select public.lb_add($1, 'play_points_earned', 30)`, [B]);
  const qr = await val(`select public.qr_scan($1, 'DEMO-MALL-VISIT-FOUNTAIN')`, [B]);
  check(qr.purpose === 'visit', 'QR mall-visit scan accepted');
  await expectCode('QR per-member daily limit enforced', `select public.qr_scan('${B}', 'DEMO-MALL-VISIT-FOUNTAIN')`, 'ALREADY_SCANNED');
  const lb = await val(`select public.leaderboard_view('27000000-0000-4000-8000-000000000001', 'daily', $1)`, [A]);
  check(lb.entries.length >= 2 && lb.me?.rank >= 1 && !JSON.stringify(lb.entries).includes('Tan'), 'leaderboard ranks members with masked names', lb.entries);
  const tick = await val(`select public.maintenance_tick()`);
  check(tick && typeof tick.sessions_expired === 'number', 'maintenance_tick runs');
  const idem = [
    await val(`select public.idem_begin('t', 'k1', 'h1')`),
    await val(`select public.idem_begin('t', 'k1', 'h2')`),
  ];
  await val(`select public.idem_complete('t', 'k1', 200, '{"a":1}')`);
  const idem3 = await val(`select public.idem_begin('t', 'k1', 'h1')`);
  check(idem[0].state === 'new' && idem[1].state === 'mismatch' && idem3.state === 'replay', 'idempotency store: new → mismatch → replay');
  const rl = [];
  for (let i = 0; i < 3; i++) rl.push(await val(`select public.rate_limit_hit('t:1', 2, 60)`));
  check(rl[1].allowed && !rl[2].allowed, 'rate limiter blocks after the limit');

  // Privileges
  await asUser(db, 'authenticated', 'aaaaaaaa-0000-4000-8000-0000000000f1', () =>
    expectError(db, 'signed-in users cannot call engine functions directly',
      `select public.game_start('${A}', '${WHEEL}', 'hack-hack-01')`, /permission denied/));
  await asUser(db, 'authenticated', 'aaaaaaaa-0000-4000-8000-0000000000f1', () =>
    expectError(db, 'marketing staff cannot adjust Play Points (admin RPC checks permission)',
      `select public.admin_adjust_pp('${A}', 100, 'test', 'abc')`, /permission/));
  await asUser(db, 'authenticated', 'aaaaaaaa-0000-4000-8000-0000000000f2', async () => {
    try {
      const d = (await db.query(`select public.admin_dashboard() as d`)).rows[0].d;
      const s = (await db.query(`select public.admin_customer_search('SUN-0001') as s`)).rows[0].s;
      const adj = (await db.query(`select public.admin_adjust_pp('${A}', 50, 'goodwill', 'adj-1') as a`)).rows[0].a;
      check(d.plays_today >= 2 && s.length >= 1 && adj.pp_balance > 0, 'super admin can use dashboard, customer search and adjustments');
    } catch (e) {
      fail('super admin RPCs', e);
    }
  });
  check((await val(`select count(*)::int from public.audit_log where action = 'member.pp_adjust'`)) === 1, 'admin adjustment written to audit log');

  // Admin editors (0015)
  const SCRATCH = '21000000-0000-4000-8000-000000000002';
  const current = (await db.query(`select id, position, label, reward_id, weight_bp from public.game_outcomes where game_id = $1 order by position`, [SCRATCH])).rows;
  const edited = current.map((o, i) => ({
    id: o.id, position: o.position, label: o.label, reward_id: o.reward_id, weight_bp: i === 0 ? 2000 : i === 3 ? 4000 : o.weight_bp,
    fallback_strategy: i === 1 ? 'outcome' : 'renormalize', fallback_position: i === 1 ? 0 : null,
  }));
  const bad = edited.map((o, i) => ({ ...o, weight_bp: i === 0 ? 1000 : o.weight_bp }));
  await asUser(db, 'authenticated', 'aaaaaaaa-0000-4000-8000-0000000000f2', async () => {
    await expectError(db, 'outcome editor rejects weights that do not total 100%',
      `select public.admin_save_outcomes('${SCRATCH}', '${JSON.stringify(bad)}')`, /10000 bp/);
    try {
      await db.query(`select public.admin_save_outcomes($1, $2)`, [SCRATCH, JSON.stringify(edited)]);
      ok('outcome editor saves a re-weighted active game atomically (with fallback mapping)');
    } catch (e) {
      fail('admin_save_outcomes', e);
    }
    try {
      await db.query(`select public.admin_save_question($1, $2)`, [QUIZ, JSON.stringify({
        text: 'Which level is the Fountain of Wealth on?', category: 'suntec',
        options: [{ text: 'B1', is_correct: true }, { text: 'Level 3' }, { text: 'Rooftop' }],
      })]);
      ok('quiz editor saves a question with options');
    } catch (e) {
      fail('admin_save_question', e);
    }
  });
  await asUser(db, 'authenticated', 'aaaaaaaa-0000-4000-8000-0000000000f1', () =>
    expectError(db, 'marketing staff cannot edit game probabilities',
      `select public.admin_save_outcomes('${SCRATCH}', '${JSON.stringify(edited)}')`, /permission/));
  const fbOk = await val(`select count(*)::int from public.game_outcomes where game_id = $1 and fallback_strategy = 'outcome' and fallback_outcome_id is not null`, [SCRATCH]);
  check(fbOk === 1, 'fallback outcome linked by position');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
