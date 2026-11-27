# 4. API Catalogue (with sample payloads)

The full machine-readable spec (OpenAPI 3.1) is generated from the Zod schemas in M2 and published at `/api/v1/openapi.json` and `docs/openapi.yaml`. This chapter covers the conventions and every endpoint, with samples for the key flows.

## 4.1 Conventions

| Item | Rule |
|---|---|
| Base URL | `https://{env-host}/api/v1` (for example `https://play.suntecplus.sg/api/v1`) |
| Format | JSON (`application/json; charset=utf-8`). Times are ISO-8601 in UTC with `Z`. Business days are `YYYY-MM-DD` in SGT. Money is in SGD cents (integers). |
| Auth: customer | `Authorization: Bearer <member JWT>` or the session cookie set by `/auth/exchange` |
| Auth: server-to-server | `X-API-Key: <key>`. Optional `X-Signature: t=<unix>,v1=<HMAC-SHA256(body)>` (5-minute replay window) |
| Auth: admin | Staff session (MFA) plus RBAC permission per endpoint |
| Idempotency | **Required** on every value-moving `POST`: `Idempotency-Key: <UUIDv4>`. A replay within 24 h returns the original response with `Idempotent-Replayed: true`. The same key with a different body returns `409 IDEMPOTENCY_CONFLICT`. |
| Rate limits | Customer: 60 req/min (10/min on game start). Per IP: 300/min. API client: configurable (default 1,200/min). Headers: `RateLimit-Limit`, `RateLimit-Remaining`, `Retry-After`. |
| Pagination | Cursor based: `?limit=20&cursor=…` (max 100), response `{ data: [...], next_cursor }` |
| Tracing | `X-Request-Id` echoed back or generated, and logged on every hop |
| Errors | `{ "error": { "code": "GAME_LIMIT_REACHED", "message": "…", "details": {...}, "request_id": "…" } }` |

### Status and error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed JSON or missing header |
| 401 | `AUTH_REQUIRED` / `TOKEN_EXPIRED` / `HANDOFF_INVALID` | Not authenticated |
| 403 | `FORBIDDEN` / `NOT_ELIGIBLE` / `MEMBER_BLOCKED` | Authenticated but not allowed |
| 404 | `NOT_FOUND` | Unknown resource, or not visible to the caller |
| 409 | `IDEMPOTENCY_CONFLICT` / `IDEMPOTENCY_IN_PROGRESS` | Duplicate request handling |
| 409 | `GAME_LIMIT_REACHED` / `COOLDOWN_ACTIVE` / `ALREADY_CHECKED_IN` / `MISSION_ALREADY_COMPLETED` / `OUT_OF_STOCK` / `INSUFFICIENT_POINTS` / `NO_ATTEMPTS_LEFT` / `CAMPAIGN_INACTIVE` | Business rule rejected |
| 410 | `SESSION_EXPIRED` | Game session (for example a quiz) timed out |
| 422 | `VALIDATION_FAILED` | Field-level errors in `details.fields` |
| 429 | `RATE_LIMITED` | Too many requests. Check `Retry-After`. |
| 500 | `INTERNAL_ERROR` | Unexpected. Logged with the request ID. |
| 503 | `UPSTREAM_UNAVAILABLE` | Capillary or VMS is down (used only on synchronous lookups; rewards are queued instead) |

## 4.2 Endpoint list

### A. Customer APIs (member auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/me` | Gamification profile (tier, PP balance, streak, badge count, ranks) |
| PATCH | `/me/preferences` | Leaderboard display mode, notification preferences |
| GET | `/me/dashboard` | Aggregated home screen data (one call for the app dashboard) |
| GET | `/me/history` | Participation history across all activity types (filter `type`) |
| GET | `/me/points` | Play Points balance and ledger |
| GET | `/me/badges` | Earned and locked badges, with progress |
| GET | `/me/notifications` · POST `/me/notifications/{id}/read` · POST `/me/notifications/read-all` | Inbox |

