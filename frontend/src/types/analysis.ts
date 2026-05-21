/**
 * Tipos del sistema de análisis post-partida.
 *
 * IMPORTANTE: Convención server-side: TODOS los evals (cp y mate)
 * vienen en POV de las BLANCAS (positivo = ventaja blancas).
 */

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export type AnalysisStatus = 'pending' | 'running' | 'done' | 'failed';

export interface AnalysisLine {
  rank: number;
  moves: string[];     // SAN moves desde fenBefore
  cp: number | null;   // POV blancas
  mate: number | null; // POV blancas
}

export interface MoveAnalysis {
  ply: number;
  san: string;
  uci: string;
  color: 'w' | 'b';
  fenBefore: string;
  fenAfter: string;
  evalBefore: number;       // POV blancas, en cp (mate -> número grande)
  evalAfter: number;
  mateBefore: number | null;
  mateAfter: number | null;
  bestMoveSan: string | null;
  bestMoveUci: string | null;
  lines: AnalysisLine[];
  centipawnLoss: number;
  classification: Classification;
  isMateDetected: boolean;
}

export interface AnalysisSummary {
  accuracyWhite: number | null;
  accuracyBlack: number | null;
  blundersWhite: number;
  blundersBlack: number;
  mistakesWhite: number;
  mistakesBlack: number;
  inaccuraciesWhite: number;
  inaccuraciesBlack: number;
  bestMovesWhite: number;
  bestMovesBlack: number;
  totalPlies: number;
  truncated: boolean;
}

export type EloConfidence = 'high' | 'medium' | 'low';

export interface GameAnalysis {
  game_id: string;
  status: AnalysisStatus;
  engine_name: string | null;
  engine_depth: number | null;
  moves_analysis: MoveAnalysis[] | null;
  summary: AnalysisSummary | null;
  elo_white: number | null;
  elo_black: number | null;
  elo_confidence_white: EloConfidence | null;
  elo_confidence_black: EloConfidence | null;
  elo_reasons_white: string[] | null;
  elo_reasons_black: string[] | null;
  progress_current: number | null;
  progress_total: number | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}
