# Suntec+ Gamification & Customer Engagement Platform — Solution Pack

> **Status:** Draft for approval (pre-development). Version 0.1 · 27 Nov 2026
> **Scope:** This is an *enhancement* to the existing Suntec+ ecosystem. It does not replace the Suntec+ app or the Capillary loyalty platform.

This pack answers section 16 of the project brief ("Expected Output from the AI Development Team"). Development continues module by module once it is approved.

| # | Deliverable | Document |
|---|---|---|
| 1 | Proposed solution architecture | [01-architecture.md](01-architecture.md) |
| 2 | Functional module breakdown | [02-modules.md](02-modules.md) |
| 3 | Recommended technology stack and justification | [03-tech-stack.md](03-tech-stack.md) |
| 4 | API list with sample requests and responses | [04-api-catalogue.md](04-api-catalogue.md) |
| 5 | Database design and ER diagram | [05-database-erd.md](05-database-erd.md) |
| 6 | Mobile app UI/UX wireframes | [06-wireframes-mobile.md](06-wireframes-mobile.md) |
| 7 | Admin control panel wireframes | [07-wireframes-admin.md](07-wireframes-admin.md) |
| 8 | Customer web portal wireframes | [08-wireframes-portal.md](08-wireframes-portal.md) |
| 9 | End-to-end customer journeys | [09-customer-journeys.md](09-customer-journeys.md) |
| 10 | Integration flow with Suntec+ and Capillary | [10-integration-capillary.md](10-integration-capillary.md) |
| 11 | Development timeline and milestones | [11-timeline.md](11-timeline.md) |
| 12 | Resource estimation and cost breakdown | [12-resources-cost.md](12-resources-cost.md) |

## Executive summary

- **One gamification platform, many experiences.** A single backend engine runs Daily Check-in, Missions, Spin & Win, Scratch & Win, Quiz & Trivia, Leaderboards, Badges and a Reward catalogue. New game types plug into a game-type registry, so the core never has to be rewritten.
- **The Suntec+ app does not need to be rebuilt.** A new **"Play & Win"** menu item opens the mobile-optimised gamification UI inside the existing iOS and Android app through a secure WebView with a single-sign-on token handoff. We supply integration kits for native Swift, native Kotlin, React Native and Flutter, because the app's framework is not yet confirmed.
- **Capillary stays the system of record.** Loyalty points and vouchers are never duplicated. The platform calls Capillary and the voucher system through an adapter, using idempotency keys and an outbox with retries. Our own **Play Points** (the gamification currency) are kept in a separate ledger. They drive leaderboards and can be redeemed in the reward catalogue.
- **Outcomes are decided on the server.** Game results, rewards and points are calculated only on the backend, using a cryptographically secure RNG, row-level locks and idempotency. The client never sends reward values.
- **Business users run everything without developers.** The admin control panel has six RBAC roles. It covers campaigns, games, probabilities, missions, rewards, segments, notification templates and reports, and every change is written to the audit log.
- **Stack:** Supabase (PostgreSQL, Auth, Storage, Singapore region) and Next.js/TypeScript on Vercel. This was chosen for delivery speed and managed operations, and the architecture keeps a clean path to an enterprise cloud if Suntec+ IT requires one. See [03-tech-stack.md](03-tech-stack.md).
- **Indicative delivery:** about 22 weeks to go-live, followed by hypercare. See [11-timeline.md](11-timeline.md) and [12-resources-cost.md](12-resources-cost.md).

## Key decisions recorded

| Decision | Choice |
|---|---|
| Platform stack | Supabase + Next.js (App Router, TypeScript, Tailwind), hosted in AWS ap-southeast-1 (Singapore) |
| Codebase | Monorepo with one Next.js app (admin, portal, embed and API) plus shared packages. Admin is served on its own hostname. |
| Customer identity | Suntec+ SSO token handoff inside the app. On the web portal, Suntec+ SSO (OIDC) if available, otherwise email OTP linked to the Suntec+ member ID. |
| Loyalty and vouchers | Capillary and the voucher system are authoritative. A mock adapter is used until API access is granted. |
| Gamification currency | **Play Points**: a separate, redeemable ledger that is never mixed with Capillary points |
| Mobile app framework | Unknown, so the integration kits cover Swift, Kotlin, React Native and Flutter |
| Locale | SGD, Asia/Singapore (daily resets at 00:00 SGT, configurable), English |
| Documentation | Markdown and Mermaid in `docs/`, versioned with the code |

## Assumptions to validate during Discovery (Milestone 0)

1. Capillary API access is available for member lookup, points award and deduct, coupon issue and coupon redemption status. The exact endpoints are to be confirmed with Capillary and Suntec+ IT.
2. The Suntec+ backend can call our API from a server, using an API key, to start an embed session for a logged-in member.
3. The Suntec+ app can add a menu item that opens a WebView, and can forward the push-notification deep links we define.
4. Transaction and receipt data (purchases at participating merchants) can be sent to us as events, either from Capillary transaction webhooks or from the Suntec+ backend.
5. Volume baseline for sizing: 300k registered members, up to 30k daily active gamers, and campaign-launch peaks of 200 game plays per second. See [01-architecture.md](01-architecture.md#17-non-functional-targets).

## Later SDLC deliverables (brief §15) and when they are produced

| Deliverable | Produced in |
|---|---|
| BRD, FRS | M0, built from this pack after workshops |
| Architecture, system diagram, ERD, OpenAPI spec | This pack, then the generated `openapi.yaml` in M2 |
| Backend, admin, portal and mobile-integration source code | M1–M4 (this repository) |
| UI/UX designs and prototypes | M0–M1 (Figma), alongside the wireframes in this pack |
| SIT and UAT test cases | M5 (`docs/testing/`) |
| Security and performance test reports | M5 |
| Deployment guide (`SETUP.md`), API integration guide (`docs/INTEGRATION.md`), admin manual, support runbook | M4–M6 |
