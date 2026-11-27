# supabase/

| File | Purpose |
|---|---|
| `migrations/0001…0016_*.sql` | Ordered schema migrations. They are the source of truth and every one is safe to re-run. |
| `setup_all.sql` | **Generated.** All migrations concatenated. Paste it into the Supabase SQL Editor and run it in one go. |
| `seed.sql` | Demo data (campaign, games, rewards, missions, badges, mock Capillary members). **DEV/SIT only.** |

## Run order (Supabase Dashboard → SQL Editor)
1. `setup_all.sql`, or each migration file in numeric order.
2. `seed.sql` (optional, demo data).
3. Create your first admin. Go to Authentication → Users → **Add user** and tick Auto Confirm. Then run:
   ```sql
   select public.bootstrap_super_admin('you@yourcompany.com', 'Your Name');
   ```

## Migration map
| # | Contents |
|---|---|
| 0001 | Extensions (pgcrypto, citext), enum types, utilities (secure RNG, SHA-256, append-only guard) |
| 0002 | `app_settings`, timezone and period helpers, `members`, `member_profiles`, staff users, roles and permissions (RBAC), `bootstrap_super_admin` |
| 0003 | Segments, eligibility rules, merchants, campaigns |
| 0004 | Reward categories, rewards, inventory, daily caps, voucher code pool |
| 0005 | Game-type registry, games, weighted outcomes (with the 100% integrity trigger), quiz bank, game sessions, earned attempts |
| 0006 | Check-in programmes and streaks, missions and progress, badges, leaderboards, QR codes |
| 0007 | Play Points ledger (append-only), reward transactions, transactional outbox |
| 0008 | Notification templates, inbox, dispatches |
| 0009 | API clients, SSO handoff, idempotency, rate limits, inbound and domain events, fraud signals, audit log, analytics rollups |
| 0010 | `mock_capillary` schema (mock loyalty and voucher system, DEV/SIT only) |
| 0011 | `updated_at` and audit triggers |
| 0012 | Row Level Security policies for every table, publish-permission guard, function lock-down |
| 0013 | Storage bucket `public-assets` and Realtime for the inbox |
| 0014 | **Engine**: secure draws + fallback, reward allocation (inventory locks, code pools, caps), Play Points / attempt ledgers, check-in streaks, missions, badges, leaderboards (+ period close), notifications, outbox, idempotency, rate limits, event ingest, QR scans, read models, mock Capillary wrappers, permission-checked `admin_*` RPCs |
| 0015 | Atomic admin editors: `admin_save_outcomes` (100% rule on the final state) and `admin_save_question` |
| 0016 | Portal support: demo-member picker for the mock loyalty system |
| 0017 | **Guest play**: guests on the public link, winnings held under a claim code (30 days) and moved to a Suntec+ member on claim; Suntec+ Points only (Play Points and the catalogue retired); `admin_points_summary` |
| 0018 | Brighter spin-wheel colours and Suntec+ Points wording for the demo data (only where unchanged) |
| 0019 | QR check-in bonus (e.g. 2×) applies to Suntec+ Points |
| 0020 | Staff profile: department and invitation details for admin users; clearer access-level names |
| 0021 | Simpler game names: Spin & Win, Scratch & Win, Quiz & Win (demo games only, where unchanged) |

## Local validation (no Supabase project needed)
```bash
npm run db:bundle     # regenerate setup_all.sql after editing a migration
npm run db:validate   # runs migrations ×2 + seed ×2 on embedded Postgres (PGlite), then RLS and constraint checks
```
