'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Chess } from 'chess.js';

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

const POLL_MS = 4000;
const MAX_POLL_ATTEMPTS = 45; // 45 * 4s = 3 minutos. Tras esto, dejamos de polear.

function AnalysisInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const gameId = params?.id as string;
  const { user } = useAuth();

  const [data, setData] = useState<ApiResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPly, setSelectedPly] = useState(0);
  const pollRef = useRef<number | null>(null);

  // ---- Carga + polling cuando aún no está done ----
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    async function load() {
      try {
        const resp = await api<ApiResp>(`/api/games/${gameId}/analysis`);
        if (cancelled) return;
        setData(resp);
        const status = resp.analysis?.status;
        if (status === 'done' || status === 'failed') {
          if (pollRef.current) {
            window.clearTimeout(pollRef.current);
            pollRef.current = null;
          }
        } else if (attempts >= MAX_POLL_ATTEMPTS) {
          // P1-3: tope de polling. Si tras 3 min no se completó, paramos
          // y avisamos. El usuario puede recargar para reintentar.
          setError(
            'El análisis está tardando más de lo normal. Recarga la página para reintentar.'
          );
        } else {
          attempts++;
          pollRef.current = window.setTimeout(load, POLL_MS);
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'No se pudo cargar el análisis');
      }
    }
    load();
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [gameId]);

  const moves: MoveAnalysis[] = data?.analysis?.moves_analysis || [];
  const totalPlies = moves.length;

  // FEN + datos del ply seleccionado
  const { fen, currentMove, evalCp, evalMate, currentLines, bestMoveSan } = useMemo(() => {
    if (selectedPly === 0) {
      return {
        fen: 'start',
        currentMove: null as MoveAnalysis | null,
        evalCp: 0,
        evalMate: null as number | null,
        currentLines: moves[0]?.lines || [],
        bestMoveSan: moves[0]?.bestMoveSan || null,
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
      };
    }
    return {
      fen: m.fenAfter,
      currentMove: m,
      evalCp: m.evalAfter,
      evalMate: m.mateAfter,
      currentLines: m.lines || [],
      bestMoveSan: m.bestMoveSan || null,
    };
  }, [moves, selectedPly]);

  // Orientación (te ponemos abajo)
  const myColor: 'w' | 'b' = data && user && data.game.black_id === user.id ? 'b' : 'w';

  // Atajos de teclado: ← →
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedPly((p) => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedPly((p) => Math.min(totalPlies, p + 1));
      } else if (e.key === 'Home') {
        setSelectedPly(0);
      } else if (e.key === 'End') {
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

  if (!data.analysis || status === 'pending' || status === 'running') {
    return (
      <Centered>
        <div className="card-premium p-8 max-w-md text-center">
          <h2 className="font-display text-3xl mb-2">Analizando tu partida</h2>
          <p className="text-wood-600 mb-6">
            Stockfish está revisando cada jugada. Esto suele tardar entre 10 y 30 segundos.
          </p>
          <span className="loader-dots mb-2"><span /><span /><span /></span>
          <p className="text-xs text-wood-500 mt-4">
            La página se actualiza sola cuando el análisis termine.
          </p>
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

  // status === 'done'
  const summary = data.analysis.summary!;
  const eloW = data.analysis.elo_white;
  const eloB = data.analysis.elo_black;

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
          {summary.totalPlies} jugadas
          {summary.truncated && ' (truncado)'}
        </p>
      </header>

      <div className="grid lg:grid-cols-[auto_1fr_320px] gap-5 items-start">
        {/* Columna izquierda: barra de eval + tablero */}
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
              onChange={setSelectedPly}
            />
          </div>
        </div>

        {/* Columna media: motor */}
        <aside className="card-premium p-5 w-full">
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

        {/* Columna derecha: jugadas + resumen */}
        <aside className="card-premium p-5 w-full">
          <h3 className="font-display text-lg mb-3">Jugadas</h3>
          <MoveList moves={moves} selectedPly={selectedPly} onSelect={setSelectedPly} />

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
            <EloPill label={data.game.white_username} value={eloW} />
            <EloPill label={data.game.black_username} value={eloB} />
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

function fmtPct(v: number | null) {
  return v === null ? null : `${v}%`;
}

export default function AnalysisPage() {
  return (
    <AuthGuard>
      <AnalysisInner />
    </AuthGuard>
  );
}