### B. Game APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/games?type=spin_wheel\|scratch_card\|quiz&campaign_id=` | Available games, with the member's remaining attempts |
| GET | `/games/{gameId}` | Display config (wheel segments without weights, card art, quiz meta) |
| GET | `/games/{gameId}/eligibility` | Validate participation: eligible, reason, attempts left, cost options |
| POST | `/games/{gameId}/sessions` 🔑 | **Start a game session.** Validates and charges the attempt. Spin and scratch return the outcome, quiz returns the questions. |
| POST | `/game-sessions/{sessionId}/submit` 🔑 | Submit results (quiz answers, or scratch reveal confirmation) and calculate the reward |
| GET | `/game-sessions/{sessionId}` | Session status and result |
| GET | `/me/game-sessions?game_type=&cursor=` | Game history |

### C. Mission APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/missions?status=available\|active\|completed&period=` | Available missions and the member's progress |
| GET | `/missions/{missionId}` | Detail, objective, progress, reward, validity |
| POST | `/missions/{missionId}/enrol` 🔑 | Enrol (opt-in missions) |
| GET | `/me/missions` | My missions (active and completed), with progress |
| *(server)* | via `POST /integrations/events` | Progress updates, completion validation and reward allocation all happen on the server from events. The client can't post progress. |

### D. Check-in APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/checkins/status` | Eligibility today, current streak, next reward preview |
| POST | `/checkins` 🔑 | Daily check-in (optional `qr_token` for location-verified check-in) |
| GET | `/me/checkins?from=&to=` | Check-in history (calendar) |
| GET | `/me/checkins/streak` | Current and best streak, ladder progress |

### E. Reward APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/rewards?category=&cursor=` | Reward catalogue (items redeemable with PP) |
| GET | `/rewards/{rewardId}` | Detail, stock state, cost |
| GET | `/rewards/{rewardId}/eligibility` | Validate reward eligibility |
| POST | `/rewards/{rewardId}/redeem` 🔑 | Redeem with PP (allocates the reward and starts delivery) |
| GET | `/me/rewards?status=` | My rewards (vouchers, codes, expiry) |
| GET | `/me/reward-transactions?cursor=` | Reward transaction history |
| GET | `/reward-transactions/{txnId}` | Check reward status (pending, issued, failed, redeemed, expired) |

### F. Leaderboard APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/leaderboards` | Boards available to the member |
| GET | `/leaderboards/{boardId}?period=daily\|weekly\|monthly\|overall&period_key=&limit=` | Ranking |
| GET | `/leaderboards/{boardId}/me?period=` | Customer ranking, with neighbours |

### G. Admin APIs (staff auth + RBAC; every write is audited)

| Area | Endpoints |
|---|---|
| Campaigns | `GET/POST /admin/campaigns` · `GET/PATCH/DELETE /admin/campaigns/{id}` · `POST /admin/campaigns/{id}/publish` · `/pause` · `/preview-link` |
| Games | `GET/POST /admin/games` · `GET/PATCH /admin/games/{id}` · `PUT /admin/games/{id}/segments` · `PUT /admin/games/{id}/questions` · `POST /admin/games/{id}/simulate` |
| Missions | `GET/POST /admin/missions` · `GET/PATCH /admin/missions/{id}` |
| Check-in programmes | `GET/POST /admin/checkin-programs` · `PATCH /admin/checkin-programs/{id}` |
| Rewards | `GET/POST /admin/rewards` · `PATCH /admin/rewards/{id}` · `POST /admin/rewards/{id}/inventory` (adjust) · `GET /admin/reward-transactions?status=failed` · `POST /admin/reward-transactions/{id}/retry` · `/cancel` · `POST /admin/allocations` 🔑 (manual) |
| Eligibility and segments | `GET/POST /admin/segments` · `POST /admin/segments/{id}/preview` · `GET/POST /admin/eligibility-rules` |
| Badges, leaderboards | `GET/POST/PATCH /admin/badges` · `GET/POST/PATCH /admin/leaderboards` · `POST /admin/leaderboards/{id}/entries/{memberId}/hide` |
| Notifications | `GET/POST/PATCH /admin/notification-templates` · `POST /admin/notification-templates/{id}/test` |
| Customers | `GET /admin/customers?q=<member id \| card no \| email>` · `GET /admin/customers/{id}` (360 view) · `POST /admin/customers/{id}/attempts` 🔑 · `POST /admin/customers/{id}/flag` · `/block` · `/unblock` · `POST /admin/customers/{id}/export` · `/anonymise` |
| Reports | `GET /admin/reports/{reportKey}?from=&to=&campaign_id=&game_type=&segment_id=&status=&reward_type=&format=json\|csv\|xlsx` · `POST /admin/exports` (async) · `GET /admin/exports/{id}` |
| Access | `GET/POST /admin/users` · `PATCH /admin/users/{id}/roles` · `GET /admin/audit-logs` · `GET/POST /admin/api-clients` · `POST /admin/api-clients/{id}/rotate` |

