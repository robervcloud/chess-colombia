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
  updated_at: string;
}

export interface AttemptResult {
  delta: number;
  newRating: number;
  streak: number;
  bestStreak: number;
  solved: number;
  attempted: number;
}
