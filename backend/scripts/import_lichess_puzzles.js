#!/usr/bin/env node
/**
 * Importador de puzzles oficiales de Lichess (CC0).
 *
 * Fuente: https://database.lichess.org/lichess_db_puzzle.csv.zst
 *   - ~4M puzzles
 *   - CSV columns: PuzzleId, FEN, Moves, Rating, RatingDeviation,
 *                  Popularity, NbPlays, Themes, GameUrl, OpeningTags
 *
 * Diseño:
 *   - Lectura por streaming (readline). RAM constante.
 *   - Validación per-puzzle con chess.js (descarta FEN/moves rotos).
 *   - Bulk UPSERT por lotes (BATCH_SIZE), ON CONFLICT(id) DO NOTHING.
 *   - Filtros opcionales por rating mínimo/máximo, theme, popularity.
 *
 * Uso:
 *   # 1. Descargar el CSV de Lichess (sin descomprimir)
 *   wget https://database.lichess.org/lichess_db_puzzle.csv.zst
 *   # 2. Descomprimir streaming directo al script:
 *   zstdcat lichess_db_puzzle.csv.zst | node backend/scripts/import_lichess_puzzles.js -
 *
 *   # O desde archivo CSV ya descomprimido:
 *   node backend/scripts/import_lichess_puzzles.js path/to/lichess_db_puzzle.csv
 *
 * Variables de entorno (todas opcionales):
 *   MIN_RATING        (default 600)
 *   MAX_RATING        (default 2800)
 *   MIN_POPULARITY    (default 50)    -- filtra puzzles raros/dudosos
 *   ONLY_THEMES       (CSV ex "mateIn1,fork,pin")  filtra por temas
 *   LIMIT             (default sin límite) detener tras N importados
 *   BATCH_SIZE        (default 500)
 *
 * Lo que NO hace (intencional):
 *   - No descarga ni descomprime; usá `zstdcat | ...`.
 *   - No actualiza puzzles ya importados (ignoreDuplicates).
 *   - No re-calcula agregados; ver migración 008 (recompute_puzzle_aggregates).
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { Chess } = require('chess.js');
const supabase = require('../src/config/supabase');

const MIN_RATING     = parseInt(process.env.MIN_RATING     || '600',  10);
const MAX_RATING     = parseInt(process.env.MAX_RATING     || '2800', 10);
const MIN_POPULARITY = parseInt(process.env.MIN_POPULARITY || '50',   10);
const BATCH_SIZE     = parseInt(process.env.BATCH_SIZE     || '500',  10);
const LIMIT          = parseInt(process.env.LIMIT          || '0',    10); // 0 = sin tope
const ONLY_THEMES    = (process.env.ONLY_THEMES || '').split(',').map(s=>s.trim()).filter(Boolean);

async function main() {
  const argFile = process.argv[2];
  if (!argFile) {
    console.error('Uso: node import_lichess_puzzles.js <archivo.csv|-> ');
    console.error('   (- lee de stdin)');
    process.exit(1);
  }
  const input = argFile === '-' ? process.stdin : fs.createReadStream(argFile);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let read = 0, valid = 0, dropped = 0, imported = 0, batchErr = 0;
  let batch = [];
  let isFirst = true;
  const t0 = Date.now();

  for await (const line of rl) {
    if (isFirst) {
      isFirst = false;
      // Saltar header si existe
      if (line.toLowerCase().startsWith('puzzleid')) continue;
    }
    read++;
    if (LIMIT > 0 && imported >= LIMIT) break;

    // Lichess CSV: campos sin comas internas (FEN/Moves no las contienen),
    // así que split simple alcanza. PuzzleId, FEN, Moves, Rating, RD,
    // Popularity, NbPlays, Themes, GameUrl, OpeningTags
    const p = line.split(',');
    if (p.length < 8) { dropped++; continue; }
    const id         = p[0];
    const fen        = p[1];
    const movesStr   = p[2];
    const rating     = parseInt(p[3], 10);
    const popularity = parseInt(p[5], 10) || 0;
    const themesStr  = p[7] || '';

    if (!id || !fen || !movesStr || isNaN(rating)) { dropped++; continue; }
    if (rating < MIN_RATING || rating > MAX_RATING) { dropped++; continue; }
    if (popularity < MIN_POPULARITY) { dropped++; continue; }

    const themes = themesStr ? themesStr.split(' ').filter(Boolean) : [];
    if (ONLY_THEMES.length && !themes.some(t => ONLY_THEMES.includes(t))) {
      dropped++; continue;
    }

    // Validar con chess.js: aplicar TODOS los moves UCI y que sean legales
    if (!validatePuzzle(fen, movesStr)) { dropped++; continue; }

    valid++;
    batch.push({
      id,
      fen,
      moves_uci: movesStr,
      rating,
      themes,
      popularity,
      source: 'lichess',
    });

    if (batch.length >= BATCH_SIZE) await flush();

    if (read % 5000 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stderr.write(
        `\r[import] ${elapsed}s · leídos=${read} válidos=${valid} ` +
        `importados=${imported} dropped=${dropped}`
      );
    }
  }

  if (batch.length) await flush();
  process.stderr.write('\n');
  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[import] FIN en ${totalSec}s. ` +
    `leídos=${read} válidos=${valid} importados=${imported} ` +
    `dropped=${dropped} batchErrs=${batchErr}`
  );

  async function flush() {
    const b = batch;
    batch = [];
    const { error } = await supabase
      .from('puzzles')
      .upsert(b, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      batchErr++;
      console.error('\n[import] batch error:', error.message);
    } else {
      imported += b.length;
    }
  }
}

/**
 * Valida que la secuencia UCI sea reproducible desde FEN con chess.js.
 * Cualquier movimiento ilegal o promoción mal formada → descarta.
 */
function validatePuzzle(fen, movesStr) {
  const moves = movesStr.split(' ').filter(Boolean);
  if (moves.length < 1) return false;
  let chess;
  try { chess = new Chess(fen); } catch { return false; }
  for (const u of moves) {
    if (u.length < 4) return false;
    const move = {
      from: u.substring(0, 2),
      to:   u.substring(2, 4),
    };
    if (u.length > 4) move.promotion = u.substring(4, 5);
    try {
      const r = chess.move(move);
      if (!r) return false;
    } catch {
      return false;
    }
  }
  return true;
}

main().catch((e) => {
  console.error('\n[import] FATAL:', e);
  process.exit(1);
});
