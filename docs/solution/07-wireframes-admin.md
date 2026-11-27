# 7. Admin Control Panel Wireframes

Desktop-first and data-dense, but clean, and responsive down to tablet. It is served on `admin.` only, with an environment banner (DEV, SIT, UAT, PROD) in the top bar. Menu items appear according to the user's RBAC role.

## 7.1 Shell and dashboard
```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ ● Suntec+ Play Admin   [UAT]                 🔍 Search member…   🔔   Jane (Campaign Admin) ▾ │
├──────────────┬────────────────────────────────────────────────────────────────────┤
│ ◉ Dashboard  │ Dashboard            (Last 30 days ▾) (All campaigns ▾) (All games ▾) [Export]│
│ Campaigns    │ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐ │
│ Games        │ │Registered││ Active   ││ Game     ││ Missions ││ Rewards  ││ Rewards  │ │
│ Missions     │ │ 48,210   ││ 12,904   ││ plays    ││ completed││ issued   ││ redeemed │ │
│ Check-in     │ │ ▲ 6.2%   ││ ▲ 11.0%  ││ 182,330  ││ 9,412    ││ 21,880   ││ 14,105   │ │
│ Rewards      │ └──────────┘└──────────┘└──────────┘└──────────┘└──────────┘└──────────┘ │
│ Badges       │ Engagement trend (DAU / WAU / MAU)        │ Most popular games           │
│ Leaderboards │ ┌────────────────────────────────────┐   │ Spin & Win      ████████ 61% │
│ Segments     │ │      ╱╲    ╱╲╱╲                    │   │ Quiz            ████     24% │
│ Notifications│ │ ╱╲╱╲╱  ╲╱╲╱    ╲╱╲                 │   │ Scratch         ██       15% │
│ Customers    │ └────────────────────────────────────┘   │                              │
│ Reports      │ Campaign performance                                                  │
│ ── Admin ──  │ Campaign          Status   Players  Plays   Rewards  Cost (SGD) Redeem% │
│ Users & roles│ Year-End Spin     ● Active  9,210   88,104   12,330   41,220     64%   │
│ API clients  │ Shopping Explorer ● Active  4,488       —     3,110   15,550     71%   │
│ Audit log    │ ⚠ 2 failed reward transactions in the last hour →                     │
│ Settings     │                                                                       │
└──────────────┴────────────────────────────────────────────────────────────────────┘
```

## 7.2 Campaign list and editor
```
Campaigns                                   [ + New campaign ]
(Status: All ▾) (Search…)
Name               Priority  Status      Start        End          Segments     ⋯
Year-End Spin      1         ● Active    01 Nov 2026  31 Dec 2026  All members  ⋯
Christmas Quiz     2         ◐ Scheduled 01 Dec 2026  25 Dec 2026  Gold, Plat   ⋯
Back to School     5         ○ Draft     —            —            New members  ⋯

Edit campaign ─ Year-End Spin                        [Preview ↗] [Save draft] [Publish]
┌─ Details ──────────────────────┐ ┌─ Preview (mobile) ─┐
│ Name  [Year-End Spin         ] │ │ ┌───────────────┐  │
│ Description [rich text      ]  │ │ │  banner image │  │
│ Banner [ Upload 1200×600 ]     │ │ │  Year-End Spin│  │
│ Priority [1]                   │ │ │  [ Play now ] │  │
├─ Schedule ─────────────────────┤ │ └───────────────┘  │
│ Start [01/11/2026 10:00 SGT]   │ └────────────────────┘
│ End   [31/12/2026 23:59 SGT]   │
├─ Audience ─────────────────────┤
│ Segments (+ Gold) (+ Platinum) (+ New members)  ≈ 18,240 members │
│ Eligibility rule [ Tier ≥ Silver AND joined < 2026-12-01 ] [Edit]│
├─ Participation limits ─────────┤
│ Per member: [5]/day [20]/week [100]/campaign  Cooldown [30] s    │
├─ Linked items ─────────────────┤
│ Games (2) · Missions (4) · Rewards (8) · Leaderboard (1)  [Manage]│
└──────────────────────────────────────────────────────────────────┘
```

