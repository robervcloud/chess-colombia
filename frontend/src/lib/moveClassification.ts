/**
 * Sistema de clasificación de jugadas + utilidades de análisis premium.
 *
 * Reutilizable en /analyze, /game/[id]/analysis y cualquier loop de
 * review. Sin dependencias externas (sólo chess.js para SEE material).
 *
 * Diseño:
 *   - `Classification` es un union literal (9 niveles).
 *   - `classifyMove` opera sobre cpLoss + top lines del motor. Detecta
 *     `brilliant` (sacrificio correcto + única jugada fuerte) y
 *     `great` (única jugada fuerte sin sacrificio).
 *   - `humanExplanation` usa templates regla-based: rápido, sin LLM,
 *     reutilizable, multi-idioma futuro fácil. El primer template que
 *     matchea gana.
 *   - `gamePhase` distingue opening/middlegame/endgame por ply +
 *     material restante.
 *   - `CLASS_META` define la paleta colombiana premium: dorado vivo,
 *     azul profundo, esmeralda, terracota cálido, crema/madera.
 */

import { Chess } from 'chess.js';

import type { Classification } from '@/types/analysis';

export type { Classification };
export type Phase = 'opening' | 'middlegame' | 'endgame';

// ============================================================
// Thresholds de clasificación (estilo Chess.com adaptado)
// ============================================================
// Centipawn loss thresholds. Valores en cp desde la perspectiva del
// jugador que mueve (>0 = pérdida real de eval).
const T_BEST_LOSS         = 10;   // < esto + matchedBest -> best
const T_EXCELLENT_LOSS    = 30;   // < esto -> excellent
const T_GOOD_LOSS         = 75;   // < esto -> good
const T_INACCURACY_LOSS   = 150;  // < esto -> inaccuracy
const T_MISTAKE_LOSS      = 300;  // < esto -> mistake, >= -> blunder

const T_UNIQUE_GAP        = 100;  // top1 vs top2 cp gap para "única buena"
const T_SACRIFICE_MIN     = 100;  // material sacrificado mínimo (peón = 100)

// ============================================================
// Tipos
// ============================================================

/** Entrada parcial que cualquier review loop puede armar. */
export interface ClassifyInput {
  /** Centipawn loss (>=0). Si null/undefined se trata como 0. */
  cpLoss: number | null | undefined;
  /** True si la jugada elegida coincide con la mejor del engine. */
  matchedBest?: boolean;
  /** True si la posición previa estaba ganada y se perdió la ventaja. */
  swungToLosing?: boolean;
  /** Líneas del engine ANTES de la jugada, ordenadas por multipv. */
  topLinesBefore?: Array<{ cp: number | null; mate: number | null; pv?: string[] }>;
  /** El movimiento jugado en UCI (ej. "e2e4"). */
  uciPlayed?: string;
  /** Material sacrificado por el jugador (centipawns; peón=100). */
  materialSacrificed?: number;
  /** True si la posición está dentro del libro de aperturas. */
  isBookMove?: boolean;
}

// ============================================================
// classifyMove
// ============================================================

/**
 * Devuelve la clasificación de UNA jugada.
 *
 * Orden de evaluación:
 *   1. book → si está en teoría conocida.
 *   2. blunder → cpLoss ≥ T_MISTAKE_LOSS o swung.
 *   3. mistake → cpLoss ≥ T_INACCURACY_LOSS.
 *   4. inaccuracy → cpLoss ≥ T_GOOD_LOSS.
 *   5. good → cpLoss ≥ T_EXCELLENT_LOSS y no matchedBest.
 *   6. brilliant → matchedBest + única + sacrificio + cpLoss bajo.
 *   7. great → matchedBest + única + cpLoss bajo (sin sacrificio).
 *   8. best → matchedBest + cpLoss < T_BEST_LOSS.
 *   9. excellent → cpLoss < T_EXCELLENT_LOSS pero no matchedBest.
 */
