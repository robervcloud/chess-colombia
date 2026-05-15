'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Chess } from 'chess.js';
import AuthGuard from '@/components/AuthGuard';
import { api } from '@/lib/api';
import type { TacticsPuzzle, TacticsStats, AttemptResult } from '@/types/tactics';

// Reusamos react-chessboard como en la página de análisis
const Chessboard = dynamic(
  () => import('react-chessboard').then((m) => m.Chessboard),
  { ssr: false }
);

type Square = `${'a'|'b'|'c'|'d'|'e'|'f'|'g'|'h'}${'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'}`;

/* ---- Estado del puzzle activo ---- */
type Phase = 'loading' | 'playing' | 'success' | 'fail' | 'empty';

export default function TacticsPage() {
  return (
    <AuthGuard>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const [puzzle, setPuzzle] = useState<TacticsPuzzle | null>(null);
  const [stats, setStats] = useState<TacticsStats | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AttemptResult | null>(null);

  // Estado del tablero
  const chessRef = useRef<Chess>(new Chess());
  const [fen, setFen] = useState<string>('start');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [solutionIdx, setSolutionIdx] = useState(0);    // índice en solution[]
  const [arrows, setArrows] = useState<Array<[Square, Square, string]>>([]);
  const [highlight, setHighlight] = useState<Record<string, React.CSSProperties>>({});
  const startTimeRef = useRef<number>(0);
  const submittedRef = useRef(false);

  /* ---------- Cargar stats al montar ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ stats: TacticsStats }>('/api/tactics/stats');
        if (!cancelled) setStats(r.stats);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'No se pudo cargar stats');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------- Cargar puzzle ---------- */
  const loadNext = useCallback(async () => {
    setPhase('loading');
    setHintsUsed(0);
    setFeedback(null);
    setLastResult(null);
    setArrows([]);
    setHighlight({});
    setSolutionIdx(0);
    submittedRef.current = false;
    try {
      const r = await api<{ puzzle: TacticsPuzzle }>('/api/tactics/next');
      const p = r.puzzle;
      setPuzzle(p);

      // Inicializar tablero desde FEN, aplicar setupMove (movida del rival)
      const c = new Chess(p.fen);
      if (p.setupMove && p.setupMove.length >= 4) {
        const from = p.setupMove.substring(0, 2);
        const to = p.setupMove.substring(2, 4);
        const promo = p.setupMove.length > 4 ? p.setupMove.substring(4, 5) : undefined;
        try { c.move({ from, to, promotion: promo as any }); } catch { /* fen ya correcto */ }
        // Flecha animada del setup move (informativa)
        setArrows([[from as Square, to as Square, 'rgba(160,140,90,0.55)']]);
        setTimeout(() => setArrows([]), 900);
      }
      chessRef.current = c;
      setFen(c.fen());
      // Orientación: el jugador es quien debe mover ahora
      setOrientation(c.turn() === 'w' ? 'white' : 'black');
      startTimeRef.current = Date.now();
      setPhase('playing');
    } catch (e: any) {
      if (e?.status === 404) setPhase('empty');
      else setError(e?.message || 'No se pudo cargar puzzle');
      setPhase('empty');
    }
  }, []);

  useEffect(() => { loadNext(); }, [loadNext]);

  /* ---------- Lógica al soltar pieza ---------- */
  function onDrop(sourceSquare: string, targetSquare: string, _piece: string): boolean {
    if (phase !== 'playing' || !puzzle) return false;

    // Detectar promoción mirando la pieza REAL en chess.js (no `piece` de
    // react-chessboard, que cambia de "wP" a "wQ" después del diálogo
    // interno y rompe la detección por string).
    const before = chessRef.current.get(sourceSquare as Square);
    const isPawnPromotion = !!before
      && before.type === 'p'
      && ((before.color === 'w' && targetSquare[1] === '8') ||
          (before.color === 'b' && targetSquare[1] === '1'));

    const move = (() => {
      try {
        const moveObj: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' } = {
          from: sourceSquare,
          to: targetSquare,
        };
        // MVP: queen-only. Para underpromotions usar onPromotionPieceSelect
        // de react-chessboard (TODO opcional).
        if (isPawnPromotion) moveObj.promotion = 'q';
        return chessRef.current.move(moveObj);
      } catch { return null; }
    })();
    if (!move) return false;

    // Construir UCI usando el campo `promotion` del MOVE OBJECT (autoridad
    // de chess.js), no la variable local. Así si más adelante soportamos
    // underpromotions, sólo hay que cambiar dónde se pide la pieza.
    const expected = puzzle.solution[solutionIdx];
    const playedUci = `${sourceSquare}${targetSquare}${move.promotion || ''}`;
    const ok = !!expected && playedUci.toLowerCase() === expected.toLowerCase();

    if (!ok) {
      // Feedback de error
      chessRef.current.undo();
      flashSquare(targetSquare, 'rgba(200,60,60,0.45)');
      setFeedback('No es la mejor jugada. Inténtalo otra vez.');
      setFen(chessRef.current.fen());
      return false; // react-chessboard revertirá visualmente
    }

    // Acierto: aplicar move (ya aplicado en chess) y avanzar
    flashSquare(targetSquare, 'rgba(60,160,120,0.45)');
    setFen(chessRef.current.fen());
    setFeedback(null);

    const nextIdx = solutionIdx + 1;
    // ¿Hay respuesta del rival? Aplicarla automáticamente.
    if (nextIdx < puzzle.solution.length) {
      const reply = puzzle.solution[nextIdx];
      setTimeout(() => {
        if (!reply || reply.length < 4) return;
        try {
          chessRef.current.move({
            from: reply.substring(0, 2),
            to: reply.substring(2, 4),
            promotion: reply.length > 4 ? (reply.substring(4, 5) as any) : undefined,
          });
          setFen(chessRef.current.fen());
        } catch { /* noop */ }
        // ¿Era la última?
        if (nextIdx + 1 >= puzzle.solution.length) {
          finish(true);
        } else {
          setSolutionIdx(nextIdx + 1);
        }
      }, 350);
    } else {
      finish(true);
    }

    return true;
  }

  function flashSquare(sq: string, color: string) {
    setHighlight((prev) => ({ ...prev, [sq]: { background: color } }));
    setTimeout(() => {
      setHighlight((prev) => {
        const n = { ...prev };
        delete n[sq];
        return n;
      });
    }, 450);
  }

  /* ---------- Finalizar (enviar al backend) ---------- */
  async function finish(solved: boolean) {
    if (submittedRef.current || !puzzle) return;
    submittedRef.current = true;
    const timeMs = Date.now() - startTimeRef.current;
    try {
      const r = await api<AttemptResult>('/api/tactics/attempt', {
        method: 'POST',
        body: { puzzleId: puzzle.id, solved, hintsUsed, timeMs },
      });
      setLastResult(r);
      setStats((s) => s ? { ...s, rating: r.newRating, current_streak: r.streak, best_streak: r.bestStreak, solved: r.solved, attempted: r.attempted } : s);
      setPhase(solved ? 'success' : 'fail');
    } catch (e: any) {
      setError(e?.message || 'No se pudo registrar el intento');
    }
  }

  /* ---------- Hints progresivos ---------- */
  function useHint() {
    if (!puzzle || phase !== 'playing') return;
    const expected = puzzle.solution[solutionIdx];
    if (!expected || expected.length < 4) return;
    const from = expected.substring(0, 2) as Square;
    const to = expected.substring(2, 4) as Square;
    const next = Math.min(3, hintsUsed + 1);
    setHintsUsed(next);
    if (next === 1) {
      // Resaltar pieza
      setHighlight((h) => ({ ...h, [from]: { background: 'rgba(232,200,115,0.4)', boxShadow: 'inset 0 0 0 3px rgba(201,162,74,0.7)' } }));
    } else if (next === 2) {
      // Mostrar destino con flecha sutil
      setArrows([[from, to, 'rgba(201, 162, 74, 0.65)']]);
    } else if (next === 3) {
      // Mostrar movimiento completo (más visible)
      setArrows([[from, to, 'rgba(201, 162, 74, 0.95)']]);
    }
  }

  /* ---------- Rendir / saltar ---------- */
  function giveUp() {
    if (!puzzle || phase !== 'playing') return;
    finish(false);
  }

  /* ---------- UI ---------- */
  const myRating = stats?.rating ?? null;

  return (
    <section className="flex-1 max-w-7xl mx-auto w-full px-5 py-8">
      <header className="mb-6">
        <p className="text-accent font-medium uppercase tracking-widest text-xs">Tácticas</p>
        <h1 className="font-display text-3xl mt-1">Entrenamiento</h1>
        <p className="text-wood-600 text-sm mt-1">
          Resuelve puzzles para subir tu rating táctico. La dificultad se ajusta sola.
        </p>
      </header>

      {error && (
        <div className="mb-4 text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        {/* Board column */}
        <div className="card-premium p-5">
          <BoardHeader puzzle={puzzle} phase={phase} hintsUsed={hintsUsed} />

          <div className="flex justify-center my-3">
            <div style={{ width: 'min(560px, 88vw)' }}>
              <Chessboard
                position={fen === 'start' ? undefined : fen}
                onPieceDrop={onDrop as any}
                boardOrientation={orientation}
                arePiecesDraggable={phase === 'playing'}
                customArrows={arrows}
                customSquareStyles={highlight}
                customBoardStyle={{
                  borderRadius: '12px',
                  boxShadow: '0 12px 40px -12px rgba(58,39,22,0.35)',
                }}
                customDarkSquareStyle={{ backgroundColor: '#6e4a26' }}
                customLightSquareStyle={{ backgroundColor: '#f0dcb5' }}
              />
            </div>
          </div>

          <BoardFooter
            phase={phase}
            feedback={feedback}
            lastResult={lastResult}
            puzzle={puzzle}
            hintsUsed={hintsUsed}
            onHint={useHint}
            onGiveUp={giveUp}
            onNext={loadNext}
          />
        </div>

        {/* Stats column */}
        <aside className="card-premium p-5 lg:sticky lg:top-4">
          <StatsPanel stats={stats} currentPuzzleRating={puzzle?.rating ?? null} />
        </aside>
      </div>
    </section>
  );
}

/* ============== Sub-components ============== */

function BoardHeader({ puzzle, phase, hintsUsed }: { puzzle: TacticsPuzzle | null; phase: Phase; hintsUsed: number }) {
  if (!puzzle && phase === 'loading') {
    return (
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-wood-500">Cargando puzzle…</p>
          <div className="h-6 w-32 bg-wood-100 rounded animate-pulse mt-1" />
        </div>
        <div className="h-6 w-16 bg-wood-100 rounded animate-pulse" />
      </div>
    );
  }
  if (!puzzle) return null;
  const sideToMove = phase === 'playing' ? 'Tu turno' : '—';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-gold">{sideToMove}</p>
        <p className="text-xs text-wood-600 mt-0.5 truncate">
          {(puzzle.themes || []).slice(0, 3).join(' · ') || 'Posición de práctica'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {hintsUsed > 0 && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-wood-200 bg-wood-50 text-wood-700">
            Pistas: {hintsUsed}
          </span>
        )}
        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-gold/40 bg-gold/10 text-wood-700 tabular-nums">
          Puzzle ~{puzzle.rating}
        </span>
      </div>
    </div>
  );
}

function BoardFooter({
  phase, feedback, lastResult, puzzle, hintsUsed, onHint, onGiveUp, onNext,
}: {
  phase: Phase;
  feedback: string | null;
  lastResult: AttemptResult | null;
  puzzle: TacticsPuzzle | null;
  hintsUsed: number;
  onHint: () => void;
  onGiveUp: () => void;
  onNext: () => void;
}) {
  if (phase === 'empty') {
    return (
      <div className="text-center py-6">
        <p className="font-display text-lg mb-2">No hay puzzles disponibles</p>
        <p className="text-sm text-wood-600">Importa la base inicial corriendo migration_007_tactics.sql + tactics_seed_starter.sql.</p>
      </div>
    );
  }

  if (phase === 'success' || phase === 'fail') {
    const ok = phase === 'success';
    return (
      <div className={`rounded-lg p-4 ${ok ? 'bg-emerald-50 border border-emerald-200' : 'bg-wood-50 border border-wood-200'}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-display text-xl">
              {ok ? '¡Resuelto!' : 'No esta vez'}
            </p>
            {lastResult && (
              <p className="text-sm text-wood-700 mt-1">
                {lastResult.delta >= 0 ? `+${lastResult.delta}` : lastResult.delta} de rating ·{' '}
                Racha: <span className="font-medium">{lastResult.streak}</span>
                {' · '}Total resueltos: <span className="tabular-nums">{lastResult.solved}</span>
              </p>
            )}
          </div>
          <button onClick={onNext} className="btn-primary">Siguiente</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {feedback && (
        <p className="text-sm text-danger animate-fadeIn">{feedback}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onHint}
          disabled={hintsUsed >= 3 || phase !== 'playing'}
          className="btn-ghost"
          title="Pista progresiva (reduce rating ganado)"
        >
          Pista {hintsUsed > 0 ? `(${hintsUsed}/3)` : ''}
        </button>
        <button onClick={onGiveUp} className="btn-ghost" disabled={phase !== 'playing'}>
          Rendirme
        </button>
      </div>
    </div>
  );
}

function StatsPanel({ stats, currentPuzzleRating }: { stats: TacticsStats | null; currentPuzzleRating: number | null }) {
  if (!stats) {
    return (
      <div>
        <div className="h-4 w-24 bg-wood-100 rounded animate-pulse mb-3" />
        <div className="h-10 bg-wood-100 rounded animate-pulse" />
      </div>
    );
  }
  const accPct = stats.attempted > 0 ? Math.round((stats.solved / stats.attempted) * 100) : 0;
  const themes = Object.entries(stats.by_theme || {});
  const strongest = themes
    .filter(([, v]) => v.attempted >= 3)
    .map(([k, v]) => [k, v.solved / v.attempted] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const weakest = themes
    .filter(([, v]) => v.attempted >= 3)
    .map(([k, v]) => [k, v.solved / v.attempted] as [string, number])
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3);
  const confidence = stats.rd < 100 ? 'Alta' : stats.rd < 200 ? 'Media' : 'Baja';

  return (
    <>
      <div className="text-xs uppercase tracking-widest text-wood-500 mb-2">Tu rating táctico</div>
      <div className="rounded-lg border border-gold/40 bg-gold/5 px-4 py-3 text-center">
        <div className="font-display text-4xl tabular-nums text-ink">{stats.rating}</div>
        <div className="text-[10px] uppercase tracking-wider text-wood-600 mt-1">
          Confianza: {confidence}
          {currentPuzzleRating !== null && (
            <span className="ml-2 text-wood-500">· puzzle: {currentPuzzleRating}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-4">
        <Tile label="Racha"  value={stats.current_streak} accent />
        <Tile label="Mejor"  value={stats.best_streak} />
        <Tile label="Total"  value={stats.solved} />
      </div>
      <Tile label="Precisión global" value={`${accPct}%`} full mt />

      {strongest.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-widest text-wood-500 mb-1">Temas fuertes</p>
          <ThemeList items={strongest} />
        </div>
      )}
      {weakest.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-widest text-wood-500 mb-1">Por mejorar</p>
          <ThemeList items={weakest} />
        </div>
      )}
    </>
  );
}

function Tile({ label, value, accent, full, mt }: { label: string; value: any; accent?: boolean; full?: boolean; mt?: boolean }) {
  return (
    <div className={`${full ? '' : ''} ${mt ? 'mt-2' : ''} rounded-md border ${accent ? 'border-gold/40 bg-gold/5' : 'border-wood-100 bg-wood-50/50'} px-2 py-2 text-center`}>
      <div className="text-[10px] uppercase tracking-wider text-wood-500">{label}</div>
      <div className="font-display text-lg tabular-nums">{value}</div>
    </div>
  );
}

function ThemeList({ items }: { items: Array<[string, number]> }) {
  return (
    <ul className="space-y-1">
      {items.map(([name, pct]) => (
        <li key={name} className="flex items-center justify-between gap-2 text-sm">
          <span className="text-wood-700 capitalize truncate">{name.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
          <span className="tabular-nums text-wood-500 text-xs">{Math.round(pct * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}
