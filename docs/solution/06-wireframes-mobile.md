# 6. Mobile App UI/UX Wireframes (in-app "Play & Win")

**Approach.** The existing Suntec+ app gets one new menu entry, **"Play & Win"**. It opens our mobile-first module in a full-screen WebView. The module follows the white and orange brand tokens and can adopt the official Suntec+ brand guidelines (fonts, logo, icon set) when they are supplied in M0.

**Design principles**
- Thumb-friendly targets of at least 44 px.
- Bottom tab bar for sections.
- Skeleton loaders instead of spinners.
- 60 fps transform animations.
- `prefers-reduced-motion` alternatives.
- Screen-reader labels.
- A live region that announces results.
- Haptics are triggered through the native bridge.

Legend: `[ Button ]` · `( chip )` · `▓▓▓░░` progress · `◉` active tab

## 6.1 Entry point inside the existing app
```
┌──────────────────────────────┐
│ Suntec+                   ☰  │   existing app (unchanged)
│ ...                          │
│ ┌──────────────────────────┐ │
│ │ 🎁  Play & Win      NEW ›│ │ ← new menu item / home tile
│ │  Spin, check in & earn   │ │   (deep link: suntecplus://play)
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

## 6.2 Gamification Home (dashboard)
```
┌──────────────────────────────┐
│ ✕                Play & Win  │ ← ✕ = bridge.close()
│ Good morning, Tan 👋         │
│ ┌──────────────────────────┐ │
│ │ PLAY POINTS      1,240 PP│ │  orange card
│ │ Rank #42 this month  🏆  │ │
│ └──────────────────────────┘ │
│ ┌────────────┐┌────────────┐ │
│ │ 🔥 Day 6   ││ [Check in] │ │  check-in status
│ │ streak     ││  +10 PP    │ │
│ └────────────┘└────────────┘ │
│ Play now                     │
│ ┌──────┐ ┌──────┐ ┌──────┐   │
│ │ 🎡   │ │ 🎫   │ │ ❓   │   │  available games
│ │ Spin │ │Scratch│ │ Quiz │  │  (badge: "1 free")
│ └──────┘ └──────┘ └──────┘   │
│ Active missions          All›│
│ Spend $50 at partners        │
│ ▓▓▓▓▓▓▓░░░  $34 / $50  +1 🎡 │
│ Visit 3 different stores     │
│ ▓▓▓▓░░░░░░  1 / 3     +100PP │
│ Badges 7/20  🥇🥈🛍️ ...    › │
│ Rewards for you            › │
│ Upcoming: Christmas Spin 1 Dec│
├──────────────────────────────┤
│ ◉Home  Missions  Games  Rewards  Me │ bottom tabs
└──────────────────────────────┘
```

## 6.3 Daily Check-in
```
┌──────────────────────────────┐
│ ‹ Daily Check-in             │
│        🔥 6-day streak        │
│  M   T   W   T   F   S   S   │
│  ✔   ✔   ✔   ✔   ✔   ✔   ◯   │ ← today
│  Day 7 bonus: +100 PP + 🎡    │
│ ┌──────────────────────────┐ │
│ │      [  Check in now  ]  │ │  primary button
│ └──────────────────────────┘ │
│ Or scan the QR at Concierge  │
│ for double points  [ Scan ]  │
│ ── Streak ladder ──────────  │
│ Day 3  +20 PP        ✔       │
│ Day 7  +100 PP + Spin  ◯      │
│ Day 14 +200 PP       ◯       │
│ Day 30 "Loyalty Star" badge  │
│ History (calendar)         › │
└──────────────────────────────┘
After tap: confetti, "+10 PP" counter animation, haptic success
```

## 6.4 My Missions
```
┌──────────────────────────────┐
│ ‹ My Missions                │
│ (Daily) (Weekly)(◉Monthly)(Done)│
│ ┌──────────────────────────┐ │
│ │ 🛍️ Visit Suntec 3× in Nov │ │
│ │ ▓▓▓▓▓▓░░░░ 2/3            │ │
│ │ Reward: 1 Spin · ends 30 Nov│
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ 🧭 Shopping Explorer      │ │
│ │ Visit 3 different stores  │ │
│ │ [ Join mission ]          │ │ ← opt-in missions
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ ✅ 5 daily check-ins       │ │
│ │ Completed · +50 PP claimed│ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
Detail: objective, how to complete (stores list), validity, progress timeline
```

## 6.5 Spin & Win
```
┌──────────────────────────────┐
│ ‹ Year-End Spin       ⓘ Rules│
│     Free spins today: 1      │
│            ▼                 │ ← fixed pointer
│        ╭───────╮             │
│      ╱ 50PP│$5  ╲            │
│     │ Try ╲│╱ 2× │           │  SVG wheel, brand oranges
│     │again─●─Spin│           │  ● = centre "SPIN" button
│      ╲ $10 │100 ╱            │
│        ╰───────╯             │
│  [   SPIN (free)   ]         │
│  or  [ Spin for 200 PP ]     │
│  🔊 sound  📳 haptics        │
│ My wins                    › │
└──────────────────────────────┘
Result modal:
┌──────────────────────────────┐
│     🎉  You won!             │
│     $5 Dining Voucher        │
│  Valid till 27 Dec 2026      │
│  [ View in My Rewards ]      │
│  [ Spin again ] (if attempts)│
└──────────────────────────────┘
```

## 6.6 Scratch & Win
```
┌──────────────────────────────┐
│ ‹ Festive Scratch            │
│ Cards left today: 2          │
│ ┌──────────────────────────┐ │
│ │░░░░░░░░░░░░░░░░░░░░░░░░░░│ │  canvas scratch layer
│ │░░░░░ Scratch here ░░░░░░░│ │  (auto-reveal at 60%,
│ │░░░░░░░░░░░░░░░░░░░░░░░░░░│ │   or "Reveal" button for
│ └──────────────────────────┘ │   accessibility)
│        [ Reveal all ]        │
│ Possible prizes: 🎁 💳 ⭐     │
└──────────────────────────────┘
```

## 6.7 Quiz & Trivia
```
┌──────────────────────────────┐
│ ‹ Suntec Trivia     ⏱ 0:14   │
│ Question 2 of 5   ▓▓░░░      │
│ Which landmark at Suntec City│
│ was once the world's largest │
│ fountain?                    │
│ ┌──────────────────────────┐ │
│ │ A  Fountain of Wealth    │ │
│ ├──────────────────────────┤ │
│ │ B  Merlion               │ │
│ ├──────────────────────────┤ │
│ │ C  Spectra               │ │
│ ├──────────────────────────┤ │
│ │ D  Jewel Rain Vortex     │ │
│ └──────────────────────────┘ │
│ Score: 200                   │
└──────────────────────────────┘
Result: score 850 · 5/5 · +50 PP · Rank #42 on Quiz leaderboard
```

## 6.8 Leaderboard
```
┌──────────────────────────────┐
│ ‹ Leaderboard                │
│ (Daily)(Weekly)(◉Monthly)(All)│
│   🥈 Ja** T.  🥇 Me** L.  🥉 Ro** K. │
│    8,210      9,980      7,440│
│ 4  Wi** C.            6,900  │
│ 5  Am** S.            6,850  │
│ …                            │
│ ▶ 42 You (Tan)        2,140  │ ← highlighted, sticky
│ Names masked for privacy ⓘ   │
└──────────────────────────────┘
```

## 6.9 My Badges · 6.10 My Rewards · 6.11 Participation History
```
Badges                          My Rewards                      History
┌──────────────────────┐       ┌──────────────────────┐        ┌──────────────────────┐
│ 7 of 20 collected    │       │(◉Active)(Used)(Expired)│      │ (All)(Games)(Missions)│
│ 🥇 🥈 🛍️ 🔥           │       │ $5 Dining Voucher    │        │ 27 Nov  Spin  $5 Vchr│
│ First   Super  Explo │       │ Code: SUN5-8K2M  ▣QR │        │ 27 Nov  Check-in +10 │
│ Check-in Shopper     │       │ Expires 27 Dec       │        │ 26 Nov  Quiz 850 pts │
│ 🔒 🔒 🔒 🔒            │       │ [ Show at store ]    │        │ 25 Nov  Mission ✔    │
│ Next: Mission Master │       │ 500 Suntec+ Points ✔ │        │ … infinite scroll    │
│ ▓▓▓▓▓░░ 5/10 missions│       │ Reward catalogue   › │        └──────────────────────┘
└──────────────────────┘       └──────────────────────┘
```

## 6.12 States and feedback
- **Loading:** skeleton cards.
- **Empty:** illustration, a short line and a call to action ("No active missions. Check back on 1 Dec").
- **Error:** "Play & Win is taking a break. Your Suntec+ points are safe." with a retry button. The rest of the app is never blocked.
- **Notifications:** an in-module toast plus an inbox badge. Pushes from the existing Suntec+ push service deep-link to the correct screen, for example `suntecplus://play/rewards/RT-…`.
