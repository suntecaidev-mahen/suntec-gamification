-- =============================================================================
-- Suntec+ Play & Win — DEMO SEED DATA (DEV / SIT only — never run in PROD)
--
-- Run AFTER supabase/setup_all.sql, in the Supabase SQL Editor. Safe to re-run
-- (fixed UUIDs + ON CONFLICT). Merchant names are fictional demo tenants.
--
-- Creates:
--   * 8 participating merchants, 7 reward categories, 16 rewards with inventory
--   * 3 segments, 1 eligibility rule
--   * Campaign "Suntec Year-End Spin" (active now → +60 days) with
--       - Spin & Win wheel (8 segments, weights total 100%)
--       - Festive Scratch Card (4 outcomes)
--       - Suntec City Trivia quiz (6 questions)
--   * Campaign "Christmas Quiz Countdown" (scheduled, starts in 4 days)
--   * Always-on Daily Check-in programme with a streak ladder (day 3/7/14/30)
--   * 7 missions, 7 badges, 2 leaderboards, 9 notification templates, 3 QR codes
--   * 8 mock Capillary members with loyalty points + 3 voucher series
--
-- FIRST ADMIN USER: see the instructions at the bottom of this file.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Merchants (fictional demo tenants)
-- ---------------------------------------------------------------------------
insert into public.merchants (id, merchant_code, name, category, unit_no, is_participating) values
  ('10000000-0000-4000-8000-000000000001', 'M-0101', 'Orchid Bistro',        'dining',    '#01-101 Tower 1', true),
  ('10000000-0000-4000-8000-000000000002', 'M-0102', 'Kopi & Co.',           'dining',    '#01-305 Tower 3', true),
  ('10000000-0000-4000-8000-000000000003', 'M-0201', 'Urban Threads',        'fashion',   '#02-210 Tower 2', true),
  ('10000000-0000-4000-8000-000000000004', 'M-0202', 'Little Explorers Toys','kids',      '#02-118 Tower 1', true),
  ('10000000-0000-4000-8000-000000000005', 'M-0301', 'Gadget Bay',           'electronics','#03-020 Tower 4', true),
  ('10000000-0000-4000-8000-000000000006', 'M-0302', 'Glow Beauty Lab',      'beauty',    '#01-450 Tower 4', true),
  ('10000000-0000-4000-8000-000000000007', 'M-0401', 'FitZone Active',       'sports',    '#03-150 Tower 2', true),
  ('10000000-0000-4000-8000-000000000008', 'M-0402', 'Page & Paper Books',   'lifestyle', '#02-330 Tower 3', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Reward categories & rewards
-- ---------------------------------------------------------------------------
insert into public.reward_categories (id, key, name, icon, sort) values
  ('11000000-0000-4000-8000-000000000002', 'suntec_points', 'Suntec+ Points',    'coins',     20),
  ('11000000-0000-4000-8000-000000000003', 'dining',        'Dining Vouchers',   'utensils',  30),
  ('11000000-0000-4000-8000-000000000004', 'retail',        'Retail Vouchers',   'bag',       40),
  ('11000000-0000-4000-8000-000000000005', 'gifts',         'Promotional Gifts', 'gift',      50),
  ('11000000-0000-4000-8000-000000000006', 'privileges',    'Privileges',        'crown',     60),
  ('11000000-0000-4000-8000-000000000007', 'game_bonus',    'Game Bonuses',      'refresh',   70)
on conflict (id) do nothing;

-- Campaign must exist before campaign-scoped rewards
insert into public.campaigns (id, slug, name, description, priority, status, starts_at, ends_at, limits, terms, published_at) values
  ('20000000-0000-4000-8000-000000000001', 'year-end-spin', 'Suntec Year-End Spin',
   'Spin, scratch and quiz your way to dining vouchers, Suntec+ Points and festive gifts all season long.',
   1, 'active', now() - interval '7 days', now() + interval '60 days',
   '{"per_day":10,"per_week":40,"per_campaign":300,"cooldown_seconds":10}',
   'Open to Suntec+ members. Prizes subject to availability. Suntec City reserves the right to amend these terms.',
   now() - interval '7 days'),
  ('20000000-0000-4000-8000-000000000002', 'christmas-quiz', 'Christmas Quiz Countdown',
   'A new festive trivia challenge every day until Christmas.',
   2, 'scheduled', now() + interval '4 days', now() + interval '30 days',
   '{"per_day":1}', 'Open to Suntec+ members.', null)
on conflict (id) do nothing;

insert into public.rewards (id, category_id, campaign_id, key, type, name, description, value, unit_cost_cents,
                            in_catalogue, pp_cost, validity_days, per_member_cap, per_member_period, sort) values
  -- Suntec+ loyalty points (awarded in Capillary via the LoyaltyAdapter; held for guests until claimed)
  ('12000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', null, 'pp-10', 'capillary_points', '10 Suntec+ Points', 'Daily check-in reward', '{"points":10}',  0, false, null, null, null, 'once', 10),
  ('12000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', null, 'pp-20', 'capillary_points', '20 Suntec+ Points', 'Credited to your Suntec+ account', '{"points":20}',  0, false, null, null, null, 'once', 11),
  ('12000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000002', null, 'pp-50', 'capillary_points', '50 Suntec+ Points', 'Credited to your Suntec+ account', '{"points":50}',  0, false, null, null, null, 'once', 12),
  ('12000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000002', null, 'pp-100', 'capillary_points', '100 Suntec+ Points', 'Credited to your Suntec+ account', '{"points":100}', 0, false, null, null, null, 'once', 13),
  ('12000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000002', null, 'pp-200', 'capillary_points', '200 Suntec+ Points', 'Credited to your Suntec+ account', '{"points":200}', 0, false, null, null, null, 'once', 14),
  -- Bonus attempt (game_id filled in after games exist)
  ('12000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', 'bonus-spin', 'bonus_attempt', 'Bonus Spin', 'One extra spin on the Year-End Spin wheel', '{"count":1,"game_id":null}', 0, false, null, null, null, 'once', 20),
  -- Suntec+ loyalty points — awarded in Capillary via the LoyaltyAdapter
  ('12000000-0000-4000-8000-000000000007', '11000000-0000-4000-8000-000000000002', null, 'cap-100', 'capillary_points', '100 Suntec+ Points', 'Credited to your Suntec+ account', '{"points":100}', 50,  false, null, null, null, 'once', 30),
  ('12000000-0000-4000-8000-000000000008', '11000000-0000-4000-8000-000000000002', null, 'cap-500', 'capillary_points', '500 Suntec+ Points', 'Credited to your Suntec+ account', '{"points":500}', 250, false, null, null, 5, 'monthly', 31),
  -- Vouchers (VMS series)
  ('12000000-0000-4000-8000-000000000009', '11000000-0000-4000-8000-000000000003', null, 'din-5',  'digital_voucher',  '$5 Dining Voucher',  'Valid at participating dining outlets', '{"series_id":"DIN5","face_value_cents":500}', 500, false, null, 30, 3, 'monthly', 40),
  ('12000000-0000-4000-8000-000000000010', '11000000-0000-4000-8000-000000000004', null, 'ret-10', 'merchant_voucher', '$10 Urban Threads Voucher', 'Min. spend $50', '{"merchant_id":"10000000-0000-4000-8000-000000000003","source":"vms","series_id":"RET10","face_value_cents":1000}', 1000, false, null, 14, 1, 'monthly', 41),
  ('12000000-0000-4000-8000-000000000011', '11000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'coffee-free', 'merchant_voucher', 'Free Kopi at Kopi & Co.', 'One regular kopi or teh', '{"merchant_id":"10000000-0000-4000-8000-000000000002","source":"code_pool","face_value_cents":350}', 350, false, null, 14, null, 'once', 42),
  -- Gifts, privileges, exclusive
  ('12000000-0000-4000-8000-000000000012', '11000000-0000-4000-8000-000000000005', null, 'tote-bag', 'promo_gift', 'Suntec+ Festive Tote Bag', 'Collect at the Concierge, Tower 3 Level 1', '{"collect_at":"Concierge, Tower 3 Level 1"}', 800, false, null, 30, 1, 'once', 50),
  ('12000000-0000-4000-8000-000000000013', '11000000-0000-4000-8000-000000000006', null, 'vip-lounge', 'privilege', 'VIP Lounge Pass (30 days)', 'Members'' lounge access for 30 days', '{"duration_days":30,"benefit":"VIP lounge access"}', 1500, false, null, 30, 1, 'monthly', 60),
  ('12000000-0000-4000-8000-000000000014', '11000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 'xmas-ornament', 'exclusive_reward', 'Limited Edition Ornament', 'Year-End campaign exclusive', '{"fulfilment":"manual"}', 1200, false, null, 30, 1, 'once', 51),
  -- No prize
  ('12000000-0000-4000-8000-000000000015', null, null, 'try-again', 'none', 'Try Again', 'Better luck next time!', '{}', 0, false, null, null, null, 'once', 99),
  -- Quiz champion reward
  ('12000000-0000-4000-8000-000000000016', '11000000-0000-4000-8000-000000000002', null, 'pp-30', 'capillary_points', '30 Suntec+ Points', 'Credited to your Suntec+ account', '{"points":30}', 0, false, null, null, null, 'once', 12)
on conflict (id) do nothing;

-- Inventory (NULL = unlimited). Kopi is deliberately small to demo out-of-stock fallback.
insert into public.reward_inventory (reward_id, total_qty, remaining_qty, daily_cap, low_stock_threshold) values
  ('12000000-0000-4000-8000-000000000001', null, null, null, 0),
  ('12000000-0000-4000-8000-000000000002', null, null, null, 0),
  ('12000000-0000-4000-8000-000000000003', null, null, null, 0),
  ('12000000-0000-4000-8000-000000000004', null, null, null, 0),
  ('12000000-0000-4000-8000-000000000005', null, null, null, 0),
  ('12000000-0000-4000-8000-000000000006', null, null, null, 0),
  ('12000000-0000-4000-8000-000000000007', 20000, 20000, 1000, 1000),
  ('12000000-0000-4000-8000-000000000008', 5000, 5000, 200, 250),
  ('12000000-0000-4000-8000-000000000009', 5000, 5000, 300, 250),
  ('12000000-0000-4000-8000-000000000010', 500, 500, 50, 50),
  ('12000000-0000-4000-8000-000000000011', 20, 20, 10, 5),
  ('12000000-0000-4000-8000-000000000012', 200, 200, 30, 20),
  ('12000000-0000-4000-8000-000000000013', 50, 50, 5, 5),
  ('12000000-0000-4000-8000-000000000014', 100, 100, 10, 10),
  ('12000000-0000-4000-8000-000000000015', null, null, null, 0),
  ('12000000-0000-4000-8000-000000000016', null, null, null, 0)
on conflict (reward_id) do nothing;

-- Code pool for the free kopi voucher (20 demo codes)
insert into public.voucher_code_pool (reward_id, code)
select '12000000-0000-4000-8000-000000000011', 'KOPI-' || lpad(g::text, 4, '0')
from generate_series(1, 20) g
on conflict (reward_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- Segments & eligibility
-- ---------------------------------------------------------------------------
insert into public.segments (id, key, name, description, rules) values
  ('13000000-0000-4000-8000-000000000001', 'all-members', 'All members', 'Every Suntec+ member', '{"all":[]}'),
  ('13000000-0000-4000-8000-000000000002', 'gold-plus', 'Gold & Platinum', 'Top-tier members',
   '{"all":[{"field":"tier","op":"in","value":["gold","platinum"]}]}'),
  ('13000000-0000-4000-8000-000000000003', 'new-members', 'New members (90 days)', 'Joined Suntec+ in the last 90 days',
   '{"all":[{"field":"joined_days","op":"lte","value":90}]}')
on conflict (id) do nothing;

insert into public.eligibility_rules (id, name, description, rules) values
  ('14000000-0000-4000-8000-000000000001', 'Active members', 'Member status must be active',
   '{"all":[{"field":"status","op":"eq","value":"active"}]}'),
  ('14000000-0000-4000-8000-000000000002', 'Silver and above', 'Tier Silver, Gold or Platinum',
   '{"all":[{"field":"tier","op":"in","value":["silver","gold","platinum"]}]}')
on conflict (id) do nothing;

update public.campaigns set eligibility_rule_id = '14000000-0000-4000-8000-000000000001'
where id in ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002')
  and eligibility_rule_id is null;

insert into public.campaign_segments (campaign_id, segment_id) values
  ('20000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Games (inserted as draft, outcomes added, then activated → weight check runs)
-- ---------------------------------------------------------------------------
insert into public.games (id, campaign_id, type, slug, name, description, status, priority, starts_at, ends_at,
                          attempt_rules, config, rules_text) values
  ('21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'spin_wheel', 'year-end-spin-wheel',
   'Year-End Spin', 'Spin the wheel for dining vouchers, Suntec+ Points and more!', 'draft', 1,
   now() - interval '7 days', now() + interval '60 days',
   '{"free_per_day":1,"max_per_day":5,"max_per_week":null,"max_per_campaign":null,"cooldown_seconds":10,"session_ttl_seconds":120}',
   '{"spin_duration_ms":4500}',
   'One free spin per day. Earn extra spins from missions and check-in streaks. Max 5 spins per day.'),
  ('21000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'scratch_card', 'festive-scratch',
   'Festive Scratch Card', 'Scratch to reveal an instant prize.', 'draft', 2,
   now() - interval '7 days', now() + interval '60 days',
   '{"free_per_day":1,"max_per_day":3,"cooldown_seconds":5,"session_ttl_seconds":300}',
   '{"reveal_threshold":0.6}',
   'One free card per day; earn extra cards from missions. Max 3 cards per day.'),
  ('21000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'quiz', 'suntec-trivia',
   'Suntec City Trivia', 'How well do you know Suntec City? 5 questions, 20 seconds each.', 'draft', 3,
   now() - interval '7 days', now() + interval '60 days',
   '{"free_per_day":1,"max_per_day":1,"cooldown_seconds":0,"session_ttl_seconds":180}',
   '{"questions_per_session":5,"time_limit_s":20,"pass_percent":60,"speed_bonus":true,"shuffle":true,"reward_tiers":[{"min_correct":5,"reward_id":"12000000-0000-4000-8000-000000000004"},{"min_correct":4,"reward_id":"12000000-0000-4000-8000-000000000003"},{"min_correct":3,"reward_id":"12000000-0000-4000-8000-000000000016"}]}',
   'One quiz per day. Score 3 or more correct answers to earn Suntec+ Points.'),
  ('21000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 'quiz', 'christmas-quiz-daily',
   'Christmas Quiz Countdown', 'A new festive question set every day.', 'draft', 1,
   now() + interval '4 days', now() + interval '30 days',
   '{"free_per_day":1,"max_per_day":1,"session_ttl_seconds":180}',
   '{"questions_per_session":3,"time_limit_s":15,"pass_percent":60,"speed_bonus":true,"shuffle":true,"reward_tiers":[{"min_correct":3,"reward_id":"12000000-0000-4000-8000-000000000003"}]}',
   'One quiz per day during the campaign.')
on conflict (id) do nothing;

-- Bonus spin reward targets the Year-End wheel
update public.rewards set value = jsonb_set(value, '{game_id}', '"21000000-0000-4000-8000-000000000001"')
where id = '12000000-0000-4000-8000-000000000006';

-- Spin wheel: 8 segments (sum = 10000 bp = 100%). Colours follow the Suntec City logo palette;
-- text colours meet WCAG AA on their segment colour.
insert into public.game_outcomes (id, game_id, position, label, display, reward_id, weight_bp, fallback_strategy, fallback_outcome_id) values
  ('22000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 0, '20 Points',        '{"color":"#F97316","text_color":"#1F2937","icon":"star"}',  '12000000-0000-4000-8000-000000000002', 2500, 'renormalize', null),
  ('22000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', 1, '$5 Dining',        '{"color":"#FFFFFF","text_color":"#C2410C","icon":"utensils"}', '12000000-0000-4000-8000-000000000009', 1200, 'renormalize', null),
  ('22000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', 2, 'Bonus Spin',       '{"color":"#0369A1","text_color":"#FFFFFF","icon":"refresh"}',  '12000000-0000-4000-8000-000000000006', 800,  'renormalize', null),
  ('22000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000001', 3, '50 Points',        '{"color":"#FDE68A","text_color":"#1F2937","icon":"star"}',  '12000000-0000-4000-8000-000000000003', 1500, 'renormalize', null),
  ('22000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000001', 4, 'Free Kopi',        '{"color":"#15803D","text_color":"#FFFFFF","icon":"coffee"}', '12000000-0000-4000-8000-000000000011', 500,  'outcome',     '22000000-0000-4000-8000-000000000001'),
  ('22000000-0000-4000-8000-000000000006', '21000000-0000-4000-8000-000000000001', 5, '100 Suntec+ Pts',  '{"color":"#FFEDD5","text_color":"#9A3412","icon":"coins"}',  '12000000-0000-4000-8000-000000000007', 600,  'renormalize', null),
  ('22000000-0000-4000-8000-000000000007', '21000000-0000-4000-8000-000000000001', 6, '$10 Voucher',      '{"color":"#DC2626","text_color":"#FFFFFF","icon":"bag"}',    '12000000-0000-4000-8000-000000000010', 300,  'outcome',     '22000000-0000-4000-8000-000000000004'),
  ('22000000-0000-4000-8000-000000000008', '21000000-0000-4000-8000-000000000001', 7, 'Try Again',        '{"color":"#E0F2FE","text_color":"#0369A1","icon":"rotate"}', null,                                  2600, 'none',        null)
on conflict (id) do nothing;

-- Scratch card: 4 outcomes (sum = 10000)
insert into public.game_outcomes (id, game_id, position, label, display, reward_id, weight_bp, fallback_strategy) values
  ('22000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000002', 0, '50 Suntec+ Points',  '{"icon":"star"}',     '12000000-0000-4000-8000-000000000003', 3000, 'renormalize'),
  ('22000000-0000-4000-8000-000000000012', '21000000-0000-4000-8000-000000000002', 1, '$5 Dining Voucher',  '{"icon":"utensils"}', '12000000-0000-4000-8000-000000000009', 1000, 'renormalize'),
  ('22000000-0000-4000-8000-000000000013', '21000000-0000-4000-8000-000000000002', 2, '20 Suntec+ Points',  '{"icon":"star"}',     '12000000-0000-4000-8000-000000000002', 3000, 'renormalize'),
  ('22000000-0000-4000-8000-000000000014', '21000000-0000-4000-8000-000000000002', 3, 'Better luck next time', '{"icon":"rotate"}', null,                                  3000, 'none')
on conflict (id) do nothing;

-- Quiz bank: Suntec City Trivia
insert into public.quiz_questions (id, game_id, category, text, explanation, points, sort) values
  ('23000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000003', 'suntec',
   'Which Suntec City landmark was listed in the Guinness Book of Records in 1998 as the world''s largest fountain?',
   'The Fountain of Wealth sits at the heart of Suntec City.', 100, 1),
  ('23000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000003', 'suntec',
   'How many office towers make up Suntec City?', 'Suntec City has five office towers: four 45-storey towers and one 18-storey tower.', 100, 2),
  ('23000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000003', 'suntec',
   'Viewed from above, the layout of Suntec City''s towers is often said to resemble what?',
   'The towers form the "fingers" and the Fountain of Wealth sits in the "palm" of a left hand.', 100, 3),
  ('23000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000003', 'suntec',
   'Which of these MRT stations is linked to Suntec City?', 'Promenade station (Circle & Downtown lines) connects to Suntec City.', 100, 4),
  ('23000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000003', 'campaign',
   'How many FREE spins do you get each day in the Year-End Spin?', 'Every member gets one free spin per day.', 100, 5),
  ('23000000-0000-4000-8000-000000000006', '21000000-0000-4000-8000-000000000003', 'campaign',
   'What do you unlock with a 7-day check-in streak?', 'Day 7 of a streak gives 100 Suntec+ Points plus a Bonus Spin.', 100, 6),
  -- Christmas quiz (scheduled campaign)
  ('23000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000004', 'general',
   'In which month is Christmas Day celebrated?', '', 100, 1),
  ('23000000-0000-4000-8000-000000000012', '21000000-0000-4000-8000-000000000004', 'general',
   'Which plant is traditionally decorated at Christmas?', '', 100, 2),
  ('23000000-0000-4000-8000-000000000013', '21000000-0000-4000-8000-000000000004', 'campaign',
   'Where do the points you win in Play & Win go?', 'Points you win are added to your Suntec+ account.', 100, 3)
on conflict (id) do nothing;

insert into public.quiz_options (question_id, position, text, is_correct) values
  ('23000000-0000-4000-8000-000000000001', 0, 'Fountain of Wealth', true),
  ('23000000-0000-4000-8000-000000000001', 1, 'Merlion Fountain', false),
  ('23000000-0000-4000-8000-000000000001', 2, 'Rain Vortex', false),
  ('23000000-0000-4000-8000-000000000001', 3, 'Spectra Fountain', false),
  ('23000000-0000-4000-8000-000000000002', 0, 'Three', false),
  ('23000000-0000-4000-8000-000000000002', 1, 'Four', false),
  ('23000000-0000-4000-8000-000000000002', 2, 'Five', true),
  ('23000000-0000-4000-8000-000000000002', 3, 'Seven', false),
  ('23000000-0000-4000-8000-000000000003', 0, 'A left hand', true),
  ('23000000-0000-4000-8000-000000000003', 1, 'A lotus flower', false),
  ('23000000-0000-4000-8000-000000000003', 2, 'A dragon', false),
  ('23000000-0000-4000-8000-000000000003', 3, 'A ship', false),
  ('23000000-0000-4000-8000-000000000004', 0, 'Promenade', true),
  ('23000000-0000-4000-8000-000000000004', 1, 'Bishan', false),
  ('23000000-0000-4000-8000-000000000004', 2, 'Tampines', false),
  ('23000000-0000-4000-8000-000000000004', 3, 'Jurong East', false),
  ('23000000-0000-4000-8000-000000000005', 0, 'One', true),
  ('23000000-0000-4000-8000-000000000005', 1, 'Two', false),
  ('23000000-0000-4000-8000-000000000005', 2, 'Three', false),
  ('23000000-0000-4000-8000-000000000005', 3, 'Unlimited', false),
  ('23000000-0000-4000-8000-000000000006', 0, '10 Suntec+ Points', false),
  ('23000000-0000-4000-8000-000000000006', 1, '100 Suntec+ Points and a Bonus Spin', true),
  ('23000000-0000-4000-8000-000000000006', 2, 'A free tote bag', false),
  ('23000000-0000-4000-8000-000000000006', 3, 'Nothing extra', false),
  ('23000000-0000-4000-8000-000000000011', 0, 'November', false),
  ('23000000-0000-4000-8000-000000000011', 1, 'December', true),
  ('23000000-0000-4000-8000-000000000011', 2, 'January', false),
  ('23000000-0000-4000-8000-000000000012', 0, 'Fir tree', true),
  ('23000000-0000-4000-8000-000000000012', 1, 'Cactus', false),
  ('23000000-0000-4000-8000-000000000012', 2, 'Bamboo', false),
  ('23000000-0000-4000-8000-000000000013', 0, 'Your Suntec+ account', true),
  ('23000000-0000-4000-8000-000000000013', 1, 'A separate game wallet', false),
  ('23000000-0000-4000-8000-000000000013', 2, 'Nowhere, they are just for fun', false)
on conflict (question_id, position) do nothing;

-- Activate the Year-End games (weights validated by trigger); Christmas quiz is scheduled.
update public.games set status = 'active'
where id in ('21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000003');
update public.games set status = 'scheduled' where id = '21000000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- Daily check-in programme (always-on) + streak ladder
-- ---------------------------------------------------------------------------
insert into public.checkin_programs (id, campaign_id, name, description, status, base_rewards, reset_rule, grace_days, reset_period, qr_multiplier) values
  ('24000000-0000-4000-8000-000000000001', null, 'Daily Check-in', 'Check in every day to build your streak.', 'active',
   '[{"reward_id":"12000000-0000-4000-8000-000000000001","qty":1}]', 'strict', 0, 'none', 2)
on conflict (id) do nothing;

insert into public.checkin_streak_rules (program_id, streak_day, repeat_every, rewards, label) values
  ('24000000-0000-4000-8000-000000000001', 3,  null, '[{"reward_id":"12000000-0000-4000-8000-000000000002","qty":1}]', '+20 PP'),
  ('24000000-0000-4000-8000-000000000001', 7,  7,    '[{"reward_id":"12000000-0000-4000-8000-000000000004","qty":1},{"reward_id":"12000000-0000-4000-8000-000000000006","qty":1}]', '+100 PP + Bonus Spin'),
  ('24000000-0000-4000-8000-000000000001', 14, null, '[{"reward_id":"12000000-0000-4000-8000-000000000005","qty":1}]', '+200 PP'),
  ('24000000-0000-4000-8000-000000000001', 30, null, '[{"reward_id":"12000000-0000-4000-8000-000000000005","qty":1},{"reward_id":"12000000-0000-4000-8000-000000000008","qty":1}]', '+200 PP + 500 Suntec+ Points')
on conflict (program_id, streak_day) do nothing;

-- ---------------------------------------------------------------------------
-- Missions (examples from the brief)
-- ---------------------------------------------------------------------------
insert into public.missions (id, campaign_id, key, title, description, how_to, category, icon, objective_type, objective, target,
                             recurrence, enrolment_mode, rewards, status, priority, starts_at, ends_at) values
  ('25000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'visit-3x-month',
   'Visit Suntec City 3 times this month', 'Drop by Suntec City on three different days.', 'Scan the Play & Win QR code at any Concierge counter, or make a purchase at a participating store.',
   'visit', 'map-pin', 'visit_count', '{"distinct_days":true}', 3, 'monthly', 'auto',
   '[{"reward_id":"12000000-0000-4000-8000-000000000006","qty":1}]', 'active', 1, now() - interval '7 days', now() + interval '60 days'),
  ('25000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'spend-50',
   'Spend $50 at participating merchants', 'Spend a total of $50 this month at participating stores.', 'Use your Suntec+ membership when paying at participating merchants.',
   'shopping', 'bag', 'spend_amount', '{"participating_only":true}', 5000, 'monthly', 'auto',
   '[{"reward_id":"12000000-0000-4000-8000-000000000006","qty":1},{"reward_id":"12000000-0000-4000-8000-000000000004","qty":1}]', 'active', 2, now() - interval '7 days', now() + interval '60 days'),
  ('25000000-0000-4000-8000-000000000003', null, 'checkin-5-week',
   'Complete 5 daily check-ins this week', 'Check in on five days this week.', 'Tap "Check in" on the Play & Win home screen.',
   'engagement', 'calendar', 'checkin_count', '{}', 5, 'weekly', 'auto',
   '[{"reward_id":"12000000-0000-4000-8000-000000000003","qty":1}]', 'active', 3, null, null),
  ('25000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'explorer-3-stores',
   'Shopping Explorer: visit 3 different stores', 'Shop at three different participating stores this month.', 'Join the mission, then make purchases at three different participating stores.',
   'shopping', 'compass', 'distinct_stores', '{"participating_only":true}', 3, 'monthly', 'opt_in',
   '[{"reward_id":"12000000-0000-4000-8000-000000000004","qty":1}]', 'active', 4, now() - interval '7 days', now() + interval '60 days'),
  ('25000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 'join-year-end',
   'Join the Year-End Spin', 'Play any Year-End game once.', 'Spin the wheel, scratch a card or take the quiz.',
   'games', 'sparkles', 'campaign_participation', '{"campaign_id":"20000000-0000-4000-8000-000000000001"}', 1, 'once', 'auto',
   '[{"reward_id":"12000000-0000-4000-8000-000000000002","qty":1}]', 'active', 5, now() - interval '7 days', now() + interval '60 days'),
  ('25000000-0000-4000-8000-000000000006', null, 'redeem-a-voucher',
   'Redeem a voucher', 'Use any Suntec+ voucher at a participating store.', 'Show a voucher from My Rewards at the counter.',
   'shopping', 'ticket', 'voucher_redeemed', '{}', 1, 'once', 'auto',
   '[{"reward_id":"12000000-0000-4000-8000-000000000003","qty":1}]', 'active', 6, null, null),
  ('25000000-0000-4000-8000-000000000007', null, 'activities-10-month',
   'Complete 10 activities this month', 'Any game, check-in or mission counts as an activity.', 'Play games, check in and complete missions.',
   'engagement', 'activity', 'activity_count', '{}', 10, 'monthly', 'auto',
   '[{"reward_id":"12000000-0000-4000-8000-000000000006","qty":1}]', 'active', 7, null, null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Badges (examples from the brief)
-- ---------------------------------------------------------------------------
insert into public.badges (id, key, name, description, icon, tier, hidden, criteria, rewards, sort) values
  ('26000000-0000-4000-8000-000000000001', 'first-checkin',    'First Check-in',    'Checked in for the first time',            'calendar-check', 'bronze',   false, '{"metric":"checkins_total","op":"gte","value":1}',            '[]', 1),
  ('26000000-0000-4000-8000-000000000002', 'super-shopper',    'Super Shopper',     'Spent $1,000 at participating merchants',   'bag',            'gold',     false, '{"metric":"lifetime_spend_cents","op":"gte","value":100000}', '[{"reward_id":"12000000-0000-4000-8000-000000000005","qty":1}]', 2),
  ('26000000-0000-4000-8000-000000000003', 'mission-master',   'Mission Master',    'Completed 10 missions',                      'target',         'silver',   false, '{"metric":"missions_completed","op":"gte","value":10}',       '[{"reward_id":"12000000-0000-4000-8000-000000000004","qty":1}]', 3),
  ('26000000-0000-4000-8000-000000000004', 'quiz-champion',    'Quiz Champion',     'Passed 5 quizzes',                           'brain',          'silver',   false, '{"metric":"quiz_wins","op":"gte","value":5}',                 '[{"reward_id":"12000000-0000-4000-8000-000000000003","qty":1}]', 4),
  ('26000000-0000-4000-8000-000000000005', 'shopping-explorer','Shopping Explorer', 'Shopped at 10 different participating stores','compass',        'gold',     false, '{"metric":"distinct_stores","op":"gte","value":10}',          '[{"reward_id":"12000000-0000-4000-8000-000000000004","qty":1}]', 5),
  ('26000000-0000-4000-8000-000000000006', 'monthly-champion', 'Monthly Champion',  'Finished top 3 on a monthly leaderboard',    'trophy',         'platinum', false, '{"metric":"monthly_rank","op":"lte","value":3}',              '[]', 6),
  ('26000000-0000-4000-8000-000000000007', 'loyalty-star',     'Loyalty Star',      'Reached a 30-day check-in streak',           'star',           'platinum', true,  '{"metric":"checkin_streak","op":"gte","value":30}',           '[]', 7)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Leaderboards
-- ---------------------------------------------------------------------------
insert into public.leaderboards (id, campaign_id, key, name, description, metric, periods, game_id, display_mode, top_n, prize_rules, status) values
  ('27000000-0000-4000-8000-000000000001', null, 'play-points', 'Top Players', 'Ranked by Play Points earned',
   'play_points_earned', '{daily,weekly,monthly,overall}', null, 'masked', 100,
   '[{"period":"monthly","rank_from":1,"rank_to":3,"rewards":[{"reward_id":"12000000-0000-4000-8000-000000000005","qty":1}]}]', 'active'),
  ('27000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'trivia-masters', 'Trivia Masters', 'Suntec City Trivia scores',
   'quiz_score', '{weekly,monthly,overall}', '21000000-0000-4000-8000-000000000003', 'masked', 50, '[]', 'active')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Notification templates (admin-editable)
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, name, channels, title, body, deep_link, quiet_hours_start, quiet_hours_end) values
  ('campaign_launched', 'New campaign',          '{inbox,push}', '🎉 {{campaign_name}} is live!', 'Play now and win {{headline_prize}}.', 'suntecplus://play', '22:00', '08:00'),
  ('mission_available', 'New mission',           '{inbox,push}', 'New mission: {{mission_title}}', 'Complete it to earn {{reward_name}}.', 'suntecplus://play/missions/{{mission_id}}', '22:00', '08:00'),
  ('checkin_reminder',  'Daily check-in reminder','{push}',      'Keep your {{streak}}-day streak going 🔥', 'Check in today to earn {{reward_name}}.', 'suntecplus://play/checkin', '22:00', '08:00'),
  ('mission_completed', 'Mission completed',     '{inbox,push}', 'Mission complete! ✅', 'You completed "{{mission_title}}" and earned {{reward_name}}.', 'suntecplus://play/missions/{{mission_id}}', null, null),
  ('game_result',       'Game result',           '{inbox}',      'You won {{reward_name}}!', 'Your {{game_name}} prize is in My Rewards.', 'suntecplus://play/rewards', null, null),
  ('reward_allocated',  'Reward allocated',      '{inbox,push}', '🎁 {{reward_name}} is ready', 'Hi {{first_name}}, find it in My Rewards.', 'suntecplus://play/rewards/{{transaction_ref}}', '22:00', '08:00'),
  ('reward_expiring',   'Reward expiring',       '{inbox,push}', '⏰ {{reward_name}} expires {{expires_on}}', 'Use it before it expires.', 'suntecplus://play/rewards/{{transaction_ref}}', '22:00', '08:00'),
  ('badge_unlocked',    'Badge unlocked',        '{inbox,push}', '🏅 Badge unlocked: {{badge_name}}', '{{badge_description}}', 'suntecplus://play/badges', '22:00', '08:00'),
  ('leaderboard_update','Leaderboard update',    '{inbox}',      'You''re #{{rank}} on {{board_name}}', 'Keep playing to climb higher!', 'suntecplus://play/leaderboard', null, null)
on conflict (key, locale) do nothing;

-- ---------------------------------------------------------------------------
-- QR codes (DEMO tokens — regenerate real ones from the admin panel)
-- ---------------------------------------------------------------------------
insert into public.qr_codes (id, token, purpose, label, location, campaign_id, mission_id, program_id, per_member_daily_limit) values
  ('28000000-0000-4000-8000-000000000001', 'DEMO-CONCIERGE-CHECKIN-T3', 'checkin', 'Concierge check-in (Tower 3)', 'Concierge, Tower 3 Level 1',
   null, null, '24000000-0000-4000-8000-000000000001', 1),
  ('28000000-0000-4000-8000-000000000002', 'DEMO-MALL-VISIT-FOUNTAIN', 'visit', 'Mall visit — Fountain of Wealth', 'Fountain of Wealth, Level B1',
   '20000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001', null, 1),
  ('28000000-0000-4000-8000-000000000003', 'DEMO-EVENT-XMAS-LIGHTUP', 'event', 'Christmas Light-Up event', 'Convention Centre Atrium',
   '20000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000007', null, 1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- MOCK Capillary: members, loyalty points, voucher series (example.com emails)
-- Log in to the portal with one of these emails to be linked to that member.
-- ---------------------------------------------------------------------------
insert into mock_capillary.members (member_id, card_no, first_name, last_name, email, mobile, tier, tags, dob, joined_at) values
  ('SUN-00010001', '6012000010001', 'Ah Kow',  'Tan',     'tan.demo@example.com',    '+6590000001', 'gold',     '{frequent_diner}',     '1985-03-14', now() - interval '6 years'),
  ('SUN-00010002', '6012000010002', 'Mei Ling','Lim',     'meiling.demo@example.com','+6590000002', 'platinum', '{fashion,frequent}',   '1990-07-02', now() - interval '4 years'),
  ('SUN-00010003', '6012000010003', 'Ravi',    'Kumar',   'ravi.demo@example.com',   '+6590000003', 'silver',   '{electronics}',        '1988-11-21', now() - interval '2 years'),
  ('SUN-00010004', '6012000010004', 'Siti',    'Rahman',  'siti.demo@example.com',   '+6590000004', 'member',   '{}',                   '1995-01-30', now() - interval '30 days'),
  ('SUN-00010005', '6012000010005', 'James',   'Wong',    'james.demo@example.com',  '+6590000005', 'gold',     '{family}',             '1979-05-09', now() - interval '8 years'),
  ('SUN-00010006', '6012000010006', 'Priya',   'Nair',    'priya.demo@example.com',  '+6590000006', 'member',   '{beauty}',             '1998-09-17', now() - interval '45 days'),
  ('SUN-00010007', '6012000010007', 'Daniel',  'Lee',     'daniel.demo@example.com', '+6590000007', 'silver',   '{sports}',             '1992-12-05', now() - interval '1 year'),
  ('SUN-00010008', '6012000010008', 'Nurul',   'Aisyah',  'nurul.demo@example.com',  '+6590000008', 'platinum', '{frequent_diner,vip}', '1987-04-26', now() - interval '10 years')
on conflict (member_id) do nothing;

insert into mock_capillary.points_accounts (member_id, balance) values
  ('SUN-00010001', 4820), ('SUN-00010002', 15230), ('SUN-00010003', 1890), ('SUN-00010004', 120),
  ('SUN-00010005', 7600), ('SUN-00010006', 300),   ('SUN-00010007', 2450), ('SUN-00010008', 32100)
on conflict (member_id) do nothing;

insert into mock_capillary.coupon_series (series_id, name, face_value_cents, validity_days, merchant_code) values
  ('DIN5',  '$5 Dining Voucher',          500,  30, null),
  ('RET10', '$10 Urban Threads Voucher',  1000, 14, 'M-0201'),
  ('GEN20', '$20 Suntec City Gift Voucher', 2000, 60, null)
on conflict (series_id) do nothing;

-- =============================================================================
-- FIRST ADMIN USER (do this once, by hand):
--   1. Supabase Dashboard → Authentication → Users → "Add user" → "Create new user"
--      Enter your email + a strong password, tick "Auto Confirm User".
--   2. Back in the SQL Editor run (replace the email and name):
--        select public.bootstrap_super_admin('you@yourcompany.com', 'Your Name');
--   3. Sign in to /admin with that email. Add other staff from Users & roles.
-- =============================================================================