export function classifyMove(input: ClassifyInput): Classification {
  if (input.isBookMove) return 'book';

  const loss = Math.max(0, input.cpLoss ?? 0);
  if (input.swungToLosing) return 'blunder';
  if (loss >= T_MISTAKE_LOSS)    return 'blunder';
  if (loss >= T_INACCURACY_LOSS) return 'mistake';
  if (loss >= T_GOOD_LOSS)       return 'inaccuracy';
  if (loss >= T_EXCELLENT_LOSS)  return 'good';

  // De aquí abajo loss < T_EXCELLENT_LOSS
  if (input.matchedBest) {
    const lines = input.topLinesBefore || [];
    const isUnique = !!lines[0] && !!lines[1]
      && Math.abs(lineEval(lines[0]) - lineEval(lines[1])) > T_UNIQUE_GAP;

    if (isUnique) {
      if ((input.materialSacrificed ?? 0) >= T_SACRIFICE_MIN && loss < T_BEST_LOSS) {
        return 'brilliant';
      }
      if (loss < T_BEST_LOSS) return 'great';
    }
    if (loss < T_BEST_LOSS) return 'best';
  }

  return 'excellent';
}

function lineEval(l: { cp: number | null; mate: number | null }): number {
  if (l.mate != null) return l.mate > 0 ? 10_000 : -10_000;
  return l.cp ?? 0;
}

// ============================================================
// Material sacrificed (heurística simple basada en SAN + ataques)
// ============================================================

const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

/**
 * Estimación rápida: si la pieza movida queda atacada por una pieza de
 * menor o igual valor y no está defendida adecuadamente, contamos su
 * valor como "sacrificado". No es SEE perfecto, pero detecta sacrificios
 * tácticos clásicos. Devuelve cp (peón=100).
 *
 * Retorna 0 si la jugada es captura limpia (no es sacrificio).
 */
export function estimateMaterialSacrificed(fenBefore: string, uci: string): number {
  if (!uci || uci.length < 4) return 0;
  try {
    const c = new Chess(fenBefore);
    const from = uci.substring(0, 2);
    const to   = uci.substring(2, 4);
    const piece = c.get(from as any);
    if (!piece) return 0;

    // Si captura una pieza de valor >= a la propia, no es sacrificio
    const captured = c.get(to as any);
    const ownValue = PIECE_VALUE[piece.type] || 0;
    if (captured && (PIECE_VALUE[captured.type] || 0) >= ownValue) return 0;

    // Probar la jugada
    let mv;
    try { mv = c.move({ from, to, promotion: uci.length > 4 ? uci[4] : undefined } as any); }
    catch { return 0; }
    if (!mv) return 0;

    // Después de jugar, ¿el oponente puede capturar la pieza que se acaba
    // de mover, y nuestra recaptura no recupera el material?
    const oppMoves = c.moves({ verbose: true }) as any[];
    const attackers = oppMoves.filter((m) => m.to === to);
    if (attackers.length === 0) { c.undo(); return 0; }

    // El atacante más barato del oponente captura. Heurística: si su
    // valor es menor que la pieza que movimos, es sacrificio.
    const cheapest = Math.min(...attackers.map((m) => PIECE_VALUE[m.piece] || 0));
    c.undo();
    if (cheapest < ownValue) {
      return ownValue - cheapest;
    }
    return 0;
  } catch {
    return 0;
  }
}

// ============================================================
// gamePhase
// ============================================================

/**
 * Determina la fase de la partida.
 *
 * Heurística pragmática:
 *   - opening:    plyIndex < 20 (primeras 10 jugadas) Y todavía hay
 *                 ≥ 14 piezas no-rey en el tablero.
 *   - endgame:    ≤ 12 piezas no-rey totales (Lichess usa 13).
 *   - middlegame: el resto.
 */
