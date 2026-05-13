/**
 * Métricas: clasificación de jugadas, accuracy y estimador de Elo.
 *
 * Lo nuevo respecto a versiones previas:
 *   - estimateElo: continuo (interpolación calibrada), multi-feature
 *     (no sólo accuracy: ACPL, blunders, mistakes, consistencia,
 *      conversión, complejidad media).
 *   - Penalización proporcional al total de jugadas (no absoluta).
 *   - Sin hard cap en 2400: el techo es 2800 pero alcanzarlo requiere
 *     muchas jugadas precisas y baja varianza.
 *   - Shrinkage suave hacia 1200 para partidas cortas.
 *   - Confidence: 'high' | 'medium' | 'low'.
 *   - Reasons: array de strings explicativos (para UI).
 *
 * Sin dependencias externas, sólo aritmética.
 */

// ----- Clasificación por centipawn loss -----
function classify(cpLoss, mateInfo) {
  if (mateInfo && mateInfo.swung) return 'blunder';
  if (cpLoss < 10)  return 'best';
  if (cpLoss < 30)  return 'excellent';
  if (cpLoss < 75)  return 'good';
  if (cpLoss < 150) return 'inaccuracy';
  if (cpLoss < 300) return 'mistake';
  return 'blunder';
}

// ----- Win% según cp (Lichess) -----
function winPercent(cp) {
  const cpCapped = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cpCapped)) - 1);
}

// ----- Accuracy de una jugada -----
function moveAccuracy(wpBefore, wpAfter) {
  const delta = wpBefore - wpAfter;
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * delta) - 3.1669));
}

function computeSideAccuracy(moves) {
  if (!moves || moves.length === 0) return null;
  let sum = 0, n = 0;
  for (const m of moves) {
    if (typeof m.evalBefore !== 'number' || typeof m.evalAfter !== 'number') continue;
    let wpBefore, wpAfter;
    if (m.color === 'w') {
      wpBefore = winPercent(m.evalBefore);
      wpAfter  = winPercent(m.evalAfter);
    } else {
      wpBefore = winPercent(-m.evalBefore);
      wpAfter  = winPercent(-m.evalAfter);
    }
    sum += moveAccuracy(wpBefore, wpAfter);
    n++;
  }
  if (n === 0) return null;
  return Math.round((sum / n) * 10) / 10;
}

function cpLossForMove(moverColor, evalBefore, evalAfter) {
  if (moverColor === 'w') return Math.max(0, evalBefore - evalAfter);
  return Math.max(0, evalAfter - evalBefore);
}

/* =========================================================
 *                  ELO ESTIMATOR v2
 * ========================================================= */

// Interpolación lineal segmentada accuracy→Elo, calibrada manualmente
// para sentirse humana. Sin hard cap, pero la curva se vuelve muy
// empinada arriba: 96+ acc cuesta mucho de mantener en partidas largas.
const ACC_TO_ELO_POINTS = [
  [30,  500],
  [40,  650],
  [50,  850],
  [60, 1100],
  [70, 1350],
  [75, 1500],
  [80, 1650],
  [83, 1750],
  [85, 1830],
  [88, 1950],
  [90, 2050],
  [92, 2160],
  [94, 2260],
  [95, 2330],
  [96, 2410],
  [97, 2500],
  [98, 2620],
  [99, 2740],
  [99.5, 2820],
];

