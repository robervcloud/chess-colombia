'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Chess } from 'chess.js';
import AuthGuard from '@/components/AuthGuard';
import { useGame } from '@/hooks/useGame';
import { detectOpening } from '@/lib/openings';
import { getSocket } from '@/lib/socket';
import Clock from '@/components/Clock';
import type { RatingUpdate } from '@/hooks/useGame';

// react-chessboard usa APIs del DOM; lo cargamos solo en cliente
const ChessBoardView = dynamic(() => import('@/components/ChessBoard'), { ssr: false });

function GameInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const gameId = params?.id as string;

  const {
    ready,
    notFound,
    fen,
    pgn,
    turn,
    myColor,
    white,
    black,
    isMyTurn,
    endResult,
    ratingUpdate,
    opponentDisconnected,
    errorMsg,
    whiteMs,
    blackMs,
    clockBaseAt,
    makeMove,
    resign,
  } = useGame(gameId);

  // Objetivo 2: detección de apertura desde el PGN. Sólo recalcula
  // cuando cambia el pgn (no en cada render/tick de reloj). chess.js
  // parsea el PGN y extrae los SAN; detectOpening hace lookup O(plies).
  const opening = useMemo(() => {
    if (!pgn) return { info: null, outOfBook: false };
    try {
      const c = new Chess();
      c.loadPgn(pgn);
      const san = c.history();
      if (san.length === 0) return { info: null, outOfBook: false };
      return detectOpening(san);
    } catch {
      return { info: null, outOfBook: false };
    }
  }, [pgn]);

  //upadte frontend Vercel
  // Aseguramos que el socket esté conectado al entrar
  useEffect(() => {
    getSocket();
  }, []);

  // Si el server confirma que no hay partida activa para este usuario,
  // volver al lobby en vez de quedarse cargando indefinidamente.
  useEffect(() => {
    if (notFound) router.replace('/lobby');
  }, [notFound, router]);

  const [boardWidth, setBoardWidth] = useState(480);
  useEffect(() => {
    function update() {
      const w = Math.min(window.innerWidth - 40, 560);
      setBoardWidth(w);
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (notFound) {
    return (
      <div className="flex-1 flex items-center justify-center text-wood-600">
        Esta partida ya no está disponible. Volviendo al lobby…
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex-1 flex items-center justify-center text-wood-600">
        Cargando partida…
      </div>
    );
  }

  const opponent = myColor === 'w' ? black : white;
  const me = myColor === 'w' ? white : black;

  return (
    <section className="flex-1 max-w-6xl mx-auto w-full px-5 py-8">
      <div className="grid lg:grid-cols-[1fr_320px] gap-8 items-start">
        {/* Columna izquierda: tablero */}
        <div className="flex flex-col items-center">
          {/* rival arriba */}
          <PlayerBar
            name={opponent?.username || '...'}
            color={myColor === 'w' ? 'b' : 'w'}
            isTurn={!isMyTurn && !endResult}
            disconnected={opponentDisconnected}
            baseMs={myColor === 'w' ? blackMs : whiteMs}
            baseAt={clockBaseAt}
            frozen={!!endResult}
          />

          <div className="my-3">
            {opening.info && (
              <div className="mb-2 flex items-center justify-center gap-2 animate-fadeIn">
                <span className="text-[10px] uppercase tracking-widest text-wood-400 tabular-nums">
                  {opening.info.eco}
                </span>
                <span className="text-sm font-medium text-wood-700">
                  {opening.info.name}
                </span>
                {opening.outOfBook && (
                  <span className="text-[10px] uppercase tracking-wider text-wood-400 italic">
                    · fuera de teoría
                  </span>
                )}
              </div>
            )}
            <ChessBoardView
              fen={fen}
              myColor={myColor}
              draggable={isMyTurn && !endResult}
              onMove={makeMove}
              boardWidth={boardWidth}
            />
          </div>

          {/* yo abajo */}
          <PlayerBar
            name={me?.username || 'Tú'}
            color={myColor || 'w'}
            isTurn={isMyTurn}
            disconnected={false}
            baseMs={myColor === 'w' ? whiteMs : blackMs}
            baseAt={clockBaseAt}
            frozen={!!endResult}
          />

          {errorMsg && (
            <div className="mt-3 text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Columna derecha: info */}
        <aside className="card p-6 w-full">
          <h2 className="font-display text-xl mb-1">Partida</h2>
          <p className="text-xs text-wood-600 break-all mb-4">#{gameId.slice(0, 8)}</p>

          <div className="text-sm space-y-2 mb-6">
            <Row label="Tu color" value={myColor === 'w' ? 'Blancas' : myColor === 'b' ? 'Negras' : '—'} />
            <Row label="Turno" value={turn === 'w' ? 'Blancas' : 'Negras'} />
            <Row
              label="Estado"
              value={
                endResult
                  ? endResult.result === '1/2-1/2'
                    ? 'Tablas'
                    : endResult.result === (myColor === 'w' ? '1-0' : '0-1')
                    ? '¡Ganaste!'
                    : 'Perdiste'
                  : 'En curso'
              }
            />
            {endResult?.termination && (
              <Row label="Por" value={translateTermination(endResult.termination)} />
            )}
          </div>

          {endResult && ratingUpdate && (
            <RatingDelta ru={ratingUpdate} myColor={myColor} />
          )}

          {!endResult ? (
            <button
              className="btn-danger w-full"
              onClick={async () => {
                if (confirm('¿Seguro que deseas rendirte?')) await resign();
              }}
            >
              Rendirse
            </button>
          ) : (
            <div className="space-y-2">
              <button
                className="btn-primary w-full"
                onClick={() => router.push(`/game/${gameId}/analysis`)}
              >
                Ver análisis de la partida
              </button>
              <button
                className="btn-ghost w-full"
                onClick={() => router.push('/lobby')}
              >
                Volver al lobby
              </button>
            </div>
          )}

          {pgn && (
            <details className="mt-6 text-xs text-wood-700">
              <summary className="cursor-pointer font-medium">Ver PGN</summary>
              <pre className="whitespace-pre-wrap break-all mt-2 bg-wood-50 p-3 rounded-md font-mono text-[11px]">
                {pgn}
              </pre>
            </details>
          )}
        </aside>
      </div>
    </section>
  );
}

function PlayerBar({
  name,
  color,
  isTurn,
  disconnected,
  baseMs,
  baseAt,
  frozen,
}: {
  name: string;
  color: 'w' | 'b';
  isTurn: boolean;
  disconnected: boolean;
  baseMs: number;
  baseAt: number;
  frozen: boolean;
}) {
  return (
    <div
      className={[
        'w-full max-w-[560px] flex items-center justify-between gap-3',
        'px-4 py-2.5 rounded-lg transition-colors duration-200',
        isTurn
          ? 'bg-gradient-to-r from-wood-800 to-wood-600 text-parch shadow-soft'
          : 'bg-white border border-wood-100',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-xl ${isTurn ? 'text-gold-light' : 'text-wood-600'}`}>
          {color === 'w' ? '♔' : '♚'}
        </span>
        <span className="font-medium truncate">{name}</span>
        {disconnected && (
          <span className="text-xs opacity-80">(desconectado)</span>
        )}
      </div>
      <Clock baseMs={baseMs} baseAt={baseAt} active={isTurn} frozen={frozen} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-wood-50 pb-1.5">
      <span className="text-wood-600">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * Tarjeta de cambio de rating post-partida. Elige el lado correcto
 * comparando myColor con white/black del payload. Anima el número
 * desde `old` hasta `new` y aplica glow cálido (verde sube / rojo baja).
 */
function RatingDelta({ ru, myColor }: { ru: RatingUpdate; myColor: 'w' | 'b' | null }) {
  const side = myColor === 'b' ? ru.black : ru.white;
  const [shown, setShown] = useState<number>(side?.old ?? 0);

  useEffect(() => {
    if (!side) return;
    const from = side.old;
    const to = side.new;
    const dur = 900;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setShown(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [side]);

  if (!side) return null;
  const up = side.delta >= 0;
  const deltaTxt = `${up ? '+' : ''}${side.delta}`;

  return (
    <div
      className="mb-5 rounded-xl px-4 py-3 text-center border animate-fadeIn"
      style={{
        borderColor: up ? 'rgba(58,160,120,0.4)' : 'rgba(180,80,70,0.4)',
        background: up ? 'rgba(58,160,120,0.06)' : 'rgba(180,80,70,0.06)',
        boxShadow: up
          ? '0 0 22px -8px rgba(58,160,120,0.5)'
          : '0 0 22px -8px rgba(180,80,70,0.45)',
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-wood-500 mb-1">
        Rating {ru.mode}
        {side.provisional && <span className="ml-1 text-gold">· provisional</span>}
      </div>
      <div className="flex items-baseline justify-center gap-2">
        <span className="font-display text-3xl tabular-nums text-ink">{shown}</span>
        <span
          className="font-display text-lg tabular-nums"
          style={{ color: up ? '#2f9d6e' : '#b4564a' }}
        >
          {deltaTxt}
        </span>
      </div>
    </div>
  );
}

function translateTermination(t: string) {
  const map: Record<string, string> = {
    checkmate: 'Jaque mate',
    stalemate: 'Ahogado',
    threefold: 'Triple repetición',
    insufficient_material: 'Material insuficiente',
    draw: 'Tablas',
    resignation: 'Rendición',
    timeout: 'Tiempo agotado',
    abandonment: 'Abandono',
  };
  return map[t] || t;
}

export default function GamePage() {
  return (
    <AuthGuard>
      <GameInner />
    </AuthGuard>
  );
}