export function gamePhase(plyIndex: number, fenAfter: string): Phase {
  const totalNonKing = countNonKingPieces(fenAfter);
  if (totalNonKing <= 12) return 'endgame';
  if (plyIndex < 20 && totalNonKing >= 14) return 'opening';
  return 'middlegame';
}

function countNonKingPieces(fen: string): number {
  const board = fen.split(' ')[0] || '';
  let count = 0;
  for (const ch of board) {
    if (/[pnbrqPNBRQ]/.test(ch)) count++;
  }
  return count;
}

// ============================================================
// humanExplanation (templates regla-based, sin LLM)
// ============================================================

type TemplateMove = {
  classification: Classification;
  cpLoss: number;
  color?: 'w' | 'b';
  phase?: Phase;
  san?: string;
};

interface Template {
  match: (m: TemplateMove) => boolean;
  text: (m: TemplateMove) => string;
}

/**
 * Templates ordenados por especificidad. El primero que matchea gana.
 * Cobertura: brilliant, great, best/excellent, mistake/blunder según
 * fase y magnitud. Reutilizable y trivial de extender.
 */
const TEMPLATES: Template[] = [
  {
    match: (m) => m.classification === 'brilliant',
    text: () => 'Sacrificio correcto y difícil de encontrar. Combinación brillante que cambia la dinámica.',
  },
  {
    match: (m) => m.classification === 'great',
    text: () => 'Única jugada que mantiene la ventaja. Excelente cálculo bajo presión.',
  },
  {
    match: (m) => m.classification === 'best',
    text: () => 'Coincide con la mejor línea del motor. Precisa y sólida.',
  },
  {
    match: (m) => m.classification === 'excellent',
    text: () => 'Jugada muy fuerte, casi idéntica a la sugerencia del motor.',
  },
  {
    match: (m) => m.classification === 'book',
    text: () => 'Jugada de teoría reconocida.',
  },
  {
    match: (m) => m.classification === 'blunder' && m.phase === 'opening',
    text: () => 'Error grave en la apertura: la coordinación de piezas y el control del centro se vieron comprometidos.',
  },
  {
    match: (m) => m.classification === 'blunder' && m.phase === 'endgame',
    text: () => 'Blunder en el final: una imprecisión a esta altura suele transformar el resultado de la partida.',
  },
  {
    match: (m) => m.classification === 'blunder',
    text: () => 'Pérdida importante de evaluación. Existía una jugada bastante mejor disponible.',
  },
  {
    match: (m) => m.classification === 'mistake' && m.phase === 'opening',
    text: () => 'Decisión floja en la apertura. Permite al rival ganar espacio o iniciativa.',
  },
  {
    match: (m) => m.classification === 'mistake' && m.phase === 'endgame',
    text: () => 'En el final, esta imprecisión puede costar la partida. Conviene calcular con más detalle.',
  },
  {
    match: (m) => m.classification === 'mistake',
    text: () => 'Error notable: la ventaja posicional o material cambia de forma significativa.',
  },
  {
    match: (m) => m.classification === 'inaccuracy' && m.phase === 'opening',
    text: () => 'Salida ligeramente imprecisa. Un plan más activo era posible.',
  },
  {
    match: (m) => m.classification === 'inaccuracy',
    text: () => 'Pequeña pérdida de precisión. Existía una continuación ligeramente más fuerte.',
  },
  {
    match: (m) => m.classification === 'good',
    text: () => 'Jugada razonable, mantiene el equilibrio.',
  },
];

/**
 * Devuelve una explicación humana en español, o null si no hay template
 * aplicable. Las dependencies son mínimas: solo la clasificación, el
 * cpLoss y opcionalmente fase/color.
 */
