/**
 * Worker de análisis post-partida.
 *
 * Loop:
 *   1. Hacer un claim atómico de un análisis pendiente.
 *   2. Si hay job: leer su PGN, pasarlo por Stockfish + analyzer.
 *   3. Persistir el resultado en game_analyses.
 *   4. Si no había job: dormir POLL_INTERVAL_MS y reintentar.
 *
 * El motor se inicia UNA vez al arranque y se reusa entre partidas
 * (mucho más rápido que reabrir el binario por cada partida).
 *
 * Si Stockfish muere, el worker lo reinicia.
 */
require('dotenv').config();

const http = require('http');
const { StockfishEngine } = require('./engine');
const { analyzeGame } = require('./analyzer');
const db = require('./db');

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '4000', 10);
const ENGINE_DEPTH = parseInt(process.env.ENGINE_DEPTH || '12', 10);

let engine = null;
let stopping = false;
let currentJobId = null; // P1-6: para marcar failed en SIGTERM si hay job en progreso

// Render Free Web Service necesita un puerto abierto.
// Este mini servidor HTTP mantiene vivo el worker.
const PORT = process.env.PORT || 10000;

http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end('Worker alive');
  })
  .listen(PORT, () => {
    console.log(`[worker] Health server on port ${PORT}`);
  });


function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureEngine() {
  if (engine && engine.alive) return engine;
  if (engine) {
    try { engine.quit(); } catch {}
  }
  engine = new StockfishEngine();
  await engine.init();
  console.log(`[worker] Stockfish listo (depth=${engine.depth}, multipv=${engine.multipv})`);
  return engine;
}

async function processOne(job) {
  currentJobId = job.game_id;
  const t0 = Date.now();
  console.log(`[worker] Procesando ${job.game_id} ...`);
  if (!job.pgn || job.pgn.trim().length === 0) {
    await db.markFailed(job.game_id, 'PGN vacío');
    console.warn(`[worker] ${job.game_id}: PGN vacío, marcado failed`);
    currentJobId = null;
    return;
  }

  const eng = await ensureEngine();
  try {
    const result = await analyzeGame(eng, job.pgn, {
      onProgress: (i, total) => {
        if (i === total || i % 10 === 0) {
          process.stdout.write(`\r[worker]   ${job.game_id}: ${i}/${total} posiciones    `);
        }
      },
    });
    process.stdout.write('\n');
    await db.markDone(job.game_id, result, {
      name: 'stockfish',
      depth: ENGINE_DEPTH,
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[worker] ✓ ${job.game_id} en ${secs}s ` +
      `(W:${result.summary.accuracyWhite}% B:${result.summary.accuracyBlack}%, ` +
      `Elo W:${result.eloEstimate.white} B:${result.eloEstimate.black})`
    );
  } catch (err) {
    console.error(`[worker] ✗ ${job.game_id}:`, err.message);
    await db.markFailed(job.game_id, err.message);
    // Si el error fue del engine (murió), forzamos reinicio en el próximo loop
    if (engine && !engine.alive) {
      try { engine.quit(); } catch {}
      engine = null;
    }
  } finally {
    currentJobId = null;
  }
}

async function loop() {
  while (!stopping) {
    let job = null;
    try {
      job = await db.claimNextPending();
    } catch (err) {
      console.error('[worker] Error reclamando job:', err.message);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    await processOne(job);
  }
}

async function main() {
  console.log('=========================================');
  console.log(' Chess Colombia · Worker de análisis');
  console.log('=========================================');
  console.log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`  Engine depth:  ${ENGINE_DEPTH}`);
  console.log(`  Stockfish:     ${process.env.STOCKFISH_PATH || 'stockfish'}`);
  console.log('');

  try {
    await ensureEngine();
  } catch (err) {
    console.error('[worker] No pude iniciar el motor. Abortando.');
    console.error('         ' + err.message);
    process.exit(1);
  }

  await loop();

  if (engine) engine.quit();
  console.log('[worker] Detenido limpiamente');
}

function shutdown(sig) {
  console.log(`\n[worker] ${sig} recibido, deteniendo...`);
  stopping = true;
  // P1-6: si hay un análisis en progreso, marcarlo failed para que
  // pueda reintentarse, en vez de dejarlo en 'running' (zombie).
  if (currentJobId) {
    console.log(`[worker] Job en progreso ${currentJobId}: marcando failed antes de salir`);
    db.markFailed(currentJobId, `worker shutdown (${sig})`)
      .catch((e) => console.error('[worker] markFailed en shutdown falló:', e.message))
      .finally(() => setTimeout(() => process.exit(0), 1500).unref());
  } else {
    setTimeout(() => process.exit(0), 1500).unref();
  }
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// P1-2: red de seguridad ante errores no manejados.
// Logueamos y dejamos que Render reinicie limpio.
process.on('uncaughtException', (err) => {
  console.error('[worker FATAL] uncaughtException:', err);
  shutdown('UNCAUGHT_EXCEPTION');
});
process.on('unhandledRejection', (reason) => {
  console.error('[worker FATAL] unhandledRejection:', reason);
  // No matamos por unhandledRejection inmediatamente; muchas son recuperables.
  // Si quieres ser estricto en producción, descomenta:
  // shutdown('UNHANDLED_REJECTION');
});

main().catch((err) => {
  console.error('[worker] Fatal:', err);
  process.exit(1);
});