### H. Integration APIs (server-to-server, `X-API-Key`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/integrations/sessions` | Suntec+ backend creates an in-app session handoff code for a logged-in member |
| POST | `/auth/exchange` | WebView exchanges the code for a gamification session (public, single use) |
| POST | `/integrations/events` 🔑 | Transactions, mall visits, voucher redemptions, campaign participation and generic activities |
| POST | `/integrations/webhooks/capillary` | Capillary callbacks (points reversal, member tier change). Signature verified. |
| POST | `/integrations/webhooks/vouchers` | VMS redemption and expiry callbacks |
| GET | `/integrations/members/{memberId}/summary` | Summary for native app widgets (PP, streak, unread count) |
| GET | `/health` · `/openapi.json` | Liveness and readiness, spec |

🔑 = `Idempotency-Key` header required.

## 4.3 Sample requests and responses

### Start a Spin & Win session
```http
POST /api/v1/games/9b1c…/sessions
Authorization: Bearer eyJ…
Idempotency-Key: 6f1d8c1e-0d2a-4f7b-9a59-3c1a1b5b9e21
Content-Type: application/json

{ "payment": "free", "device_id": "a1f3…" }
```
```json
201 Created
{
  "session": {
    "id": "GS-20261127-8F3K2Q",
    "game_id": "9b1c…",
    "game_type": "spin_wheel",
    "status": "completed",
    "started_at": "2026-11-27T04:12:09Z",
    "outcome": {
      "segment_index": 3,
      "segment_label": "$5 Dining Voucher",
      "is_win": true
    },
    "reward": {
      "transaction_id": "RT-20261127-QW81ZD",
      "type": "digital_voucher",
      "name": "$5 Dining Voucher",
      "status": "pending",
      "expires_at": "2026-12-27T15:59:59Z"
    }
  },
  "attempts_left_today": 0,
  "points_balance": 1240
}
```
Errors: `409 NO_ATTEMPTS_LEFT`, `409 COOLDOWN_ACTIVE {retry_at}`, `403 NOT_ELIGIBLE {reason:"tier"}`, `409 CAMPAIGN_INACTIVE`, `409 INSUFFICIENT_POINTS`.

### Start a quiz, then submit answers
```json
// POST /api/v1/games/{quizId}/sessions → 201
{
  "session": {
    "id": "GS-20261127-K2M9AA",
    "game_type": "quiz",
    "status": "in_progress",
    "expires_at": "2026-11-27T04:14:09Z",
    "questions": [
      { "id": "q_81", "text": "Which Suntec City landmark is the world's largest fountain (1998)?",
        "options": [ {"id":"a","text":"Fountain of Wealth"}, {"id":"b","text":"Merlion"},
                     {"id":"c","text":"Spectra"}, {"id":"d","text":"Jewel Rain Vortex"} ],
        "time_limit_s": 20 }
    ]
  }
}
```
```json
// POST /api/v1/game-sessions/GS-20261127-K2M9AA/submit   (Idempotency-Key required)
{ "answers": [ { "question_id": "q_81", "option_id": "a" } ] }

// 200 OK — scored on the server; answer timing uses server timestamps
{
  "session": { "id": "GS-20261127-K2M9AA", "status": "completed",
               "score": 850, "correct": 5, "total": 5, "passed": true },
  "reward": { "transaction_id": "RT-20261127-ZZ19PL", "type": "play_points", "amount": 50, "status": "issued" },
  "leaderboard": { "board_id": "quiz-monthly", "period_key": "2026-11", "rank": 42 }
}
```