export function humanExplanation(move: {
  classification: Classification;
  cpLoss?: number | null;
  color?: 'w' | 'b';
  phase?: Phase;
  san?: string;
}): string | null {
  const m: TemplateMove = {
    classification: move.classification,
    cpLoss: move.cpLoss ?? 0,
    color: move.color,
    phase: move.phase,
    san: move.san,
  };
  for (const t of TEMPLATES) {
    if (t.match(m)) return t.text(m);
  }
  return null;
}

// ============================================================
// CLASS_META — paleta colombiana premium
// ============================================================
//
// Paleta:
//   - Brilliant : dorado vivo cálido (oro colombiano)
//   - Great     : azul profundo elegante (noche andina)
//   - Best      : esmeralda colombiana
//   - Excellent : verde esmeralda suave
//   - Good      : madera cálida neutra
//   - Book      : parch (papel antiguo)
//   - Inaccuracy: dorado claro / ámbar
//   - Mistake   : terracota (clay) cálido
//   - Blunder   : rojo terracota intenso
//
// `chip` usa tokens Tailwind ya existentes (gold/accent/clay/danger/wood).
// `glow` es color HEX para box-shadow del badge "large".
// `arrow` es rgba para flechas sobre el tablero.

export const CLASS_META: Record<Classification, {
  label: string;
  symbol: string;
  chip: string;
  glow: string;
  arrow: string;
  /** rank 0..8 menor = mejor (para sorting/timeline) */
  rank: number;
}> = {
  brilliant: {
    label: 'Brillante', symbol: '!!',
    chip: 'bg-gold/25 text-wood-900 border-gold/70',
    glow: '#e8c873', arrow: 'rgba(232,200,115,0.92)', rank: 0,
  },
  great: {
    label: 'Gran jugada', symbol: '!',
    chip: 'bg-blue-100 text-blue-900 border-blue-300',
    glow: '#1e4d8b', arrow: 'rgba(30,77,139,0.85)', rank: 1,
  },
  best: {
    label: 'Mejor', symbol: '✓',
    chip: 'bg-accent/15 text-accent border-accent/40',
    glow: '#1f7a5a', arrow: 'rgba(31,122,90,0.85)', rank: 2,
  },
  excellent: {
    label: 'Excelente', symbol: '·',
    chip: 'bg-accent/10 text-accent border-accent/25',
    glow: '#2c9a73', arrow: 'rgba(31,122,90,0.55)', rank: 3,
  },
  good: {
    label: 'Buena', symbol: '',
    chip: 'bg-wood-100 text-wood-700 border-wood-200',
    glow: '#8b6c47', arrow: 'rgba(110,74,38,0.4)', rank: 4,
  },
  book: {
    label: 'Teoría', symbol: '📖',
    chip: 'bg-parch text-wood-600 border-wood-200',
    glow: '#c9a24a', arrow: 'rgba(110,74,38,0.3)', rank: 5,
  },
  inaccuracy: {
    label: 'Imprecisión', symbol: '?!',
    chip: 'bg-gold/15 text-wood-800 border-gold/40',
    glow: '#c9a24a', arrow: 'rgba(201,162,74,0.75)', rank: 6,
  },
  mistake: {
    label: 'Error', symbol: '?',
    chip: 'bg-clay/15 text-clay border-clay/40',
    glow: '#b3681e', arrow: 'rgba(179,104,30,0.85)', rank: 7,
  },
  blunder: {
    label: 'Blunder', symbol: '??',
    chip: 'bg-danger/15 text-danger border-danger/40',
    glow: '#b3392c', arrow: 'rgba(179,57,44,0.9)', rank: 8,
  },
};

/** Categorías "remarcables" para timeline + summary. */
export const NOTABLE: Classification[] = ['brilliant', 'great', 'mistake', 'blunder'];

/** Mapa de qué clasificaciones cuentan como "buena" para accuracy. */
export const POSITIVE: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'book'];

/** Mapa de qué clasificaciones cuentan como "mala" para timeline. */
export const NEGATIVE: Classification[] = ['inaccuracy', 'mistake', 'blunder'];
