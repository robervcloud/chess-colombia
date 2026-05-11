/**
 * Métricas: clasificación de jugadas, accuracy y Elo estimado.
 *
 * Las constantes y la fórmula de winPercent/accuracy provienen del
 * paper público de Lichess (open source); el cálculo de Elo es un
 * heurístico simple basado en accuracy + blunders.
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

/**
 * Accuracy promedio para una lista de jugadas de un mismo color.
 * Cada movimiento `m` debe traer evalBefore/evalAfter ya en POV blancas.
 */
function computeSideAccuracy(moves) {
  if (!moves || moves.length === 0) return null;
  let sum = 0;
  let n = 0;
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
  return Math.round((sum / n) * 10) / 10; // 1 decimal
}

/**
 * Centipawn loss de una jugada en POV del jugador que la hizo.
 * eval{Before,After} están en POV blancas.
 */
function cpLossForMove(moverColor, evalBefore, evalAfter) {
  if (moverColor === 'w') return Math.max(0, evalBefore - evalAfter);
  return Math.max(0, evalAfter - evalBefore);
}

/**
 * Heurístico de Elo a partir de accuracy + nº blunders/mistakes.
 * NO es un Elo oficial; es una "estimación de nivel de juego".
 */
function estimateElo({ accuracy, blunders, mistakes, totalPlies }) {
  if (accuracy === null || accuracy === undefined) return 1200;

  // Curva base por accuracy
  let elo;
  if      (accuracy >= 95) elo = 2200;
  else if (accuracy >= 90) elo = 2000;
  else if (accuracy >= 85) elo = 1800;
  else if (accuracy >= 80) elo = 1600;
  else if (accuracy >= 75) elo = 1400;
  else if (accuracy >= 70) elo = 1300;
  else if (accuracy >= 65) elo = 1200;
  else if (accuracy >= 60) elo = 1100;
  else if (accuracy >= 50) elo = 950;
  else                     elo = 800;

  // Penalizaciones
  elo -= Math.min(240, (blunders || 0) * 60);
  elo -= Math.min(100, (mistakes || 0) * 25);

  // Partidas cortas: menos confianza, regresar al medio
  if (totalPlies && totalPlies < 20) {
    elo = Math.round(elo * 0.6 + 1200 * 0.4);
  }

  return Math.max(600, Math.min(2400, elo));
}

module.exports = {
  classify,
  winPercent,
  moveAccuracy,
  computeSideAccuracy,
  cpLossForMove,
  estimateElo,
};
