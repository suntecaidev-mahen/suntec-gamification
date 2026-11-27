export type Availability = {
  free_left: number;
  attempts: number;
  pp_cost: number | null;
  pp_balance: number;
  plays_today: number;
  max_per_day: number | null;
  cooldown_s: number;
  can_play: boolean;
  reason: 'daily_limit' | 'no_attempts' | 'cooldown' | null;
};

export type RewardView = {
  id: string;
  ref: string;
  name: string;
  type: string;
  status: string;
  amount?: number | null;
  voucher_code?: string | null;
  claim_token?: string | null;
  expires_at?: string | null;
  description?: string | null;
};

export type Summary = {
  member: { first_name: string | null; last_name: string | null; tier: string; suntec_member_id: string | null; email: string | null };
  is_guest: boolean;
  /** Guests only: code to move held winnings to a Suntec+ account. */
  claim: { code: string; expires_at: string } | null;
  /** Guest winnings waiting to be claimed. */
  held: { rewards: number; points: number };
  /** Suntec+ Points this member has won with Play & Win. */
  points_won: number;
  pp_name: string;
  pp_balance: number;
  pp_lifetime_earned: number;
  stats: { games_played: number; missions_completed: number; checkins_total: number; quiz_wins: number; badges: number };
  unread_notifications: number;
  active_rewards: number;
  preferences: { lb_display_mode: 'masked' | 'nickname' | 'hidden'; lb_nickname: string | null; lb_opt_out: boolean; notify_push: boolean; notify_email: boolean };
};

export type CheckinStatus = {
  program_id: string;
  name: string;
  description: string;
  checked_in_today: boolean;
  streak: number;
  best: number;
  next_milestone: { day: number; label: string; days_to_go: number } | null;
  ladder: { day: number; label: string; repeat_every: number | null; reached: boolean }[];
  base_rewards: string[];
  recent_days: string[];
  qr_multiplier: number;
  already?: boolean;
  checked_in?: boolean;
  rewards?: (RewardView & { kind: string; label?: string })[];
};

export type Mission = {
  id: string;
  title: string;
  description: string;
  how_to: string;
  category: string;
  icon: string | null;
  objective_type: string;
  target: number;
  recurrence: string;
  enrolment_mode: 'auto' | 'opt_in';
  enrolled: boolean;
  progress: number;
  completed: boolean;
  completed_at: string | null;
  ends_at: string | null;
  campaign_name: string | null;
  rewards: { name: string; type: string; qty: number }[];
};

export type GameCard = {
  id: string;
  type: 'spin_wheel' | 'scratch_card' | 'quiz';
  name: string;
  description: string;
  banner_path: string | null;
  campaign_name: string | null;
  ends_at: string | null;
  availability: Availability;
};

export type Home = {
  summary: Summary;
  checkin: CheckinStatus | null;
  campaigns: { id: string; name: string; description: string; banner_path: string | null; ends_at: string | null; terms: string }[];
  games: GameCard[];
  missions: Mission[];
};

export type GameDetail = {
  id: string;
  type: 'spin_wheel' | 'scratch_card' | 'quiz';
  name: string;
  description: string;
  rules_text: string;
  campaign: { id: string; name: string; terms: string; ends_at: string | null } | null;
  config: { spin_duration_ms?: number; reveal_threshold?: number; questions_per_session?: number; time_limit_s?: number; pass_percent?: number; reward_tiers?: { min_correct: number; reward: string }[] };
  outcomes: { position: number; label: string; display: { color?: string; text_color?: string; icon?: string } }[];
  availability: Availability;
};

export type Session = {
  id: string;
  ref: string;
  game_id: string;
  game_type: string;
  status: 'in_progress' | 'completed' | 'expired' | 'voided';
  payment_source: string;
  pp_cost: number;
  pp_balance: number;
  outcome: {
    position?: number;
    label?: string;
    won?: boolean;
    passed?: boolean;
    speed_bonus?: number;
    reward?: RewardView | null;
  };
  score: number | null;
  correct_count: number | null;
  question_count: number | null;
  expires_at: string | null;
  questions?: { id: string; text: string; image_path: string | null; time_limit_s: number; options: { id: string; text: string }[] }[] | null;
  results?: { question_id: string; text: string; selected_option_id: string | null; correct: boolean; correct_option_id: string; correct_option_text: string; explanation: string }[] | null;
};