function eloFromAccuracy(acc) {
  if (acc === null || acc === undefined) return 1200;
  const pts = ACC_TO_ELO_POINTS;
  if (acc <= pts[0][0]) return pts[0][1];
  if (acc >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (acc <= pts[i][0]) {
      const [a1, e1] = pts[i - 1];
      const [a2, e2] = pts[i];
      return e1 + (e2 - e1) * (acc - a1) / (a2 - a1);
    }
  }
  return 1200;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function stdev(arr) {
  if (!arr || arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
  return Math.sqrt(v);
}

/**
 * Estima Elo con múltiples features.
 *
 * `moves` es la lista de jugadas YA analizadas del jugador en cuestión,
 * cada una con { centipawnLoss, classification, evalBefore, evalAfter,
 *                color, lines? }.
 *
 * Devuelve { value, confidence: 'high'|'medium'|'low', reasons: string[] }.
 */
function estimateEloV2({ accuracy, moves }) {
  const reasons = [];
  const n = moves ? moves.length : 0;

  if (!moves || n === 0 || accuracy === null || accuracy === undefined) {
    return { value: 1200, confidence: 'low', reasons: ['Datos insuficientes'] };
  }

  // ---- (1) Base por accuracy (continuo) ----
  let elo = eloFromAccuracy(accuracy);

  // ---- (2) Penalizaciones proporcionales ----
  const blunders   = moves.filter((m) => m.classification === 'blunder').length;
  const mistakes   = moves.filter((m) => m.classification === 'mistake').length;
  const inaccs     = moves.filter((m) => m.classification === 'inaccuracy').length;
  const bestCount  = moves.filter((m) => m.classification === 'best' || m.classification === 'excellent').length;

  const blunderRate  = blunders / n;
  const mistakeRate  = mistakes / n;
  const inaccRate    = inaccs / n;
  const bestRate     = bestCount / n;

  // Curva: 1 blunder en 10 jugadas pesa más que 1 en 60.
  elo -= 600 * blunderRate;          // 10% blunders → -60
  elo -= 250 * mistakeRate;
  elo -= 80  * inaccRate;

  if (blunderRate > 0.10) reasons.push('Blunders frecuentes en momentos críticos');
  else if (blunders > 0)  reasons.push(`${blunders} blunder${blunders > 1 ? 's' : ''}`);

  // ---- (3) Bonus por consistencia (varianza baja de cpLoss) ----
  const cpLosses = moves.map((m) => Math.min(500, m.centipawnLoss || 0));
  const sd = stdev(cpLosses);
  // sd<30 muy consistente; sd>120 errático
  const consistencyBonus = clamp(60 - (sd - 30) * 0.5, -40, 60);
  elo += consistencyBonus;
  if (sd < 35 && n >= 15) reasons.push('Precisión sostenida durante toda la partida');
  else if (sd > 150)      reasons.push('Calidad inconsistente entre jugadas');

  // ---- (4) Bonus por jugadas óptimas frecuentes ----
  if (bestRate > 0.55 && n >= 20) {
    elo += 50;
    reasons.push('Alta tasa de mejores jugadas');
  }

  // ---- (5) Conversión: mantener ventaja sin perderla ----
  // Si en algún momento el jugador tenía >+200cp y al final lo perdió:
  let peakAdvantage = 0;
  let endAdvantage = null;
  const color = moves[0]?.color;
  for (const m of moves) {
    const advAfter = color === 'w' ? m.evalAfter : -m.evalAfter;
    if (advAfter > peakAdvantage) peakAdvantage = advAfter;
    endAdvantage = advAfter;
  }
  if (peakAdvantage > 250 && endAdvantage !== null && endAdvantage < 50) {
    elo -= 80;
    reasons.push('Perdió una ventaja decisiva durante la partida');
  } else if (peakAdvantage > 200 && endAdvantage !== null && endAdvantage > 150) {
    elo += 30;
    reasons.push('Conservó la ventaja con técnica');
  }

  // ---- (6) Complejidad de las posiciones (diff entre top líneas) ----
  // Si las 2 mejores líneas estaban muy parejas → posición compleja.
  // Un jugador que encuentra la #1 en posición compleja merece más mérito.
  let complexityHits = 0;
  let complexitySamples = 0;
  for (const m of moves) {
    if (!Array.isArray(m.lines) || m.lines.length < 2) continue;
    const e1 = lineEval(m.lines[0]);
    const e2 = lineEval(m.lines[1]);
    if (e1 === null || e2 === null) continue;
    complexitySamples++;
    const diff = Math.abs(e1 - e2);
    // Posición compleja: <50cp de diferencia. El jugador encontró la mejor.
    if (diff < 50 && m.classification === 'best') complexityHits++;
  }
  if (complexitySamples >= 10) {
    const rate = complexityHits / complexitySamples;
    if (rate > 0.4) {
      elo += 60;
      reasons.push('Buen criterio en posiciones complejas');
    }
  }

  // ---- (7) Shrinkage para partidas cortas ----
  // < 20 jugadas: el muestreo es pobre; empujamos hacia la media (1200)
  let confidence = 'high';
  if (n < 10) {
    elo = elo * 0.4 + 1200 * 0.6;
    confidence = 'low';
    reasons.push('Partida muy corta para estimar con precisión');
  } else if (n < 20) {
    elo = elo * 0.65 + 1200 * 0.35;
    confidence = 'low';
    reasons.push('Pocas jugadas: estimación con poca confianza');
  } else if (n < 35) {
    elo = elo * 0.85 + 1200 * 0.15;
    confidence = 'medium';
  }

  // Confidence también baja si la varianza es muy alta (juego errático)
  if (sd > 180 && confidence === 'high') confidence = 'medium';
  if (sd > 250) confidence = 'low';

  // ---- (8) Techo soft alto: 2800. Sin hard cap arbitrario. ----
  elo = clamp(elo, 400, 2800);

  // Reason por defecto si no se acumuló ninguno
  if (reasons.length === 0) {
    if (accuracy >= 90) reasons.push('Alta precisión global');
    else if (accuracy >= 80) reasons.push('Juego sólido en general');
    else reasons.push('Errores ocasionales');
  }

  return {
    value: Math.round(elo),
    confidence,
    reasons: reasons.slice(0, 4), // top 4 razones
  };
}

// Helper: extrae eval (en cp POV blancas) de una line si fue almacenada
function lineEval(line) {
  if (!line) return null;
  if (typeof line.cp === 'number') return line.cp;
  if (typeof line.mate === 'number') return line.mate > 0 ? 10000 : -10000;
  return null;
}

// Wrapper legacy (compatibilidad con código que sólo necesita el número)
function estimateElo({ accuracy, blunders, mistakes, totalPlies, moves }) {
  if (moves) return estimateEloV2({ accuracy, moves }).value;
  // Fallback simplificado si nos llaman sin moves (compatibilidad)
  let elo = eloFromAccuracy(accuracy);
  elo -= 60 * (blunders || 0);
  elo -= 25 * (mistakes || 0);
  if (totalPlies && totalPlies < 20) {
    elo = elo * 0.65 + 1200 * 0.35;
  }
  return Math.round(clamp(elo, 400, 2800));
}

module.exports = {
  classify,
  winPercent,
  moveAccuracy,
  computeSideAccuracy,
  cpLossForMove,
  estimateElo,
  estimateEloV2,
};