### Daily check-in
```json
// POST /api/v1/checkins   (Idempotency-Key required)
{ "qr_token": null }

// 201 Created
{
  "checkin": { "day": "2026-11-27", "streak": 7, "best_streak": 12 },
  "rewards": [
    { "transaction_id": "RT-…", "type": "play_points", "amount": 10, "reason": "daily" },
    { "transaction_id": "RT-…", "type": "play_points", "amount": 100, "reason": "streak_day_7" }
  ],
  "next_milestone": { "streak": 14, "reward": "Bonus Spin + 200 PP" },
  "badges_unlocked": []
}
// Second call the same day → 409 ALREADY_CHECKED_IN (or replay of the original if same Idempotency-Key)
```

### Redeem a catalogue reward
```json
// POST /api/v1/rewards/{rewardId}/redeem   (Idempotency-Key required)
{}
// 201 Created
{
  "transaction": { "id": "RT-20261127-7HG2LM", "reward_id": "…", "name": "500 Suntec+ Points",
                   "type": "capillary_points", "cost_pp": 1000, "status": "pending" },
  "points_balance": 240
}
// GET /api/v1/reward-transactions/RT-20261127-7HG2LM → { "status": "issued", "external_ref": "CAP-TX-55102" }
```

### Ingest a purchase event (Suntec+ / Capillary → platform)
```http
POST /api/v1/integrations/events
X-API-Key: sk_live_…
X-Signature: t=1795579929,v1=5f2a…
Idempotency-Key: capillary-txn-88213377
```
```json
{
  "type": "transaction",
  "external_id": "capillary-txn-88213377",
  "member_id": "SUN-00012345",
  "occurred_at": "2026-11-27T03:58:00Z",
  "data": { "merchant_id": "M-0412", "store_name": "Uniqlo", "amount_cents": 6850, "currency": "SGD" }
}
```
```json
202 Accepted
{
  "event_id": "EV-…",
  "status": "processed",
  "effects": [
    { "type": "mission_progress", "mission": "Spend $50 at participating merchants", "progress": "68.50/50.00", "completed": true },
    { "type": "attempt_granted", "game": "Year-End Spin", "count": 1 }
  ]
}
```

### Create an in-app session handoff (Suntec+ backend)
```json
// POST /api/v1/integrations/sessions   (X-API-Key)
{ "member_id": "SUN-00012345", "return_url": "suntecplus://home", "entry": "spin" }
// 201
{ "code": "hc_Q8m1…", "expires_at": "2026-11-27T04:13:09Z",
  "url": "https://play.suntecplus.sg/embed?code=hc_Q8m1…&entry=spin" }
```

### Admin: configure a wheel
```json
// PUT /api/v1/admin/games/{id}/segments   (Campaign Admin)
{
  "segments": [
    { "label": "50 PP",              "color": "#F97316", "prize_id": "rw_pp50",   "weight_bp": 3000 },
    { "label": "$5 Dining Voucher",  "color": "#FED7AA", "prize_id": "rw_v5",     "weight_bp": 1500, "fallback": "renormalize" },
    { "label": "Try Again",          "color": "#FFFFFF", "prize_id": null,        "weight_bp": 5500 }
  ]
}
// 422 VALIDATION_FAILED if weights ≠ 10000 → { "details": { "fields": { "segments": "weights sum to 9800 bp (98.00%); must equal 100%" } } }
```

## 4.4 Logging and audit for every API
- **Access log:** request ID, route, actor (member ID, staff user or API client), status, latency, IP hash and user-agent. Personal data is redacted.
- **Domain log:** every value-moving operation writes a ledger or transaction row that can be traced from the request ID.
- **Admin audit log:** actor, role, action, entity, before/after (JSON diff), IP and timestamp. It is append-only.
