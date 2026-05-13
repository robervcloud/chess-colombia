'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Chess } from 'chess.js';
import type { Square } from 'react-chessboard/dist/chessboard/types';

import AuthGuard from '@/components/AuthGuard';
import EvalBar from '@/components/EvalBar';
import MoveList from '@/components/MoveList';
import EngineLines from '@/components/EngineLines';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { GameAnalysis, MoveAnalysis } from '@/types/analysis';

const ChessBoard = dynamic(
  () => import('react-chessboard').then((m) => m.Chessboard),
  { ssr: false }
);

interface ApiResp {
  game: {
    id: string;
    white_id: string | null;
    black_id: string | null;
    white_username: string;
    black_username: string;
    result: string | null;
    pgn: string | null;
    fen: string | null;
    status: string;
    time_control: string;
    created_at: string;
    ended_at: string | null;
  };
  analysis: GameAnalysis | null;
}

const POLL_MS_RUNNING = 1500;   // status='running' → polling rápido
const POLL_MS_PENDING = 3000;   // status='pending' → más espaciado
const STAGNATION_ATTEMPTS = 60; // sin avance en 60 intentos → asumir colgado

function AnalysisInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const gameId = params?.id as string;
  const { user } = useAuth();

  const [data, setData] = useState<ApiResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPly, setSelectedPly] = useState(0);
  // Cuando hay streaming, si el usuario aún no navegó (sigue en 0)
  // dejamos selectedPly al final del parcial para que vea la última jugada.
  // Si ya tocó la NavBar, respetamos su selección.
  const userTouchedNavRef = useRef(false);
  // Tab activo en pantallas chicas (< lg). En lg+ se ignora.
  const [mobileTab, setMobileTab] = useState<'board' | 'moves' | 'summary'>('board');
  const pollRef = useRef<number | null>(null);

  // ---- Carga + polling adaptativo ----
  // Estrategia anti-cuelgue:
  //  - Si status==='running' polleamos rápido (1.5s).
  //  - Si current_progress sube, reseteamos contador (siempre hay vida).
  //  - Si no sube en STAGNATION_ATTEMPTS rondas seguidas → mostramos
  //    aviso pero seguimos intentando con backoff de 5s.
  // Esto soluciona el "tengo que refrescar manual" en partidas largas:
  // mientras el worker avance, no nos rendimos.
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
          if (pollRef.current) {
            window.clearTimeout(pollRef.current);
            pollRef.current = null;
          }
          return;
        }

        if (current > lastProgress) {
          lastProgress = current;
          stagnant = 0;
          setError(null);
        } else {
          stagnant++;
        }

        let nextDelay = status === 'running' ? POLL_MS_RUNNING : POLL_MS_PENDING;
        if (stagnant >= STAGNATION_ATTEMPTS) {
          // No avanza hace rato; bajamos cadencia y avisamos suave
          nextDelay = 5000;
          setError('El análisis está tardando más de lo normal. Seguimos intentando…');
        }
        pollRef.current = window.setTimeout(load, nextDelay);
      } catch (e: any) {
        if (cancelled) return;
        // Errores transitorios: NO matar el polling, reintentar con backoff
        pollRef.current = window.setTimeout(load, 5000);
        setError(e?.message || 'Error temporal al cargar; reintentando…');
      }
    }
    load();
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [gameId]);

  // ---- Análisis temporal: borrar al salir de la página ----
  // Doble vía: (1) DELETE async al desmontar React, (2) sendBeacon
  // si el usuario cierra/recarga la pestaña. El TTL del worker es la
  // red de seguridad si algo falla.
  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
    const token = typeof window !== 'undefined' ? localStorage.getItem('chess_co_token') : null;
    const url = `${apiBase}/api/games/${gameId}/analysis`;

    function beforeUnload() {
      if (!token) return;
      // sendBeacon no permite headers; usamos fetch keepalive con DELETE
      try {
        fetch(url, {
          method: 'DELETE',
          keepalive: true,
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      } catch { /* noop */ }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      // Desmontaje normal (navegación SPA): DELETE async, sin esperar
      if (token) {
        fetch(url, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    };
  }, [gameId]);

  const moves: MoveAnalysis[] = data?.analysis?.moves_analysis || [];
  const totalPlies = moves.length;

  // Auto-follow: si estamos en streaming y el usuario aún no navegó,
  // movemos selectedPly al final del parcial para mostrar lo más nuevo.
  // También clamp defensivo: jamás permitir selectedPly fuera de rango.
  useEffect(() => {
    if (selectedPly > totalPlies) {
      setSelectedPly(totalPlies);
      return;
    }
    const isStreaming = data?.analysis?.status === 'running';
    if (isStreaming && !userTouchedNavRef.current && totalPlies > 0) {
      setSelectedPly(totalPlies);
    }
  }, [totalPlies, data?.analysis?.status, selectedPly]);

  // FEN + datos del ply seleccionado
  const { fen, currentMove, evalCp, evalMate, currentLines, bestMoveSan, bestMoveUci } = useMemo(() => {
    if (selectedPly === 0) {
      return {
        fen: 'start',
        currentMove: null as MoveAnalysis | null,
        evalCp: 0,
        evalMate: null as number | null,
        currentLines: moves[0]?.lines || [],
        bestMoveSan: moves[0]?.bestMoveSan || null,
        bestMoveUci: moves[0]?.bestMoveUci || null,
      };
    }
    const m = moves[selectedPly - 1];
    if (!m) {
      return {
        fen: 'start',
        currentMove: null,
        evalCp: 0,
        evalMate: null,
        currentLines: [],
        bestMoveSan: null,
        bestMoveUci: null,
      };
    }
    // Para una posición ya jugada: la "mejor jugada sugerida" se calcula
    // sobre fenBefore, así que la flecha apunta a lo que debería haber jugado.
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

  // Flechas para el tablero. Mostramos:
  //  - la jugada real (más sutil, color cálido)
  //  - la jugada óptima sugerida (dorado, más viva) — sólo si fue subóptima
  const customArrows = useMemo<Array<[Square, Square, string]>>(() => {
    const arr: Array<[Square, Square, string]> = [];
    if (currentMove && currentMove.uci && currentMove.uci.length >= 4) {
      const isOk = currentMove.classification === 'best' || currentMove.classification === 'excellent';
      arr.push([
        currentMove.uci.substring(0, 2) as Square,
        currentMove.uci.substring(2, 4) as Square,
        isOk ? 'rgba(58,160,120,0.55)' : 'rgba(160,90,70,0.55)',
      ]);
    }
    // Flecha dorada con la mejor sugerencia (si difiere de la real)
    if (bestMoveUci && bestMoveUci.length >= 4 && (!currentMove || currentMove.uci?.substring(0,4) !== bestMoveUci.substring(0,4))) {
      arr.push([
        bestMoveUci.substring(0, 2) as Square,
        bestMoveUci.substring(2, 4) as Square,
        'rgba(201, 162, 74, 0.85)',
      ]);
    }
    return arr;
  }, [currentMove, bestMoveUci]);

  // Orientación (te ponemos abajo)
  const myColor: 'w' | 'b' = data && user && data.game.black_id === user.id ? 'b' : 'w';

  // Atajos de teclado: ← →
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        userTouchedNavRef.current = true;
        setSelectedPly((p) => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        userTouchedNavRef.current = true;
        setSelectedPly((p) => Math.min(totalPlies, p + 1));
      } else if (e.key === 'Home') {
        userTouchedNavRef.current = true;
        setSelectedPly(0);
      } else if (e.key === 'End') {
        userTouchedNavRef.current = true;
        setSelectedPly(totalPlies);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [totalPlies]);

  const [boardWidth, setBoardWidth] = useState(480);
  useEffect(() => {
    function resize() {
      setBoardWidth(Math.min(window.innerWidth - 40, 520));
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // ---- Render según estado ----
  if (error) {
    return (
      <Centered>
        <div className="card-premium p-6 max-w-md text-center">
          <h2 className="font-display text-2xl mb-2">No se pudo cargar</h2>
          <p className="text-wood-600 text-sm">{error}</p>
        </div>
      </Centered>
    );
  }

  if (!data) {
    return (
      <Centered>
        <span className="loader-dots"><span /><span /><span /></span>
      </Centered>
    );
  }

  const status = data.analysis?.status;

  if (!data.analysis || status === 'pending' || (status === 'running' && (data.analysis.moves_analysis?.length ?? 0) === 0)) {
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

          {/* Progress bar con gradient dorado */}
          <div className="w-full h-2 rounded-full bg-wood-100 overflow-hidden ring-1 ring-wood-200/60 shadow-inner">
            <div
              className="h-full transition-[width] duration-500 ease-out"
              style={{
                width: `${pct}%`,
                background:
                  'linear-gradient(90deg, #c9a24a 0%, #e8c873 50%, #c9a24a 100%)',
                boxShadow: '0 0 12px rgba(232,200,115,0.5)',
              }}
            />
          </div>
          <p className="text-xs text-wood-500 mt-3 tabular-nums">
            {tot > 0 ? `${cur} / ${tot} posiciones · ${pct}%` : 'Preparando…'}
          </p>

          {/* Skeleton dots animados */}
          <div className="flex justify-center gap-1.5 mt-6">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-2 h-2 rounded-full bg-gold/60 animate-pulse"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>

          {error && (
            <p className="text-xs text-wood-500 mt-4">{error}</p>
          )}
        </div>
      </Centered>
    );
  }

  if (status === 'failed') {
    return (
      <Centered>
        <div className="card-premium p-8 max-w-md text-center">
          <h2 className="font-display text-2xl mb-2">El análisis falló</h2>
          <p className="text-wood-600 text-sm mb-4">
            {data.analysis.error_message || 'Error desconocido del worker.'}
          </p>
          <button onClick={() => router.push('/lobby')} className="btn-ghost">
            Volver al lobby
          </button>
        </div>
      </Centered>
    );
  }

  // status === 'done' o 'running' con parcial
  const isLive = status === 'running';
  const partialMoves = data.analysis.moves_analysis || [];
  const summary = data.analysis.summary || computeQuickSummary(partialMoves);
  const eloW = data.analysis.elo_white;
  const eloB = data.analysis.elo_black;
  const progressCur = data.analysis.progress_current ?? 0;
  const progressTot = data.analysis.progress_total ?? 0;
  const progressPct = progressTot > 0 ? Math.min(100, Math.round((progressCur / progressTot) * 100)) : 0;

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
          {summary.totalPlies} jugadas{!isLive && summary.truncated && ' (truncado)'}
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
              <span className="text-xs uppercase tracking-[0.18em] text-gold font-medium">
                En vivo
              </span>
              <span className="text-xs text-wood-600">
                Stockfish analizando · puedes navegar las jugadas ya procesadas
              </span>
            </div>
            <span className="text-xs tabular-nums text-wood-700">
              {progressPct}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-wood-100 overflow-hidden ring-1 ring-wood-200/50">
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

      {/* Tab bar para pantallas < lg. En lg+ está oculta y se ven los 3 paneles. */}
      <div className="lg:hidden mb-4 sticky top-0 z-10 bg-parch/95 backdrop-blur-sm -mx-5 px-5 py-2 border-b border-wood-100">
        <div className="flex gap-1 rounded-md bg-wood-50 p-1 ring-1 ring-wood-100">
          {([
            ['board', 'Tablero'],
            ['moves', 'Jugadas'],
            ['summary', 'Resumen'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className={[
                'flex-1 py-1.5 text-xs uppercase tracking-wider rounded transition-colors',
                mobileTab === key
                  ? 'bg-parch text-ink shadow-sm font-medium'
                  : 'text-wood-600 hover:text-ink',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[auto_1fr_320px] gap-5 items-start">
        {/* Columna izquierda: barra de eval + tablero
            (visible siempre en lg; en mobile sólo si tab === 'board') */}
        <div className={`${mobileTab === 'board' ? 'block' : 'hidden'} lg:block`}>
        <div className="flex gap-3">
          <EvalBar cp={evalCp} mate={evalMate} height={boardWidth} />
          <div>
            <PlayerHeader
              name={myColor === 'w' ? data.game.black_username : data.game.white_username}
              elo={myColor === 'w' ? eloB : eloW}
              accuracy={myColor === 'w' ? summary.accuracyBlack : summary.accuracyWhite}
            />
            <div className="my-2">
              <ChessBoard
                position={fen === 'start' ? undefined : fen}
                arePiecesDraggable={false}
                boardOrientation={myColor === 'b' ? 'black' : 'white'}
                boardWidth={boardWidth}
                customArrows={customArrows}
                customBoardStyle={{
                  borderRadius: '12px',
                  boxShadow: '0 12px 40px -12px rgba(58,39,22,0.35)',
                }}
                customDarkSquareStyle={{ backgroundColor: '#6e4a26' }}
                customLightSquareStyle={{ backgroundColor: '#f0dcb5' }}
              />
            </div>
            <PlayerHeader
              name={myColor === 'w' ? data.game.white_username : data.game.black_username}
              elo={myColor === 'w' ? eloW : eloB}
              accuracy={myColor === 'w' ? summary.accuracyWhite : summary.accuracyBlack}
            />
            <NavBar
              ply={selectedPly}
              total={totalPlies}
              onChange={(p) => { userTouchedNavRef.current = true; setSelectedPly(p); }}
            />
          </div>
        </div>
        </div>

        {/* Columna media: motor (visible en lg, o en mobile cuando tab='moves') */}
        <aside className={`${mobileTab === 'moves' ? 'block' : 'hidden'} lg:block card-premium p-5 w-full`}>
          <h3 className="font-display text-lg mb-1">Motor</h3>
          <p className="text-xs text-wood-500 mb-3">
            {data.analysis.engine_name || 'stockfish'} · profundidad {data.analysis.engine_depth ?? '—'}
          </p>

          {currentMove && (
            <div className="mb-4 p-3 rounded-md border border-wood-100 bg-wood-50">
              <div className="text-xs text-wood-500 uppercase tracking-wider">
                Jugada {Math.ceil(currentMove.ply / 2)}{currentMove.color === 'w' ? '.' : '...'}
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-display text-2xl">{currentMove.san}</span>
                <ClassBadge k={currentMove.classification} />
              </div>
              <div className="text-xs text-wood-600 mt-2">
                {currentMove.classification !== 'best' && currentMove.bestMoveSan && (
                  <>Mejor: <span className="font-semibold text-ink">{currentMove.bestMoveSan}</span></>
                )}
                {currentMove.centipawnLoss > 0 && (
                  <span className="ml-2 text-wood-500">
                    (−{(currentMove.centipawnLoss / 100).toFixed(2)})
                  </span>
                )}
                {currentMove.isMateDetected && (
                  <span className="ml-2 text-accent font-semibold">Mate forzado</span>
                )}
              </div>
            </div>
          )}

          <EngineLines
            lines={currentLines}
            bestMoveSan={bestMoveSan}
            caption={selectedPly === 0 ? 'Posición inicial' : 'Mejores continuaciones'}
          />
        </aside>

        {/* Columna derecha: jugadas + resumen.
            En desktop (lg) sticky para mantenerse visible.
            En mobile dividida: jugadas → tab 'moves' (junto al motor), resumen → tab 'summary'. */}
        <aside className={`${mobileTab === 'summary' ? 'block' : 'hidden'} lg:block card-premium p-5 w-full lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto`}>
          <h3 className="font-display text-lg mb-3">Jugadas</h3>
          <div className="max-h-[40vh] lg:max-h-[36vh] overflow-y-auto pr-1">
            <MoveList moves={moves} selectedPly={selectedPly} onSelect={(p) => { userTouchedNavRef.current = true; setSelectedPly(p); }} />
          </div>

          <div className="divider-gold my-5" />

          <h3 className="font-display text-lg mb-3">Resumen</h3>
          <SummaryRow label="Precisión" wVal={fmtPct(summary.accuracyWhite)} bVal={fmtPct(summary.accuracyBlack)} />
          <SummaryRow label="Mejores" wVal={summary.bestMovesWhite} bVal={summary.bestMovesBlack} />
          <SummaryRow label="Imprecisiones" wVal={summary.inaccuraciesWhite} bVal={summary.inaccuraciesBlack} />
          <SummaryRow label="Errores" wVal={summary.mistakesWhite} bVal={summary.mistakesBlack} />
          <SummaryRow label="Blunders" wVal={summary.blundersWhite} bVal={summary.blundersBlack} klass="text-danger" />

          <div className="divider-gold my-5" />

          <div className="text-xs uppercase tracking-wider text-wood-500 mb-2">
            Elo estimado
          </div>
          <div className="grid grid-cols-2 gap-3">
            <EloPillEx
              label={data.game.white_username}
              value={eloW}
              confidence={data.analysis.elo_confidence_white}
              reasons={data.analysis.elo_reasons_white}
            />
            <EloPillEx
              label={data.game.black_username}
              value={eloB}
              confidence={data.analysis.elo_confidence_black}
              reasons={data.analysis.elo_reasons_black}
            />
          </div>
          <p className="text-[10px] text-wood-500 mt-2 italic">
            Estimación de nivel de juego, no Elo oficial.
          </p>
        </aside>
      </div>
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center px-5 py-12">{children}</div>;
}

function PlayerHeader({
  name,
  elo,
  accuracy,
}: {
  name: string;
  elo: number | null;
  accuracy: number | null;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm py-1">
      <span className="font-medium truncate">{name}</span>
      <span className="text-wood-500">
        {accuracy !== null && <>{accuracy}% · </>}
        {elo !== null && `~${elo}`}
      </span>
    </div>
  );
}

function NavBar({
  ply,
  total,
  onChange,
}: {
  ply: number;
  total: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mt-3 px-1">
      <button onClick={() => onChange(0)} className="btn-ghost py-1 px-2 text-xs">⏮</button>
      <button onClick={() => onChange(Math.max(0, ply - 1))} className="btn-ghost py-1 px-2 text-xs">◀</button>
      <span className="flex-1 text-center text-xs text-wood-500 tabular-nums">
        {ply} / {total}
      </span>
      <button onClick={() => onChange(Math.min(total, ply + 1))} className="btn-ghost py-1 px-2 text-xs">▶</button>
      <button onClick={() => onChange(total)} className="btn-ghost py-1 px-2 text-xs">⏭</button>
    </div>
  );
}

function ClassBadge({ k }: { k: string }) {
  const styles: Record<string, string> = {
    best:        'bg-accent/15 text-accent-dark',
    excellent:   'bg-gold/20 text-gold-dark',
    good:        'bg-wood-100 text-wood-700',
    inaccuracy:  'bg-clay-light/30 text-clay-dark',
    mistake:     'bg-clay/30 text-clay-dark',
    blunder:     'bg-danger/20 text-danger',
  };
  const labels: Record<string, string> = {
    best: 'Mejor',
    excellent: 'Excelente',
    good: 'Buena',
    inaccuracy: 'Imprecisión',
    mistake: 'Error',
    blunder: 'Blunder',
  };
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${styles[k] || ''}`}>
      {labels[k] || k}
    </span>
  );
}

function SummaryRow({
  label,
  wVal,
  bVal,
  klass,
}: {
  label: string;
  wVal: number | string | null;
  bVal: number | string | null;
  klass?: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1 text-sm">
      <span className="text-wood-600">{label}</span>
      <span className={`text-right tabular-nums ${klass || ''}`}>{wVal ?? '—'}</span>
      <span className={`text-right tabular-nums ${klass || ''}`}>{bVal ?? '—'}</span>
    </div>
  );
}

function EloPill({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-wood-500 truncate">{label}</div>
      <div className="font-display text-2xl tabular-nums text-ink">{value ?? '—'}</div>
    </div>
  );
}

/**
 * Variante extendida con confianza + razones.
 *  - confidence: 'high' | 'medium' | 'low'  (afecta intensidad visual)
 *  - reasons: hasta 4 frases cortas que explican la estimación.
 *
 * El tooltip muestra todas las razones; debajo del número, mostramos
 * un chip pequeño con la confianza.
 */
function EloPillEx({
  label,
  value,
  confidence,
  reasons,
}: {
  label: string;
  value: number | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  reasons?: string[] | null;
}) {
  const conf = confidence || 'medium';
  const confLabel = conf === 'high' ? 'Alta' : conf === 'medium' ? 'Media' : 'Baja';
  const confTone =
    conf === 'high' ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : conf === 'low' ? 'bg-wood-100 text-wood-700 border-wood-200'
    : 'bg-gold/15 text-wood-700 border-gold/30';

  const reasonsText = (reasons && reasons.length > 0)
    ? reasons.join(' · ')
    : 'Estimación basada en accuracy global y patrones de errores';

  return (
    <div
      className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-center cursor-help"
      title={reasonsText}
    >
      <div className="text-[10px] uppercase tracking-wider text-wood-500 truncate">{label}</div>
      <div className="font-display text-2xl tabular-nums text-ink">{value ?? '—'}</div>
      <div className={`mt-1 inline-block text-[10px] px-2 py-0.5 rounded border ${confTone}`}>
        Confianza: {confLabel}
      </div>
      {reasons && reasons.length > 0 && (
        <p className="text-[10px] text-wood-600 mt-1.5 leading-snug line-clamp-2">
          {reasons[0]}
        </p>
      )}
    </div>
  );
}

function fmtPct(v: number | null) {
  return v === null ? null : `${v}%`;
}

/** Resumen mínimo derivado del array parcial; usado mientras status==='running'. */
function computeQuickSummary(moves: any[]): any {
  const w = moves.filter((m) => m.color === 'w');
  const b = moves.filter((m) => m.color === 'b');
  const countCls = (arr: any[], c: string) => arr.filter((x) => x.classification === c).length;
  return {
    accuracyWhite: null,
    accuracyBlack: null,
    blundersWhite: countCls(w, 'blunder'),
    blundersBlack: countCls(b, 'blunder'),
    mistakesWhite: countCls(w, 'mistake'),
    mistakesBlack: countCls(b, 'mistake'),
    inaccuraciesWhite: countCls(w, 'inaccuracy'),
    inaccuraciesBlack: countCls(b, 'inaccuracy'),
    bestMovesWhite: countCls(w, 'best'),
    bestMovesBlack: countCls(b, 'best'),
    totalPlies: moves.length,
    truncated: false,
  };
}

export default function AnalysisPage() {
  return (
    <AuthGuard>
      <AnalysisInner />
    </AuthGuard>
  );
}
