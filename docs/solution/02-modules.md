# 2. Functional Module Breakdown

Every module is data-driven and configured from the admin panel. "Engine" logic runs on the server only.

## M-01 Customer Profile Service
- Gamification profile linked to the Suntec+ member: member ID, loyalty card number, tier, segment tags, join date and status (active, flagged, blocked).
- Profile is created lazily on first entry, with an on-demand Capillary refresh of tier and name (cached for 24 h).
- Play Points balance, lifetime points, current streak, badges count and leaderboard positions.
- Privacy settings: leaderboard display mode (masked name, nickname or hidden) and notification preferences.
- PDPA tools for admins: export member data and anonymise member.

## M-02 Campaign Management Service
- Campaigns hold a name, description, banner or images (Storage), priority, status (draft, scheduled, active, paused, ended), start and end date-time (SGT), target segments and participation limits.
- Each campaign groups games, missions, rewards, check-in programmes and leaderboards.
- **Preview before publishing:** a signed preview link renders the draft exactly as customers will see it.
- Scheduler jobs activate and expire campaigns automatically. Expiry closes the related games and missions and can trigger "campaign ending" notifications.

## M-03 Rules, Eligibility & Segmentation Service (shared)
- **Segments:** rule sets built from tier, join date (new or existing), Capillary segment tags, total spend band, visit count, badges held and campaign participation. They are previewed with a live count of matching members.
- **Eligibility:** reusable rule sets attached to a campaign, game, mission or reward, combined with AND/OR logic.
- **Limits engine:** per-member attempts per day, week, month and campaign, cooldown seconds and global caps. Windows are calculated in the configured timezone.
- **Anti-fraud:** velocity checks (member, device, IP), device sharing detection, QR scan bursts and quiz timing anomalies. These produce fraud signals, which can auto-flag a member or block them.

## M-04 Check-in Service (brief §3.1)
- One check-in per member per calendar day (SGT), enforced by a unique constraint.
- **Check-in programme config:** base reward, streak ladder (for example day 3 = +20 PP, day 7 = +100 PP and a bonus spin) and reset rule. The reset rule is either *break on a missed day* or *grace of N days*, and the programme can reset weekly, monthly or per campaign.
- Weekly and monthly check-in challenges are implemented as missions with the `checkin_count` objective.
- Check-in history calendar, current and best streak.
- Optional *location-verified* check-in (QR code at the mall concierge) to support the goal of driving physical visits.

## M-05 Mission Management Service (brief §3.2)
- **Mission types (objectives):** `visit_count` (mall visits from QR or transaction location), `spend_amount` (SGD at participating merchants), `distinct_stores`, `checkin_count`, `campaign_participation`, `voucher_redeemed`, `game_plays`, `quiz_score` and `activity_count` (a generic event count).
- **Recurrence:** one-time, daily, weekly or monthly. Progress is kept per `period_key`, for example `2026-W48`.
- **Scope:** individual, or a campaign challenge that groups missions into a challenge track.
- **Enrolment:** automatic, or opt-in ("Join mission"). Optional participation cap (first N members).
- Progress tracking is event-driven from transaction, visit, check-in, game and voucher events. It is idempotent per source event and a mission can complete only once per period.
- On completion the reward is allocated automatically, with a notification and an inbox item.
- Configurable start and end dates, eligibility, segments, rewards and limits.

## M-06 Game Management Service (brief §3.3–3.5)
A **game-type registry** sits behind a common session lifecycle: `start → (submit) → completed`. Every session has a unique transaction ID (`GS-…`) and an idempotency key, which prevents duplicate participation.

| | Spin & Win | Scratch & Win | Quiz & Trivia |
|---|---|---|---|
| Outcome decided | At session start, on the server, using a CSPRNG | At session start, on the server | At submit, by server scoring |
| Config | Wheel segments (label, colour, icon, prize, weight in basis points summing to 100%) | Card design, reward slots and weights, reveal threshold | Question bank, categories, questions per session, randomisation, time limit per question or quiz, pass mark, scoring (correct, speed bonus) |
| Participation | Free daily attempts, cost in Play Points, earned attempts (missions, events, admin grants) | Same | Same, plus a one-attempt-per-quiz option |
| Reward | Segment prize, out-of-stock fallback | Slot prize, fallback | Score tiers → reward. Score feeds the leaderboard. |
| History | Win history | Participation history | Quiz history with score |

Common settings: name, type, description, banner, eligibility, attempts, daily limit, start and end dates, rewards, probability, campaign rules and status. A **probability simulator** shows the expected distribution and reward cost before a game is published.

## M-07 Points & Reward Service (brief §3.8)
- **Play Points (PP):** the gamification currency, kept in an append-only `points_ledger` with a locked balance row. It is fully separate from Capillary loyalty points. PP can expire (FIFO buckets, configurable).
- **Reward catalogue:** categories and items of these types:
  - `capillary_points` (Suntec+ loyalty points awarded through Capillary)
  - `digital_voucher` (Voucher Management System)
  - `merchant_voucher` (merchant-funded code pool or VMS series)
  - `promo_gift` (collect at the concierge with a QR claim code)
  - `exclusive_reward`
  - `privilege` (for example a VIP lounge pass, a time-bound entitlement)
  - `play_points` and `bonus_attempt` (internal)
