# 8. Customer Web Portal Wireframes

The portal uses the same components as the in-app module, with a responsive layout: on mobile it is the same as the in-app module, on tablet it has 2 columns, and on desktop a sidebar with 3 columns.

**Login.** Suntec+ SSO is preferred, with email OTP as the fallback.

## 8.1 Login
```
┌───────────────────────────────────────────────┐
│            ● Suntec+  Play & Win               │
│   Play games, complete missions, earn rewards  │
│   [  Continue with Suntec+ account  ]          │ ← OIDC SSO (if available)
│   ───────────── or ─────────────               │
│   Email  [ you@example.com        ]            │
│   [ Send me a code ]                           │
│   Enter 6-digit code [ _ _ _ _ _ _ ]           │
│   First time? We'll link your Suntec+ membership│
│   (card number + date of birth verification)   │
│   Privacy notice · Terms                       │
└───────────────────────────────────────────────┘
```

## 8.2 Desktop dashboard
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ● Suntec+ Play & Win                                       🔔 3   Tan ▾       │
├────────────┬─────────────────────────────────────────────┬───────────────────┤
│ ◉ Home     │ Good evening, Tan                            │ Leaderboard (Nov) │
│ Games      │ ┌──────────────┐┌──────────────┐┌──────────┐ │ 🥇 Me** L.  9,980 │
│ Missions   │ │ 1,240 PP     ││ 🔥 6-day     ││ 7 badges │ │ 🥈 Ja** T.  8,210 │
│ Check-in   │ │ Play Points  ││ [Check in]   ││ of 20    │ │ 🥉 Ro** K.  7,440 │
│ Leaderboard│ └──────────────┘└──────────────┘└──────────┘ │ …                 │
│ Badges     │ Available games                              │ ▶ #42 You  2,140  │
│ Rewards    │ ┌────────────┐┌────────────┐┌────────────┐   ├───────────────────┤
│ History    │ │ 🎡 Year-End││ 🎫 Festive ││ ❓ Suntec  │   │ Upcoming campaigns│
│ Profile    │ │ Spin       ││ Scratch    ││ Trivia     │   │ Christmas Quiz    │
│            │ │ 1 free left││ 2 cards    ││ 5 Qs · 50PP│   │ starts 1 Dec      │
│            │ │ [Play]     ││ [Play]     ││ [Start]    │   │                   │
│            │ └────────────┘└────────────┘└────────────┘   │                   │
│            │ Active missions                    View all › │                   │
│            │ Spend $50 at partners  ▓▓▓▓▓▓▓░░░ $34/$50     │                   │
│            │ Visit 3 stores         ▓▓▓▓░░░░░░ 1/3         │                   │
└────────────┴─────────────────────────────────────────────┴───────────────────┘
```

## 8.3 Other portal pages
| Page | Content |
|---|---|
| Games | Cards for every available game. Opens the same Spin, Scratch and Quiz player used in the app. |
| Missions | Daily, Weekly, Monthly and Completed tabs, progress, join button, mission detail |
| Check-in | Calendar history, streak ladder, check-in button (QR check-in in the app only) |
| Leaderboard | Period tabs, top 3 podium, ranking table, "My rank", privacy setting link |
| Badges | Collection grid, locked silhouettes with criteria, achievement history |
| Rewards | **Catalogue** (redeem with PP, stock indicator) and **My Rewards** (code and QR, expiry, status) |
| History | Unified timeline with type filter and infinite scroll |
| Profile | Linked Suntec+ membership, leaderboard display name and opt-out, notification preferences, privacy notice, "download my data" request |