## 7.3 Game configuration: Spin & Win wheel editor
```
Game ─ Year-End Spin Wheel   Type: Spin & Win   Status: ● Active   [Simulate] [Save]
┌─ Segments ───────────────────────────────────────────────┐ ┌─ Live preview ─┐
│ #  Label             Colour  Reward            Weight %  Fallback  ⋯ │ │    ▼          │
│ 1  50 PP             ■ F97316 Play Points 50    30.00     —        ⋯ │ │  ╭─────╮      │
│ 2  $5 Dining Voucher ■ FED7AA Dining $5 (VMS)   15.00     Renorm.  ⋯ │ │ ╱  ●  ╲       │
│ 3  2× Spin           ■ C2410C Bonus attempt      5.00     —        ⋯ │ │ ╲     ╱       │
│ 4  $10 Voucher       ■ FFEDD5 Retail $10         2.00     → #1     ⋯ │ │  ╰─────╯      │
│ 5  500 Suntec+ Pts   ■ 9A3412 Capillary 500      0.50     → #1     ⋯ │ └───────────────┘
│ 6  Try again         ■ FFFFFF —                 47.50     —        ⋯ │
│ [+ Add segment]                         Total: 100.00 % ✔         │
└──────────────────────────────────────────────────────────────────┘
Attempts: Free [1]/day · Paid [200] PP · Max [5]/day · Cooldown [30]s · Dates [..]–[..]
Eligibility [Inherit from campaign ▾]

Probability simulator  N [100,000] [Run]
Reward           Expected %  Simulated %  Count   Unit cost  Total cost  Stock-out at
50 PP            30.00       29.96        29,960  —          —           —
$5 Dining        15.00       15.04        15,040  S$5.00     S$75,200    day 12 ⚠
Try again        47.50       47.52        47,520  —          —           —
Expected cost per spin: S$0.93
```
The scratch card editor uses the same layout, with a slot grid and card art. The quiz editor has a question bank table with categories, import from CSV, correct-answer marking, time limits and pass mark.

## 7.4 Mission configuration
```
New mission
Title [Spend $50 at participating merchants]  Category [Shopping ▾]
Objective  [Spend amount ▾]  Target [50.00] SGD  Filters: merchants (+ Participating list ▾)
Recurrence (○ One-time ◉ Monthly ○ Weekly ○ Daily)   Enrolment (◉ Auto ○ Opt-in)
Validity  [01/11/2026] – [31/12/2026]   Max participants [ — ]
Eligible segments (+ All members)
Reward  [ 1 attempt: Year-End Spin ▾ ] + [ 100 PP ]
Progress rule: count transactions with status=completed, dedupe by txn id   [Save]
```

## 7.5 Reward configuration and inventory
```
Rewards        (Category ▾)(Type ▾)(Status ▾)           [+ New reward] [+ Category]
Name                Type              Value        PP cost Stock (rem/total) Daily cap Expiry  Status
$5 Dining Voucher   Digital voucher   VMS DIN5     —       1,210 / 5,000     300       30 d    ● Active
500 Suntec+ Points  Capillary points  500 pts      1,000   ∞                 —         —       ● Active
Uniqlo $10 Voucher  Merchant voucher  Code pool    800     88 / 500 ⚠ low    50        14 d    ● Active
Christmas Tote Bag  Promotional gift  Concierge    1,500   0 / 200  ⛔ out   —         —       ● Active

Reward transactions   (Status: ◉Failed  ○Pending  ○Issued  ○Redeemed)
Txn ID            Member         Reward            Source  Error                      Attempts  ⋯
RT-…-QW81ZD       SUN-00012345   500 Suntec+ Pts   Redeem  Capillary 503 timeout       4        [Retry] [Cancel]
```

## 7.6 Customer 360
```
🔍 [SUN-00012345 / card no / email]
┌─ Tan Ah Kow · SUN-00012345 · Card 6012… · Gold · Joined 2019 ── Status ● Active [Flag] [Block] ┐
│ PP 1,240 · Lifetime 18,300 · Streak 6 (best 12) · Rank #42 · Badges 7          [Grant attempts]│
├ Tabs: (◉Activity) (Games) (Missions) (Check-ins) (Badges) (Rewards) (Fraud signals) (Audit)  ┤
│ 27 Nov 12:12  Spin & Win  GS-…8F3K2Q  $5 Dining Voucher  RT-…QW81ZD  ● Pending              │
│ 27 Nov 12:01  Check-in    Day 6        +10 PP                                               │
│ 26 Nov 19:44  Quiz        score 850    +50 PP                                               │
└──────────────────────────────────────────────────────────────────────────────────────────┘
Personal data is masked for roles without full PII permission (Marketing, Read-Only).
Every grant, flag or block requires a reason and is written to the audit log.
```

## 7.7 Users and roles · Audit log · Notification templates · Reports
```
Users & roles                                   Audit log    (Actor ▾)(Entity ▾)(Date ▾)
Name     Email        Roles              MFA    When          Actor   Action           Entity
Jane     jane@…       Campaign Admin     ✔      27 Nov 11:02  Jane    game.update      Year-End Wheel  [diff]
Ravi     ravi@…       Customer Service   ✔      27 Nov 10:40  Ravi    reward.grant     SUN-0001…       [diff]

Notification template ─ reward_allocated          Reports
Channels (☑ Inbox ☑ Push ☐ Email)                 ┌ Customer Participation   ┐ Filters: date, campaign,
Title  [🎉 You won {{reward_name}}!]                │ Game Performance         │ game type, segment,
Body   [Hi {{first_name}}, it's in My Rewards…]    │ Mission Completion       │ status, reward type
Deep link [suntecplus://play/rewards/{{txn_id}}]   │ Reward Allocation        │ [View] [CSV] [Excel]
Quiet hours 22:00–08:00  [Send test] [Save]       │ Reward Redemption · …(10)│ [Schedule email]
                                                   └──────────────────────────┘
```
