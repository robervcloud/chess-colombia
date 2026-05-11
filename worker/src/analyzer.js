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
  estimateElo,
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
    onProgress(i + 1, positions.length);
  }

  // Construir per-move analysis
  const movesAnalysis = [];
  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const before = positionEvals[i];
    const after  = positionEvals[i + 1];

    const evalBefore = evalToCp(before);
    const evalAfter  = evalToCp(after);

    // ¿La jugada introdujo un mate forzado en contra del que la jugó?
    // POV blancas: mate>0 = blancas matan, mate<0 = negras matan.
    // Si white movió y ahora aparece mate<0 → blunder de white. Y viceversa.
    let swung = false;
    if (before.mate === null && after.mate !== null) {
      if (move.color === 'w' && after.mate < 0) swung = true;
      if (move.color === 'b' && after.mate > 0) swung = true;
    }

    const cpLoss = cpLossForMove(move.color, evalBefore, evalAfter);

    // Clasificación
    const isMate = (after.mate !== null && Math.abs(after.mate) <= 5);
    const klass = classify(cpLoss, { swung });

    movesAnalysis.push({
      ply: i + 1,
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion || ''}`,
      color: move.color, // 'w' | 'b'
      fenBefore: positions[i].fen,
      fenAfter: positions[i + 1].fen,
      // Evals en POV blancas (más fácil para la barra)
      evalBefore,
      evalAfter,
      mateBefore: before.mate,
      mateAfter: after.mate,
      // Sugerencia del motor PARA esta posición
      bestMoveSan: before.bestMoveSan,
      bestMoveUci: before.bestMove,
      // Top líneas (en SAN) desde fenBefore
      lines: (before.lines || []).slice(0, 3),
      centipawnLoss: cpLoss,
      classification: klass,
      isMateDetected: isMate,
    });
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

  const eloEstimate = {
    white: estimateElo({
      accuracy: accW,
      blunders: summary.blundersWhite,
      mistakes: summary.mistakesWhite,
      totalPlies: whiteMoves.length,
    }),
    black: estimateElo({
      accuracy: accB,
      blunders: summary.blundersBlack,
      mistakes: summary.mistakesBlack,
      totalPlies: blackMoves.length,
    }),
  };

  return { movesAnalysis, summary, eloEstimate };
}

function countBy(arr, key, value) {
  let n = 0;
  for (const x of arr) if (x[key] === value) n++;
  return n;
}

module.exports = { analyzeGame };
