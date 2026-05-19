export interface TacticsPuzzle {
  id: string;
  fen: string;
  rating: number;
  themes: string[];
  setupMove: string | null;   // jugada del oponente (UCI) que arma la posición
  solution: string[];          // resto de la secuencia (usuario, rival, usuario...)
  userRating: number;
}

export interface TacticsStats {
  user_id: string;
  rating: number;
  rd: number;
  solved: number;
  attempted: number;
  current_streak: number;
  best_streak: number;
  total_time_ms: number;
  by_theme: Record<string, { solved: number; attempted: number }>;
  recent_ids: string[];
  daily_streak: number;
  last_solved_day: string | null;
  xp: number;
  updated_at: string;
}

export interface AttemptResult {
  delta: number;
  newRating: number;
  streak: number;
  bestStreak: number;
  solved: number;
  attempted: number;
  dailyStreak: number;
  xp: number;
  xpGain: number;
  cleanSolve: boolean;
  counted: boolean;
  repeat: boolean;
}

export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme';

export interface RadarItem {
  theme: string;
  total: number;
  accuracy: number;
}

export interface TacticsInsights {
  range: string;
  rating: number;
  rd: number;
  totalAttempts: number;
  correct: number;
  incorrect: number;
  withHints: number;
  repeated: number;
  pendingRepeat: number;
  accuracy: number | null;
  avgTimeMs: number;
  ratingGain: number;
  lowData: boolean;
  radar: RadarItem[];
}
