'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Chess } from 'chess.js';

import AuthGuard from '@/components/AuthGuard';
import EvalBar from '@/components/EvalBar';
import MoveList from '@/components/MoveList';
import EngineLines from '@/components/EngineLines';
import { MoveBadge } from '@/components/MoveBadge';
import { ReviewSummary } from '@/components/ReviewSummary';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { gamePhase, humanExplanation, type Phase } from '@/lib/moveClassification';
import type { GameAnalysis, MoveAnalysis } from '@/types/analysis';

const ChessBoard = dynamic(
  () => import('react-chessboard').then((m) => m.Chessboard),
  { ssr: false }
);

type Square = `${'a'|'b'|'c'|'d'|'e'|'f'|'g'|'h'}${'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'}`;

interface ApiResp {
  game: {
    id: string;
    white_id: string | null;
    black_id: string | null;
    white_username: string;
    black_username: string;
    time_control: string;
    result: string | null;
  };
  analysis: GameAnalysis | null;
}

const POLL_MS_RUNNING = 1500;
const POLL_MS_PENDING = 3000;
const STAGNATION_ATTEMPTS = 60;

function AnalysisInner() {
  const params = useParams();
  const router = useRouter();
  const gameId = String(params.id);
  const { user } = useAuth();

  const [data, setData] = useState<ApiResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPly, setSelectedPly] = useState(0);
  const userTouchedNavRef = useRef(false);
  const pollRef = useRef<number | null>(null);

  // ---- Polling adaptativo ----
  useEffect(() => {
    let cancelled = false;
    let stagnant = 0;
    let lastProgress = -1;
    async function load() {
      try {
        const resp = await api<ApiResp>(`/api/games/${gameId}/analysis`);
        if (cancelled) return;
        setData(resp);
        const status = resp.analysis?.status;
        const current = resp.analysis?.progress_current ?? 0;
        if (status === 'done' || status === 'failed') {
          if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null; }
          return;
        }
        if (current > lastProgress) { lastProgress = current; stagnant = 0; setError(null); }
        else stagnant++;
        let nextDelay = status === 'running' ? POLL_MS_RUNNING : POLL_MS_PENDING;
        if (stagnant >= STAGNATION_ATTEMPTS) {
          nextDelay = 5000;
          setError('El análisis está tardando más de lo normal. Seguimos intentando…');
        }
        pollRef.current = window.setTimeout(load, nextDelay);
      } catch (e: any) {
        if (cancelled) return;
        pollRef.current = window.setTimeout(load, 5000);
        setError(e?.message || 'Error temporal; reintentando…');
      }
    }
    load();
    return () => { cancelled = true; if (pollRef.current) window.clearTimeout(pollRef.current); };
  }, [gameId]);

  const moves: MoveAnalysis[] = data?.analysis?.moves_analysis || [];
  const totalPlies = moves.length;
  const status = data?.analysis?.status;

  // Auto-follow durante streaming
  useEffect(() => {
    if (selectedPly > totalPlies) { setSelectedPly(totalPlies); return; }
    if (status === 'running' && !userTouchedNavRef.current && totalPlies > 0) {
      setSelectedPly(totalPlies);
    }
  }, [totalPlies, status, selectedPly]);

  // Atajos de teclado
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft')      { e.preventDefault(); userTouchedNavRef.current = true; setSelectedPly((p) => Math.max(0, p - 1)); }
      else if (e.key === 'ArrowRight'){ e.preventDefault(); userTouchedNavRef.current = true; setSelectedPly((p) => Math.min(totalPlies, p + 1)); }
      else if (e.key === 'Home')      { userTouchedNavRef.current = true; setSelectedPly(0); }
      else if (e.key === 'End')       { userTouchedNavRef.current = true; setSelectedPly(totalPlies); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [totalPlies]);

  // Tamaño responsive del board
  const [boardWidth, setBoardWidth] = useState(480);
  useEffect(() => {
    function resize() {
      const w = typeof window === 'undefined' ? 480 : window.innerWidth;
      setBoardWidth(Math.min(520, Math.max(280, w - 64)));
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // ReviewMove[] derivado para alimentar ReviewSummary y MoveList con phase + cpLoss
  // Es un MAP O(n) sobre moves cuando cambia el array (memoizado).
  const reviewMovesForSummary = useMemo(() => {
    return moves.map((m, i) => ({
      ply: m.ply,
      san: m.san,
      color: m.color,
      classification: m.classification,
      cpLoss: m.centipawnLoss,
      phase: gamePhase(i, m.fenAfter) as Phase,
    }));
  }, [moves]);

  const { fen, currentMove, evalCp, evalMate, currentLines, bestMoveSan, bestMoveUci } = useMemo(() => {
    if (selectedPly === 0 || moves.length === 0) {
      return {
        fen: 'start' as string,
        currentMove: null as MoveAnalysis | null,
        evalCp: 0,
        evalMate: null as number | null,
        currentLines: moves[0]?.lines || [],
        bestMoveSan: moves[0]?.bestMoveSan || null,
        bestMoveUci: moves[0]?.bestMoveUci || null,
      };
    }
    const m = moves[Math.min(selectedPly, moves.length) - 1];
    return {
      fen: m.fenAfter,
      currentMove: m,
      evalCp: m.evalAfter,
      evalMate: m.mateAfter,
      currentLines: m.lines || [],
      bestMoveSan: m.bestMoveSan || null,
      bestMoveUci: m.bestMoveUci || null,
    };
  }, [moves, selectedPly]);

  // Flechas: jugada real (verde si buena, terracota si mala) + sugerencia dorada
  const customArrows = useMemo<Array<[Square, Square, string]>>(() => {
    const arr: Array<[Square, Square, string]> = [];
    if (currentMove && currentMove.uci && currentMove.uci.length >= 4) {
      const k = currentMove.classification;
      const isGreat = k === 'brilliant' || k === 'great' || k === 'best' || k === 'excellent';
      const isBad   = k === 'mistake' || k === 'blunder';
      const color = isGreat
        ? 'rgba(58,160,120,0.55)'
        : isBad
          ? 'rgba(160,90,70,0.55)'
          : 'rgba(160,140,110,0.45)';
      arr.push([
        currentMove.uci.substring(0, 2) as Square,
        currentMove.uci.substring(2, 4) as Square,
        color,
      ]);
    }
    if (bestMoveUci && bestMoveUci.length >= 4 &&
        (!currentMove || currentMove.uci?.substring(0, 4) !== bestMoveUci.substring(0, 4))) {
      arr.push([
        bestMoveUci.substring(0, 2) as Square,
        bestMoveUci.substring(2, 4) as Square,
        'rgba(201, 162, 74, 0.85)',
      ]);
    }
    return arr;
  }, [currentMove, bestMoveUci]);

  // ---- Modo exploración (variantes libres, no toca review) ----
  const exploreChessRef = useRef<Chess | null>(null);
  const [exploreFen, setExploreFen] = useState<string | null>(null);
  const [exploreMoves, setExploreMoves] = useState<string[]>([]);
  const exploring = exploreFen !== null;
  const reviewFen = fen === 'start' ? new Chess().fen() : fen;

  useEffect(() => {
    setExploreFen(null);
    setExploreMoves([]);
    exploreChessRef.current = null;
  }, [selectedPly]);

  function startExploreFrom(baseFen: string): Chess | null {
    try {
      const c = new Chess(baseFen);
      exploreChessRef.current = c;
      setExploreFen(c.fen());
      setExploreMoves([]);
      return c;
    } catch { return null; }
  }
  function onExploreDrop(from: string, to: string): boolean {
    let c = exploreChessRef.current;
    if (!c) c = startExploreFrom(reviewFen);
    if (!c) return false;
    const before = c.get(from as Square);
    const isPromo = !!before && before.type === 'p' &&
      ((before.color === 'w' && to[1] === '8') || (before.color === 'b' && to[1] === '1'));
    let mv;
    try { mv = c.move({ from, to, promotion: isPromo ? 'q' : undefined }); }
    catch { return false; }
    if (!mv) return false;
    setExploreFen(c.fen());
    setExploreMoves((prev) => [...prev, mv.san]);
    return true;
  }
  function exitExplore() {
    setExploreFen(null);
    setExploreMoves([]);
    exploreChessRef.current = null;
  }
  function undoExplore() {
    const c = exploreChessRef.current;
    if (!c) return;
    c.undo();
    const h = c.history();
    if (h.length === 0) { exitExplore(); return; }
    setExploreFen(c.fen());
    setExploreMoves((prev) => prev.slice(0, -1));
  }

  const myColor: 'w' | 'b' | null = !user || !data
    ? null
    : data.game.white_id === user.id ? 'w'
    : data.game.black_id === user.id ? 'b'
    : null;

  if (!data) {
    return (
      <Centered>
        <div className="card-premium p-8">
          <span className="loader-dots"><span /><span /><span /></span>
        </div>
      </Centered>
    );
  }

  if (!data.analysis || status === 'pending' || (status === 'running' && moves.length === 0)) {
    const cur = data.analysis?.progress_current ?? 0;
    const tot = data.analysis?.progress_total ?? 0;
    const pct = tot > 0 ? Math.min(100, Math.round((cur / tot) * 100)) : 0;
    return (
      <Centered>
        <div className="card-premium p-8 max-w-md w-full text-center">
          <p className="text-[11px] uppercase tracking-[0.2em] text-gold mb-2">
            {status === 'running' ? 'Analizando' : 'En cola'}
          </p>
          <h2 className="font-display text-3xl mb-2">
            {status === 'running' ? 'Stockfish está pensando' : 'Tu partida está esperando'}
          </h2>
          <p className="text-wood-600 text-sm mb-6">
            {status === 'running'
              ? 'Revisando jugada por jugada. La página se actualiza sola.'
              : 'Tu partida será procesada en breve.'}
          </p>
          <div className="w-full h-2 rounded-full bg-wood-100 overflow-hidden ring-1 ring-wood-200/60 shadow-inner">
            <div
              className="h-full transition-[width] duration-500 ease-out"
              style={{
                width: `${pct}%`,
                background: 'linear-gradient(90deg, #c9a24a 0%, #e8c873 50%, #c9a24a 100%)',
                boxShadow: '0 0 12px rgba(232,200,115,0.5)',
              }}
            />
          </div>
          <p className="text-xs text-wood-500 mt-3 tabular-nums">
            {tot > 0 ? `${cur} / ${tot} posiciones · ${pct}%` : 'Preparando…'}
          </p>
          {error && <p className="text-xs text-wood-500 mt-4">{error}</p>}
          <button className="btn-ghost mt-6" onClick={() => router.back()}>Volver</button>
        </div>
      </Centered>
    );
  }

  if (status === 'failed') {
    return (
      <Centered>
        <div className="card-premium p-8 max-w-md text-center">
          <h2 className="font-display text-2xl mb-2">Análisis no disponible</h2>
          <p className="text-wood-600 text-sm mb-6">
            {data.analysis?.error_message || 'No se pudo analizar esta partida.'}
          </p>
          <button className="btn-ghost" onClick={() => router.push('/lobby')}>Ir al lobby</button>
        </div>
      </Centered>
    );
  }

  const isLive = status === 'running';
  const progressCur = data.analysis.progress_current ?? 0;
  const progressTot = data.analysis.progress_total ?? 0;
  const progressPct = progressTot > 0 ? Math.min(100, Math.round((progressCur / progressTot) * 100)) : 0;

  // Explicación humana de la jugada actual (template-based, sin LLM)
  const explanation = currentMove
    ? humanExplanation({
        classification: currentMove.classification,
        cpLoss: currentMove.centipawnLoss,
        color: currentMove.color,
      })
    : null;

  return (
    <section className="flex-1 max-w-7xl mx-auto w-full px-5 py-8">
      <header className="mb-6">
        <p className="text-accent font-medium uppercase tracking-widest text-xs">Análisis</p>
        <h1 className="font-display text-3xl mt-1">
          {data.game.white_username} <span className="text-wood-400 font-normal">vs</span>{' '}
          {data.game.black_username}
        </h1>
        <p className="text-wood-600 text-sm mt-1">
          {data.game.time_control} · resultado {data.game.result || '—'} ·{' '}
          {totalPlies} jugadas
        </p>
      </header>

      {isLive && (
        <div className="mb-5 rounded-xl border border-gold/40 bg-gold/5 px-4 py-3 animate-fadeIn">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-gold animate-ping opacity-60" />
                <span className="relative rounded-full h-2 w-2 bg-gold" />
              </span>
              <span className="text-xs uppercase tracking-[0.18em] text-gold font-medium">En vivo</span>
              <span className="text-xs text-wood-600">Stockfish analizando · clasificación en tiempo real</span>
            </div>
            <span className="text-xs tabular-nums text-wood-700">{progressPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-wood-100 overflow-hidden">
            <div
              className="h-full transition-[width] duration-500 ease-out"
              style={{
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, #c9a24a 0%, #e8c873 50%, #c9a24a 100%)',
                boxShadow: '0 0 8px rgba(232,200,115,0.4)',
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mb-5 text-xs text-wood-600 bg-wood-50 border border-wood-100 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-[auto_1fr_320px] gap-5 items-start">
        {/* Columna izquierda */}
        <div>
          <div className="flex gap-3">
            <EvalBar cp={evalCp} mate={evalMate} height={boardWidth} />
            <div>
              <div className="board-glow my-2">
                <ChessBoard
                  position={exploring ? exploreFen! : (fen === 'start' ? undefined : fen)}
                  arePiecesDraggable={exploring}
                  onPieceDrop={(s: string, t: string) => onExploreDrop(s, t)}
                  boardOrientation={myColor === 'b' ? 'black' : 'white'}
                  boardWidth={boardWidth}
                  customArrows={exploring ? [] : customArrows}
                  customBoardStyle={{
                    borderRadius: '12px',
                    boxShadow: exploring
                      ? '0 12px 40px -12px rgba(201,162,74,0.55)'
                      : '0 12px 40px -12px rgba(58,39,22,0.35)',
                    transition: 'box-shadow 0.3s ease',
                  }}
                  customDarkSquareStyle={{ backgroundColor: '#6e4a26' }}
                  customLightSquareStyle={{ backgroundColor: '#f0dcb5' }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-2">
                {!exploring ? (
                  <button
                    onClick={() => startExploreFrom(reviewFen)}
                    className="px-3 py-1.5 rounded-lg text-xs uppercase tracking-wider border border-gold/40 bg-gold/10 text-wood-800 hover:bg-gold/20 transition-all"
                    style={{ boxShadow: '0 0 14px -6px rgba(201,162,74,0.5)' }}
                  >
                    ✦ Explorar variante
                  </button>
                ) : (
                  <>
                    <span className="text-[11px] uppercase tracking-widest text-gold animate-fadeIn">
                      Modo exploración
                    </span>
                    <button onClick={undoExplore} disabled={exploreMoves.length === 0}
                      className="px-3 py-1.5 rounded-lg text-xs uppercase tracking-wider border border-wood-200 bg-wood-50 text-wood-700 hover:text-ink disabled:opacity-40 transition-all">
                      ↶ Deshacer
                    </button>
                    <button onClick={exitExplore}
                      className="px-3 py-1.5 rounded-lg text-xs uppercase tracking-wider border border-wood-200 bg-wood-50 text-wood-700 hover:text-ink transition-all">
                      ⟲ Volver a la review
                    </button>
                    {exploreMoves.length > 0 && (
                      <span className="text-[11px] text-wood-500 truncate max-w-[200px]">
                        {exploreMoves.join(' ')}
                      </span>
                    )}
                  </>
                )}
              </div>

              <NavBar
                ply={selectedPly}
                total={totalPlies}
                onChange={(p) => { userTouchedNavRef.current = true; setSelectedPly(p); }}
              />
            </div>
          </div>
        </div>

        {/* Columna media: motor + jugada actual con MoveBadge premium */}
        <aside className="space-y-4">
          {currentMove && (
            <div className="card-premium p-5">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-wood-500">
                    Jugada {Math.ceil(currentMove.ply / 2)}{currentMove.color === 'w' ? '.' : '...'}
                  </p>
                  <div className="font-display text-2xl mt-1">{currentMove.san}</div>
                </div>
                <MoveBadge k={currentMove.classification} variant="large" />
              </div>
              {bestMoveSan && bestMoveSan !== currentMove.san && (
                <p className="text-xs text-wood-600 mb-2">
                  Mejor jugada: <span className="font-medium text-ink">{bestMoveSan}</span>
                </p>
              )}
              {explanation && (
                <p className="text-sm text-wood-700 leading-snug italic mt-2 border-l-2 border-gold/40 pl-3">
                  {explanation}
                </p>
              )}
            </div>
          )}

          <div className="card-premium p-5">
            <h3 className="font-display text-lg mb-1">Motor</h3>
            <p className="text-xs text-wood-500 mb-3">
              {data.analysis.engine_name || 'stockfish'} · profundidad {data.analysis.engine_depth ?? '—'}
            </p>
            <EngineLines lines={currentLines} bestMoveSan={bestMoveSan} caption="Líneas principales" />
          </div>
        </aside>

        {/* Columna derecha: lista de jugadas + review summary */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <div className="card-premium p-5">
            <h3 className="font-display text-lg mb-3">Jugadas</h3>
            <div className="max-h-[40vh] lg:max-h-[36vh] overflow-y-auto pr-1">
              <MoveList
                moves={moves}
                selectedPly={selectedPly}
                onSelect={(p: number) => { userTouchedNavRef.current = true; setSelectedPly(p); }}
              />
            </div>
          </div>

          {/* ReviewSummary: timeline + distribución + breakdown por fase + peor error */}
          <ReviewSummary
            moves={reviewMovesForSummary}
            myColor={myColor}
            selectedPly={selectedPly}
            onSelectPly={(p: number) => { userTouchedNavRef.current = true; setSelectedPly(p); }}
          />

          {/* Elo estimado pegado al fondo del panel */}
          <div className="card-premium p-5">
            <div className="text-xs uppercase tracking-wider text-wood-500 mb-2">Elo estimado</div>
            <div className="grid grid-cols-2 gap-3">
              <EloPillEx
                label={data.game.white_username}
                value={data.analysis.elo_white}
                confidence={data.analysis.elo_confidence_white}
                reasons={data.analysis.elo_reasons_white}
              />
              <EloPillEx
                label={data.game.black_username}
                value={data.analysis.elo_black}
                confidence={data.analysis.elo_confidence_black}
                reasons={data.analysis.elo_reasons_black}
              />
            </div>
            <p className="text-[10px] text-wood-500 mt-2 italic">
              Estimación del nivel de juego, no Elo oficial.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

/* ===== sub-components ===== */
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center px-5 py-12">{children}</div>;
}
function NavBar({ ply, total, onChange }: { ply: number; total: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center gap-2 my-3">
      <button onClick={() => onChange(0)}                     className="btn-ghost px-2 py-1 text-sm" title="Inicio">⏮</button>
      <button onClick={() => onChange(Math.max(0, ply-1))}    className="btn-ghost px-2 py-1 text-sm" title="Atrás">◀</button>
      <span className="text-xs tabular-nums text-wood-600 min-w-[60px] text-center">{ply} / {total}</span>
      <button onClick={() => onChange(Math.min(total, ply+1))} className="btn-ghost px-2 py-1 text-sm" title="Adelante">▶</button>
      <button onClick={() => onChange(total)}                  className="btn-ghost px-2 py-1 text-sm" title="Fin">⏭</button>
    </div>
  );
}
function EloPillEx({ label, value, confidence, reasons }: {
  label: string; value: number | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  reasons?: string[] | null;
}) {
  const conf = confidence || 'medium';
  const confLabel = conf === 'high' ? 'Alta' : conf === 'medium' ? 'Media' : 'Baja';
  const confTone = conf === 'high'
    ? 'bg-accent/10 text-accent border-accent/30'
    : conf === 'low' ? 'bg-wood-100 text-wood-700 border-wood-200'
    : 'bg-gold/15 text-wood-700 border-gold/30';
  const reasonsText = reasons && reasons.length > 0
    ? reasons.join(' · ')
    : 'Estimación basada en accuracy global';
  return (
    <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-center cursor-help" title={reasonsText}>
      <div className="text-[10px] uppercase tracking-wider text-wood-500 truncate">{label}</div>
      <div className="font-display text-2xl tabular-nums text-ink">{value ?? '—'}</div>
      <div className={`mt-1 inline-block text-[10px] px-2 py-0.5 rounded border ${confTone}`}>
        Confianza: {confLabel}
      </div>
      {reasons && reasons.length > 0 && (
        <p className="text-[10px] text-wood-600 mt-1.5 leading-snug line-clamp-2">{reasons[0]}</p>
      )}
    </div>
  );
}

export default function AnalysisPage() {
  return (
    <AuthGuard>
      <AnalysisInner />
    </AuthGuard>
  );
}