- **Inventory:** total quantity, remaining quantity, daily cap and per-member cap, with row-locked decrement and low-stock alerts.
- **Allocation channels:** game outcome, mission or check-in reward, badge reward, catalogue redemption (a member spends PP), and manual admin allocation (needs reason and audit; optional approval above a threshold).
- **Reward transaction lifecycle:** `pending → issued → redeemed | expired`, or `pending → failed → retrying → issued | cancelled`. Every transaction carries the external reference (Capillary transaction ID or voucher code).
- **Redemption tracking:** VMS or Capillary redemption webhooks, plus concierge scan for gifts.
- Expiry reminders are sent N days before expiry (configurable).

## M-08 Badge & Achievement Service (brief §3.7)
- **Badges:** name, artwork, description, tier (bronze, silver, gold), hidden or visible, and criteria. Criteria are a declarative rule, for example `checkin_streak >= 30`, `missions_completed >= 10`, `distinct_stores >= 15`, `quiz_wins >= 5`, `monthly_rank <= 3` or `spend_total >= 1000`.
- **Seeded examples:** First Check-in, Super Shopper, Mission Master, Quiz Champion, Shopping Explorer, Monthly Champion, Loyalty Star.
- Awarded automatically by domain-event evaluation. Each badge is granted once (unique per member and badge). A badge can carry its own reward.
- Milestones show progress toward the next badge. The collection is displayed as a grid with locked silhouettes, plus a history.

## M-09 Leaderboard Service (brief §3.6)
- **Leaderboard definitions:** metric (PP earned, missions completed, activities, quiz score), periods (daily, weekly, monthly, overall, or a custom campaign window), scope (global or campaign) and an optional segment filter.
- **Scoring:** incremental upserts into `leaderboard_scores (board, period_key, member)` inside the same transaction as the scoring event. Rankings use an index-backed `ORDER BY score DESC` and are cached for 30 s. Ties are broken by the earliest time the score was reached.
- **Privacy:** display mode is set per board (masked "Ta*** L." by default, or nickname). Members can opt out, and admins can hide any entry.
- "My rank" endpoint, with top N plus the ranks around the member.
- Period-end snapshots are frozen for history and for prize awarding ("Monthly Champion").

## M-10 Notification Service (brief §11)
- **Templates** per event key: campaign launched, mission available, check-in reminder, mission completed, game result, reward allocated, reward expiring, badge unlocked and leaderboard rank change. Each template has channels (in-app inbox, push, email), variables such as `{{first_name}}` and `{{reward_name}}`, a preview, and quiet hours.
- In-app inbox is built in, with read and unread state. **Push is sent through the existing Suntec+ push service** using the push adapter and deep links. We do not use our own FCM or APNs.
- Dispatch runs through the outbox, with frequency capping (for example a maximum of 3 pushes per member per day) and member preferences.

## M-11 Admin & Access Control
Six roles, with permissions checked in the API and in SQL:

| Permission | Super Admin | Campaign Admin | Marketing | Customer Service | Reporting | Read-Only |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Manage staff users and roles, API clients and settings | ✔ | | | | | |
| Create, edit, publish campaigns, games, missions and probabilities | ✔ | ✔ | | | | |
| Edit content (banners, copy, notification templates, quiz questions) | ✔ | ✔ | ✔ | | | |
| Manage rewards and inventory | ✔ | ✔ | | | | |
| Customer search and 360 view | ✔ | ✔ | ✔ (masked) | ✔ | | ✔ (masked) |
| Manual reward or attempt grant, retry failed reward, flag or block | ✔ | ✔ | | ✔ (within limits) | | |
| Reports, exports and dashboards | ✔ | ✔ | ✔ | | ✔ | ✔ |
| Audit log | ✔ | view own | | | | |

Every admin write is written to the append-only audit log with before/after values.

## M-12 Analytics & Reporting (brief §12)
- **Dashboard:**
  - registered and active participants
  - total plays
  - missions completed
  - rewards distributed and redeemed
  - most popular games
  - campaign performance
  - engagement trends
  - daily, weekly and monthly statistics
- **Ten reports:**
  1. Customer Participation
  2. Game Performance
  3. Mission Completion
  4. Reward Allocation
  5. Reward Redemption
  6. Campaign Performance
  7. Customer Engagement (retention D1/D7/D30, streaks)
  8. Daily & Monthly Activity
  9. Customer Segmentation
  10. Failed API & Reward Transactions
- **Filters:** date range, campaign, game type, segment, participation status and reward type.
- **Export:** CSV (streamed) and Excel (.xlsx). Large exports run as background jobs and are delivered as a download link.
- **BI integration:** a read-only `reporting` schema of curated views. Power BI connects through a dedicated read-only Postgres role, or through authenticated CSV/JSON report endpoints (`/api/v1/admin/reports/...`).

## M-13 Integration Layer
- **LoyaltyAdapter (Capillary):** lookupMember, getMember, getPointsBalance (for display only), awardPoints, deductPoints and reverse. All calls are idempotent.
- **VoucherAdapter (VMS):** issueVoucher(series), getVoucherStatus, cancelVoucher.
- **PushAdapter:** send(memberId, template, deepLink).
- **Event ingest:** `POST /integrations/events` for transactions, mall visits, voucher redemptions and campaign participation, deduplicated by `(source, external_id)`.
- **Outbox worker:** exponential backoff (1 min → 6 h, 10 attempts), dead-letter queue to the "Failed transactions" screen, with manual retry or cancel.
- **Mock implementations** of all three adapters, so development and SIT can run before Capillary access is granted.
