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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
