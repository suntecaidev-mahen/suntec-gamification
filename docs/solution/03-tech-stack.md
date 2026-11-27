# 3. Recommended Technology Stack & Justification

## 3.1 Recommended stack

| Layer | Technology | Why |
|---|---|---|
| Database | **PostgreSQL 15+ on Supabase** (Singapore region, ap-southeast-1) | Relational integrity, ACID transactions and row-level locks, which suit ledgers and inventory. Row Level Security gives defence in depth. Fully managed, with backups, PITR and read replicas. Data residency in Singapore helps with PDPA. |
| Engine "critical path" | **PL/pgSQL functions (RPC)** with SECURITY DEFINER and a pinned `search_path` | Game resolution, inventory decrement, ledger posting and idempotency all happen in **one transaction next to the data**. This rules out race conditions such as double spends or overselling a prize, and the logic can't be tampered with from the client. |
| API and web | **Next.js (App Router) + TypeScript** on **Vercel** | One language across API, admin, portal and embed. Route handlers serve the versioned REST API. Server components keep secrets on the server. Edge CDN, preview environments per branch and zero-ops scaling. |
| UI | **Tailwind CSS v4** + a shared design-token package | Consistent white and orange branding across admin, portal and embed. Tokens are verified for WCAG AA contrast by an automated script. |
| Validation and contracts | **Zod** → OpenAPI 3.1 generation | The same schema validates requests at runtime and generates the Swagger/OpenAPI spec, so documentation never drifts from the code. |
| Auth | **Supabase Auth** (JWT, MFA, OTP; SAML SSO on the Team plan) plus custom handoff codes | Covers the customer handoff, portal OTP or OIDC, and staff MFA without building our own auth. |
| Realtime | Supabase Realtime (Postgres changes on the member's inbox) | Near-real-time progress and reward notifications without polling. |
| Files | Supabase Storage (banners, badge art, quiz images) with a CDN | Signed uploads with access policies. |
| Jobs | **pg_cron** (scheduling) + **pg_net** / Vercel Cron (HTTP) | Campaign activation and expiry, streak resets, rollups, outbox sweeps and retention jobs. |
| Charts and exports | Recharts, streamed CSV, ExcelJS (.xlsx) | Required by the report formats in brief §12. |
| Testing | Vitest (unit), SQL integration tests against an isolated Supabase project, Playwright (E2E), k6 (performance), OWASP ZAP (DAST) | Covers the SIT, performance and security deliverables. |
| Observability | Sentry (errors), Vercel and Supabase logs, structured JSON logs with request IDs, Better Stack or UptimeRobot (uptime) | Centralised logging, error monitoring and alerting. |
| CI/CD | GitHub Actions: lint, typecheck, test, migration check, then deploy to DEV → SIT → UAT → PROD with approvals | Secure, repeatable deployments with separate environments. |
| Mobile integration | WebView kits for **Swift (WKWebView)**, **Kotlin (Android WebView)**, **React Native (react-native-webview)** and **Flutter (webview_flutter)**, plus a JS bridge | We don't need to rebuild the Suntec+ app. Releases of the gamification UI ship without an app-store release, so the app's performance and size stay unaffected. |

## 3.2 Why a WebView module rather than native screens?
- **No app release for every campaign change:** campaigns, wheels and quizzes change weekly, and server-delivered UI avoids an app-store cycle each time.
- **One implementation for iOS, Android and web**, which lowers the cost and keeps behaviour consistent with the web portal.
- **The native app's binary and start-up performance are untouched.** The module loads only when the user opens "Play & Win".
- Native touches are kept through the JS bridge: haptics, close, share, open a native screen through a deep link, and push permission prompts.
- If Suntec+ later wants fully native screens, every capability is already available through the same REST API. The WebView is a convenience, not a lock-in.

## 3.3 Alternatives considered

| Option | Verdict |
|---|---|
| Enterprise cloud (NestJS or .NET microservices + RDS PostgreSQL + Redis + API Gateway on AWS or Azure) | A valid choice if Suntec+ IT requires its own cloud tenancy. It costs roughly 2–3× more to build and run, and adds a DevOps burden. Our modular monolith maps 1:1 onto these services, so migration remains possible (§3.5). |
| Building inside Capillary (native gamification features) | Limited flexibility for custom games and admin UX, and it creates vendor lock-in. We integrate with Capillary instead. |
| Firebase / NoSQL | Weaker transactional guarantees for ledgers and inventory, and reporting is harder. |
| Native screens in the Suntec+ app | Higher cost per platform, slower campaign iteration, and risk to the existing app. |

## 3.4 Existing-environment assessment checklist (M0, with Suntec+ IT)
Brief §8 requires us to assess the current environment before the stack is finalised. The items below must be confirmed in Discovery. Any "blocking" answer triggers a stack review.

| # | Question | Impact if different |
|---|---|---|
| 1 | Mobile app framework (native, React Native, Flutter) and minimum OS versions | Which integration kit we ship and harden |
| 2 | Suntec+ identity provider (custom, Capillary, Auth0, Cognito, Azure AD B2C) and whether it supports OIDC | Portal SSO design |
| 3 | Capillary modules licensed (Loyalty+, Engage+, coupons), API rate limits and sandbox availability | Adapter implementation, retry strategy |
| 4 | Voucher system: Capillary coupons or a separate VMS, and how series and codes are issued | VoucherAdapter |
| 5 | How transaction and receipt data is available (Capillary webhooks, mall POS, Suntec+ backend) | Mission event ingest |
| 6 | Push provider (FCM/APNs through Suntec+ backend, Capillary Engage, OneSignal) | PushAdapter |
| 7 | Mandatory cloud, region and security policies (for example "must be on AWS under the Suntec+ account", SSO for staff, SIEM log forwarding) | Hosting choice (Supabase/Vercel or self-managed) |
| 8 | Data classification and PDPA DPO requirements, retention policy | Retention jobs, masking |
| 9 | Expected member counts, DAU and campaign peaks | Supabase compute tier, load-test targets |
| 10 | Existing BI tool (Power BI workspace, gateway) | Reporting connection method |

## 3.5 Portability (an exit plan if IT requires its own cloud)
- **Database:** standard PostgreSQL. Migrations are plain SQL and run on Amazon RDS or Azure Database for PostgreSQL. Supabase-specific pieces (`auth.uid()` helpers, Storage, Realtime) are isolated in a small number of functions.
- **Application:** Next.js runs on any Node host (AWS ECS/Fargate, Azure App Service, Kubernetes) through `next build && next start` or a Docker image.
- **Auth:** the adapter pattern lets Supabase Auth be replaced with Cognito or Azure AD B2C by reimplementing `getSession()` and the JWT verification.
