/**
 * Pipeline completo de análisis de una partida.
 *
 * Entrada: PGN de la partida.
 * Pasos:
 *   1. Reproducir PGN con chess.js, generar todas las posiciones (FENs).
 *   2. Analizar cada posición con el motor (UNA vez cada una).
 *   3. Para cada movimiento played: derivar evalBefore (= análisis de la
 *      posición ANTES) y evalAfter (= análisis de la posición DESPUÉS),
 *      ya que esa es la mejor línea del rival al final de la jugada.
 *   4. Clasificar y calcular accuracy + Elo.
 *
 * Convención: TODOS los evals (cp y mate) están en POV de las BLANCAS.
 * El cpLoss se calcula desde el POV del jugador que movió.
 */
const { Chess } = require('chess.js');
const {
  classify,
  computeSideAccuracy,
  cpLossForMove,
  estimateEloV2,
} = require('./metrics');

const MATE_BIG = 100_000; // valor "infinito" para convertir mate -> cp interno

function mateToInternalCp(mate) {
  if (mate === null || mate === undefined) return null;
  // Mate positivo (blancas matan): valor enorme positivo decreciendo con la distancia.
  // Mate negativo (negras matan): muy negativo.
  return mate > 0 ? MATE_BIG - mate : -MATE_BIG - mate;
}

function evalToCp({ cp, mate }) {
  if (mate !== null && mate !== undefined) return mateToInternalCp(mate);
  return cp ?? 0;
}

async function analyzeGame(engine, pgn, opts = {}) {
  const maxPlies = opts.maxPlies || parseInt(process.env.MAX_PLIES || '200', 10);
  const onProgress = opts.onProgress || (() => {});

  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (err) {
    throw new Error(`PGN inválido: ${err.message}`);
  }

  const fullHistory = chess.history({ verbose: true });
  const history = fullHistory.slice(0, maxPlies);
  const truncated = fullHistory.length > history.length;

  // Reconstruir todas las posiciones (incluyendo la inicial)
  const replay = new Chess();
  const positions = [{ fen: replay.fen() }];
  for (const m of history) {
    replay.move({ from: m.from, to: m.to, promotion: m.promotion });
    positions.push({ fen: replay.fen() });
  }

  // Analizar cada posición
  const positionEvals = [];
  for (let i = 0; i < positions.length; i++) {
    const a = await engine.analyze(positions[i].fen);
    positionEvals.push(a);
    // Notificamos progreso de posiciones evaluadas
    onProgress(i + 1, positions.length);

    // Si tenemos ya una pareja (i-1, i) → podemos construir el move (i-1)
    // y emitir un onPartial con la jugada recién evaluada.
    if (i >= 1 && i <= history.length && opts.onPartial) {
      const moveIdx = i - 1;
      const partial = buildMoveAnalysis(history[moveIdx], moveIdx,
        positionEvals[moveIdx], positionEvals[moveIdx + 1],
        positions[moveIdx].fen, positions[moveIdx + 1].fen);
      try { opts.onPartial(partial, moveIdx, history.length); } catch {}
    }
  }

  // Construir per-move analysis (usa el mismo helper que onPartial)
  const movesAnalysis = [];
  for (let i = 0; i < history.length; i++) {
    movesAnalysis.push(buildMoveAnalysis(
      history[i], i,
      positionEvals[i], positionEvals[i + 1],
      positions[i].fen, positions[i + 1].fen
    ));
  }

  // Resumen
  const whiteMoves = movesAnalysis.filter((m) => m.color === 'w');
  const blackMoves = movesAnalysis.filter((m) => m.color === 'b');

  const accW = computeSideAccuracy(whiteMoves);
  const accB = computeSideAccuracy(blackMoves);

  const summary = {
    accuracyWhite: accW,
    accuracyBlack: accB,
    blundersWhite:    countBy(whiteMoves, 'classification', 'blunder'),
    blundersBlack:    countBy(blackMoves, 'classification', 'blunder'),
    mistakesWhite:    countBy(whiteMoves, 'classification', 'mistake'),
    mistakesBlack:    countBy(blackMoves, 'classification', 'mistake'),
    inaccuraciesWhite:countBy(whiteMoves, 'classification', 'inaccuracy'),
    inaccuraciesBlack:countBy(blackMoves, 'classification', 'inaccuracy'),
    bestMovesWhite:   countBy(whiteMoves, 'classification', 'best'),
    bestMovesBlack:   countBy(blackMoves, 'classification', 'best'),
    totalPlies:       movesAnalysis.length,
    truncated,
  };

  // Elo v2 con razones + confianza
  const eW = estimateEloV2({ accuracy: accW, moves: whiteMoves });
  const eB = estimateEloV2({ accuracy: accB, moves: blackMoves });
  const eloEstimate = {
    white: eW.value,
    black: eB.value,
    confidenceWhite: eW.confidence,
    confidenceBlack: eB.confidence,
    reasonsWhite: eW.reasons,
    reasonsBlack: eB.reasons,
  };

  return { movesAnalysis, summary, eloEstimate };
}

/** Construye una entrada per-move. Mismo shape en streaming y final. */
function buildMoveAnalysis(move, idx, before, after, fenBefore, fenAfter) {
  const evalBefore = evalToCp(before);
  const evalAfter  = evalToCp(after);
  let swung = false;
  if (before.mate === null && after.mate !== null) {
    if (move.color === 'w' && after.mate < 0) swung = true;
    if (move.color === 'b' && after.mate > 0) swung = true;
  }
  const cpLoss = cpLossForMove(move.color, evalBefore, evalAfter);
  const isMate = (after.mate !== null && Math.abs(after.mate) <= 5);
  const klass = classify(cpLoss, { swung });
  return {
    ply: idx + 1,
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion || ''}`,
    color: move.color,
    fenBefore,
    fenAfter,
    evalBefore,
    evalAfter,
    mateBefore: before.mate,
    mateAfter: after.mate,
    bestMoveSan: before.bestMoveSan,
    bestMoveUci: before.bestMove,
    lines: (before.lines || []).slice(0, 3),
    centipawnLoss: cpLoss,
    classification: klass,
    isMateDetected: isMate,
  };
}

function countBy(arr, key, value) {
  let n = 0;
  for (const x of arr) if (x[key] === value) n++;
  return n;
}

module.exports = { analyzeGame };
