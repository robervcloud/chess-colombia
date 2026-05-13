/**
 * Capa de DB del worker.
 * Usa la SERVICE_KEY de Supabase (mismas credenciales que el backend).
 */
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('[worker.db] Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY');
}


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: WebSocket,
    },
  }
);

/**
 * Reclama UN análisis pendiente (pasa de 'pending' a 'running').
 * Atómico vía RPC `claim_pending_analysis` (FOR UPDATE SKIP LOCKED).
 * Devuelve { game_id, pgn } o null si no hay nada pendiente.
 */
async function claimNextPending() {
  const { data, error } = await supabase.rpc('claim_pending_analysis');
  if (error) throw new Error(`RPC claim_pending_analysis: ${error.message}`);
  if (!data || data.length === 0) return null;
  return data[0]; // { game_id, pgn }
}

async function markDone(gameId, result, engineMeta) {
  const { error } = await supabase
    .from('game_analyses')
    .update({
      status: 'done',
      moves_analysis: result.movesAnalysis,
      summary: result.summary,
      elo_white: result.eloEstimate.white,
      elo_black: result.eloEstimate.black,
      elo_confidence_white: result.eloEstimate.confidenceWhite || null,
      elo_confidence_black: result.eloEstimate.confidenceBlack || null,
      elo_reasons_white: result.eloEstimate.reasonsWhite || null,
      elo_reasons_black: result.eloEstimate.reasonsBlack || null,
      engine_name: engineMeta?.name || 'stockfish',
      engine_depth: engineMeta?.depth || null,
      progress_current: result.movesAnalysis.length,
      progress_total: result.movesAnalysis.length,
      completed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('game_id', gameId);
  if (error) throw new Error(`markDone: ${error.message}`);
}

/**
 * Persiste progreso parcial. Llamado durante el análisis.
 *  - current/total: contadores (siempre)
 *  - partialMoves: moves_analysis acumulado hasta ahora (opcional, costoso)
 *
 * Hacer estos updates "best-effort": si fallan, sólo logueamos.
 */
async function markProgress(gameId, current, total, partialMoves) {
  const patch = { progress_current: current, progress_total: total };
  if (partialMoves) patch.moves_analysis = partialMoves;
  const { error } = await supabase
    .from('game_analyses')
    .update(patch)
    .eq('game_id', gameId);
  if (error) console.warn('[worker.db.markProgress]', error.message);
}

async function markFailed(gameId, errorMessage) {
  const msg = String(errorMessage || 'unknown error').slice(0, 1000);
  const { error } = await supabase
    .from('game_analyses')
    .update({
      status: 'failed',
      error_message: msg,
      completed_at: new Date().toISOString(),
    })
    .eq('game_id', gameId);
  if (error) console.error('[worker.db.markFailed]', error);
}

async function purgeOldAnalyses() {
  const { data, error } = await supabase.rpc('purge_old_analyses');
  if (error) throw new Error(`RPC purge_old_analyses: ${error.message}`);
  return data || 0;
}

module.exports = { claimNextPending, markDone, markFailed, markProgress, purgeOldAnalyses };
