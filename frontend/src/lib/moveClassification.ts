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
  // ---- Contexto de mate (para reglas explícitas) ----
  /** Color del jugador que mueve. Necesario para reglas de mate. */
  color?: 'w' | 'b';
  /** Mate antes de la jugada (POV blancas). null si no hay mate. */
  mateBefore?: number | null;
  /** Mate después de la jugada (POV blancas). null si no hay mate. */
  mateAfter?: number | null;
  /** Eval después de la jugada (POV blancas), en cp. */
  evalAfter?: number | null;
}

// ============================================================
// classifyMove
// ============================================================

/**
 * Devuelve la clasificación de UNA jugada.
 *
 * Orden de evaluación:
 *   1. Reglas EXPLÍCITAS de mate (mateBefore/mateAfter/color).
 *   2. book → si está en teoría conocida.
 *   3. Thresholds estándar de cpLoss.
 *
 * Las reglas de mate previenen el bug clásico de cpLoss naive sobre
 * valores de mate convertidos a ±10⁴.
 */
export function classifyMove(input: ClassifyInput): Classification {
  // ============================================================
  // Reglas EXPLÍCITAS de mate (preceden cpLoss thresholds)
  // ============================================================
  const color = input.color || 'w';
  const sign  = color === 'w' ? 1 : -1;
  const mb    = input.mateBefore;
  const ma    = input.mateAfter;
  const mbPov = mb === null || mb === undefined ? null : mb * sign;
  const maPov = ma === null || ma === undefined ? null : ma * sign;

  // (A) mateAfter === 0 → mate ejecutado. Siempre best.
  if (ma === 0) return 'best';

  // (B) Crear mate a favor desde no-mate.
  if (mbPov === null && maPov !== null && maPov > 0) {
    const lines = input.topLinesBefore || [];
    const isUnique = lines.length >= 2 &&
      Math.abs(lineEval(lines[0]) - lineEval(lines[1])) > T_UNIQUE_GAP;
    if (isUnique) {
      if ((input.materialSacrificed ?? 0) >= T_SACRIFICE_MIN) return 'brilliant';
      return 'great';
    }
    return 'best';
  }

  // (C) Mantener o acelerar mate a favor → best. Demorar → excellent.
  if (mbPov !== null && maPov !== null && mbPov > 0 && maPov > 0) {
    if (maPov <= mbPov) return 'best';
    return 'excellent';
  }

  // (D) Perder mate ganado → mistake/blunder según eval restante.
  if (mbPov !== null && mbPov > 0 && maPov === null) {
    const evalFinalPov = sign * (input.evalAfter ?? 0);
    if (evalFinalPov < 0)   return 'blunder';
    if (evalFinalPov < 200) return 'mistake';
    return 'inaccuracy';
  }

  // (E) Permitir mate inesperado → blunder.
  if (mbPov === null && maPov !== null && maPov < 0) return 'blunder';

  // (F) Escapar de mate inminente → excellent.
  if (mbPov !== null && mbPov < 0 && maPov === null) return 'excellent';

  // (G) Acelerar mate contra mí → blunder. Demorar → good.
  if (mbPov !== null && maPov !== null && mbPov < 0 && maPov < 0) {
    if (maPov > mbPov) return 'blunder';
    return 'good';
  }

  // ============================================================
  // Reglas estándar por cpLoss
  // ============================================================
  if (input.isBookMove) return 'book';

  const loss = Math.max(0, input.cpLoss ?? 0);
  if (input.swungToLosing) return 'blunder';
  if (loss >= T_MISTAKE_LOSS)    return 'blunder';
  if (loss >= T_INACCURACY_LOSS) return 'mistake';
  if (loss >= T_GOOD_LOSS)       return 'inaccuracy';
  if (loss >= T_EXCELLENT_LOSS)  return 'good';

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
//
// Por cada clasificación + fase tenemos un pool de variantes. La
// selección es determinística (mismo ply = mismo texto, no flicker)
// pero distribuida a lo largo de la partida para no repetir frases.

type TemplateMove = {
  classification: Classification;
  cpLoss: number;
  color?: 'w' | 'b';
  phase?: Phase;
  san?: string;
  ply?: number;
};

/**
 * Banco de explicaciones. Clave: clasificación + ('_' + fase) opcional.
 * Más específica (con fase) tiene prioridad sobre la genérica.
 * Cada entrada es un pool del que se elige según ply (estable).
 */
const EXPLANATION_BANK: Record<string, string[]> = {
  // ---------- Positivas ----------
  brilliant: [
    'Sacrificio correcto y difícil de encontrar. Una combinación brillante que cambia el rumbo.',
    'Jugada espectacular. El motor confirma que era la única forma de mantener la presión.',
    'Brillantez táctica: entregaste material para obtener una ventaja decisiva.',
    'Concepción profunda. Pocos jugadores ven este recurso a esa altura.',
  ],
  great: [
    'Única jugada que mantiene la ventaja. Excelente cálculo bajo presión.',
    'Recurso difícil de detectar. Cualquier otra continuación habría perdido terreno.',
    'Gran jugada: viste algo que el rival probablemente no esperaba.',
    'Movida precisa donde no había alternativas igualmente fuertes.',
  ],
  best: [
    'Coincide con la mejor línea del motor. Decisión sólida.',
    'Jugada precisa. Sigue el plan correcto sin desviarse.',
    'Perfecta. Aprovecha la mejor continuación disponible.',
    'Movida exacta. Mantiene la tensión y el control posicional.',
  ],
  excellent: [
    'Muy fuerte. Casi idéntica a la sugerencia del motor.',
    'Excelente respuesta. Conserva todas las opciones favorables.',
    'Jugada de gran calidad: pequeñas diferencias respecto a la mejor línea.',
    'Casi perfecta. La evaluación apenas se mueve.',
  ],
  book: [
    'Jugada de teoría reconocida.',
    'Sigue una línea conocida de la apertura.',
    'Movida de libro. Continúa una preparación estándar.',
  ],
  good: [
    'Jugada razonable, mantiene el equilibrio.',
    'Decisión correcta sin pretensiones. Conserva la igualdad.',
    'Razonable. No es la mejor, pero tampoco compromete la posición.',
    'Movida sólida. Sin riesgo, sin gran iniciativa.',
  ],

  // ---------- Imprecisiones por fase ----------
  inaccuracy_opening: [
    'Salida ligeramente imprecisa. Un plan más activo era posible.',
    'Imprecisión en la apertura: se cede un poco de iniciativa.',
    'Decisión floja al inicio. El rival gana espacio gratis.',
  ],
  inaccuracy_middlegame: [
    'Pequeña pérdida de precisión. Existía una continuación ligeramente más fuerte.',
    'Movida imprecisa: la posición pedía algo más agudo.',
    'Sutil imprecisión. La iniciativa cambia de mano.',
  ],
  inaccuracy_endgame: [
    'En el final, cada tempo cuenta. Una jugada un poco más exacta era posible.',
    'Imprecisión técnica. Conviene revisar la teoría de finales.',
    'Pequeño desliz en el final, todavía manejable.',
  ],
  inaccuracy: [
    'Imprecisión: existía una continuación un poco más fuerte.',
    'Pequeña pérdida de precisión. Recuperable, pero notable.',
  ],

  // ---------- Errores ----------
  mistake_opening: [
    'Decisión floja en la apertura. Permite al rival ganar espacio o iniciativa.',
    'Error de planteo. La estructura quedó comprometida.',
    'Mal momento para esta jugada. Cede el centro al rival.',
  ],
  mistake_middlegame: [
    'Error notable: la ventaja posicional o material cambia de forma significativa.',
    'Decisión incorrecta. El rival puede aprovechar para tomar el control.',
    'Movida que abre el flanco equivocado.',
  ],
  mistake_endgame: [
    'En el final, esta imprecisión puede costar la partida. Conviene calcular con más detalle.',
    'Error técnico en el final. Una sola jugada precisa habría mantenido el balance.',
    'En posiciones finales, este tipo de errores suelen ser decisivos.',
  ],
  mistake: [
    'Error notable: la evaluación cambia de forma significativa.',
    'Movida que cede iniciativa o material importante.',
  ],

  // ---------- Blunders ----------
  blunder_opening: [
    'Error grave en la apertura: la coordinación de piezas y el control del centro se vieron comprometidos.',
    'Blunder de apertura. El rival queda con ventaja seria desde el inicio.',
    'Salida muy peligrosa. Quedó un agujero estructural difícil de reparar.',
  ],
  blunder_middlegame: [
    'Pérdida importante de evaluación. Existía una jugada bastante mejor disponible.',
    'Blunder: el rival obtiene ventaja material o táctica decisiva.',
    'Movida que pierde mucho. Probablemente un descuido bajo presión.',
  ],
  blunder_endgame: [
    'Blunder en el final: una imprecisión a esta altura suele transformar el resultado de la partida.',
    'En el final un blunder es casi siempre definitivo. Conviene repasar finales básicos.',
    'Error decisivo en posición simplificada. La técnica falló en el momento crítico.',
  ],
  blunder: [
    'Pérdida importante de evaluación. Existía una jugada bastante mejor disponible.',
    'Blunder: cambio drástico en la evaluación.',
  ],

  // ---------- Contexto de mate (overrides por escenario) ----------
  // Estas keys se prueban ANTES de las genéricas si el caller pasa
  // mateBefore/mateAfter. El resolver elige el escenario correcto.
  mate_executed: [
    'Mate ejecutado. Punto final de la partida.',
    'Jaque mate. Cierra la partida con precisión.',
    '¡Mate! La combinación termina aquí.',
  ],
  mate_created: [
    'Detectaste un mate forzado. Solo queda calcular la secuencia hasta el final.',
    'Jugada que crea mate forzado. El rival ya no puede salvarse.',
    'Forzaste el mate. A partir de aquí la partida está técnicamente terminada.',
  ],
  mate_accelerated: [
    'Acelerás el mate forzado. Camino más corto a la victoria.',
    'Mate más rápido. Cada jugada cuenta cuando ya está ganado.',
    'Optimizás el remate: menor cantidad de jugadas para forzar el mate.',
  ],
  mate_delayed: [
    'Mate ganado, pero hay una continuación más rápida disponible.',
    'Sigue siendo ganador, aunque el mate llega un poco más tarde.',
  ],
  mate_lost: [
    'Tenías mate forzado y se escapó. La posición sigue jugable pero ya sin remate inmediato.',
    'Perdiste el mate. La ventaja se reduce; toca volver a construir el ataque.',
    'Mate disponible no ejecutado. La partida vuelve a estar abierta.',
  ],
  mate_escaped: [
    'Escapaste del mate forzado. Recurso defensivo de alto nivel.',
    'Salvas la posición de un mate inminente. Cálculo defensivo preciso.',
    'Encontraste la única salida al mate.',
  ],
  mate_into: [
    'Permitís mate forzado. Decisión irrecuperable.',
    'Caíste en mate. Existía una jugada que evitaba la red.',
    'El rival ahora tiene mate forzado. Movimiento crítico.',
  ],
};

/** Detecta el escenario de mate aplicable. null si no hay mates en juego. */
type MateScenario =
  | 'mate_executed'
  | 'mate_created'
  | 'mate_accelerated'
  | 'mate_delayed'
  | 'mate_lost'
  | 'mate_escaped'
  | 'mate_into'
  | null;

function detectMateScenario(
  color: 'w' | 'b' | undefined,
  mateBefore: number | null | undefined,
  mateAfter:  number | null | undefined,
): MateScenario {
  if (mateAfter === 0) return 'mate_executed';
  if (mateBefore == null && mateAfter == null) return null;

  const sign = (color || 'w') === 'w' ? 1 : -1;
  const mbPov = mateBefore == null ? null : mateBefore * sign;
  const maPov = mateAfter  == null ? null : mateAfter  * sign;

  // Sin mate -> mate a favor
  if (mbPov === null && maPov !== null && maPov > 0) return 'mate_created';
  // Mate a favor -> mate a favor
  if (mbPov !== null && maPov !== null && mbPov > 0 && maPov > 0) {
    return maPov <= mbPov ? 'mate_accelerated' : 'mate_delayed';
  }
  // Mate a favor -> sin mate
  if (mbPov !== null && mbPov > 0 && maPov === null) return 'mate_lost';
  // Mate contra -> sin mate (escapé)
  if (mbPov !== null && mbPov < 0 && maPov === null) return 'mate_escaped';
  // Sin mate -> mate contra (caí en él)
  if (mbPov === null && maPov !== null && maPov < 0) return 'mate_into';
  return null;
}

/**
 * Elige un texto del pool de forma determinística según el ply,
 * para que el mismo ply siempre muestre el mismo texto (sin flicker
 * entre renders) pero distintos plies muestren variantes distintas.
 */
function pickFromPool(pool: string[] | undefined, ply: number): string | null {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  // Hash simple: ply * primo. Sin Math.random para que sea estable.
  const idx = ((ply | 0) * 2654435761) >>> 0;
  return pool[idx % pool.length];
}

/**
 * Devuelve una explicación humana en español, o null si no hay
 * template aplicable. Variación determinística por ply.
 *
 * Prioridad de resolución:
 *   1. Escenario de mate (mate_executed, mate_created, mate_lost…)
 *   2. Específica por fase (mistake_opening, blunder_endgame…)
 *   3. Genérica por clasificación
 *
 * Todos los campos extra son opcionales: cualquier review loop puede
 * llamar humanExplanation sin pasar mate context y obtener fallback.
 */
export function humanExplanation(move: {
  classification: Classification;
  cpLoss?: number | null;
  color?: 'w' | 'b';
  phase?: Phase;
  san?: string;
  ply?: number;
  mateBefore?: number | null;
  mateAfter?: number | null;
  evalAfter?: number | null;
}): string | null {
  const cls = move.classification;
  const ply = move.ply ?? 0;

  // 1. Escenarios de mate (override más informativo)
  const scenario = detectMateScenario(move.color, move.mateBefore, move.mateAfter);
  if (scenario) {
    const mateText = pickFromPool(EXPLANATION_BANK[scenario], ply);
    if (mateText) return mateText;
  }

  // 2. Específica por fase
  if (move.phase) {
    const specific = EXPLANATION_BANK[`${cls}_${move.phase}`];
    const text = pickFromPool(specific, ply);
    if (text) return text;
  }

  // 3. Fallback genérico
  return pickFromPool(EXPLANATION_BANK[cls], ply);
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
