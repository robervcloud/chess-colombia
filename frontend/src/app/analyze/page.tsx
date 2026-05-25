'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Chess } from 'chess.js';

import AuthGuard from '@/components/AuthGuard';
import EvalBar from '@/components/EvalBar';
import { MoveBadge } from '@/components/MoveBadge';
import { ReviewSummary } from '@/components/ReviewSummary';
import { useChessShortcuts } from '@/hooks/useChessShortcuts';
import { detectOpening } from '@/lib/openings';
import {
  classifyMove,
  estimateMaterialSacrificed,
  gamePhase,
  humanExplanation,
  CLASS_META,
  type Classification,
  type Phase,
} from '@/lib/moveClassification';

const Chessboard = dynamic(
  () => import('react-chessboard').then((m) => m.Chessboard),
  { ssr: false }
);

type Square = `${'a'|'b'|'c'|'d'|'e'|'f'|'g'|'h'}${'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'}`;
type Mode = 'free' | 'pgn';

/**
 * Sandbox de análisis universal.
 *
 *  - Modo "free": tablero inicial, el usuario mueve piezas libremente,
 *    Stockfish (WASM cliente) analiza la posición en vivo.
 *  - Modo "pgn":  el usuario pega un PGN, se carga la partida, puede
 *    navegar plies y ver eval/top-moves en cada posición.
 *
 * Ambos modos comparten la misma instancia de motor (un solo Worker).
 */
function AnalyzeInner() {
  const [mode, setMode] = useState<Mode>('free');
  const [pgnInput, setPgnInput] = useState('');
  const [pgnError, setPgnError] = useState<string | null>(null);

  // Historial SAN (común a ambos modos); fen actual derivado de ply.
  const chessRef = useRef(new Chess());
  const [historySan, setHistorySan] = useState<string[]>([]);
  const [ply, setPly] = useState(0);                 // 0 = posición inicial
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');

  // Stockfish state
  const sfRef = useRef<any | null>(null);
  const [sfReady, setSfReady] = useState(false);
  const [sfError, setSfError] = useState<string | null>(null);
  const [lines, setLines] = useState<any[]>([]);   // top N (SfInfo[])
  const [analyzing, setAnalyzing] = useState(false);

  // ---- Estado de REVIEW (loop secuencial sobre el PGN completo) ----
  // Cuando reviewActive===true, deshabilitamos el análisis live para no
  // pisar al loop. Cuando termina o se cancela, vuelve a live.
  interface ReviewMove {
    ply: number;
    san: string;
    color: 'w' | 'b';
    fenAfter: string;
    cp: number | null;     // POV blancas
    mate: number | null;   // POV blancas (mate después de la jugada)
    /** Mate ANTES de la jugada, POV blancas. Para explicaciones humanas. */
    mateBefore?: number | null;
    bestUci: string | null;
    depth: number;
    /** Cp loss POV jugador que movió, computado tras tener eval before+after. */
    cpLoss?: number | null;
    classification?: Classification;
    phase?: Phase;
  }
  const [reviewActive, setReviewActive]   = useState(false);
  const [reviewProgress, setReviewProgress] = useState<{ cur: number; total: number }>({ cur: 0, total: 0 });
  const [reviewMoves, setReviewMoves]     = useState<ReviewMove[]>([]);
  const [reviewError, setReviewError]     = useState<string | null>(null);
  const reviewAbortRef                    = useRef<AbortController | null>(null);

  // ---- Cargar Stockfish on-demand (sólo en esta página) ----
  useEffect(() => {
    let cancelled = false;
    let handle: any = null;
    (async () => {
      try {
        const mod = await import('@/lib/stockfishClient');
        const sf = await mod.createStockfish();
        if (cancelled) { sf.destroy(); return; }
        sf.onInfo((info: any) => setLines(info));
        sf.onError((err: string) => setSfError(err));
        sfRef.current = sf;
        handle = sf;
        setSfReady(true);
      } catch (e: any) {
        if (!cancelled) setSfError(e?.message || 'No se pudo iniciar Stockfish');
      }
    })();
    return () => {
      cancelled = true;
      if (handle) handle.destroy();
      sfRef.current = null;
    };
  }, []);

  // ---- Rebuild chess instance al cambiar ply + casillas de last move ----
  // Memoizado conjunto: ambos derivan de la misma reconstrucción. Evita
  // dos useMemos con el mismo costo en cada render de ply.
  const { fen, lastMoveSquares } = useMemo(() => {
    const c = new Chess();
    let lastFrom: string | null = null;
    let lastTo: string | null = null;
    for (let i = 0; i < Math.min(ply, historySan.length); i++) {
      try {
        const mv = c.move(historySan[i]);
        if (mv) { lastFrom = mv.from; lastTo = mv.to; }
      } catch { break; }
    }
    chessRef.current = c;
    return {
      fen: c.fen(),
      lastMoveSquares: lastFrom && lastTo ? { from: lastFrom, to: lastTo } : null,
    };
  }, [historySan, ply]);

  // Estilos para resaltar la última jugada (estilo Lichess: tinte dorado sutil)
  const customSquareStyles = useMemo<Record<string, React.CSSProperties>>(() => {
    if (!lastMoveSquares) return {};
    const highlight: React.CSSProperties = {
      background: 'radial-gradient(circle, rgba(232,200,115,0.45) 60%, rgba(232,200,115,0.18) 100%)',
    };
    return {
      [lastMoveSquares.from]: highlight,
      [lastMoveSquares.to]:   highlight,
    };
  }, [lastMoveSquares]);

  // ---- Disparar análisis cuando cambia la posición (modo LIVE) ----
  // Se DESACTIVA si está corriendo el review loop, para no pisar
  // el motor con dos requests concurrentes sobre el mismo Worker.
  useEffect(() => {
    const sf = sfRef.current;
    if (!sf || !sfReady) return;
    if (reviewActive) return; // el loop maneja el motor
    setLines([]);
    setAnalyzing(true);
    sf.setPosition(fen);
    sf.analyze({ depth: 16, multipv: 3 });
    return () => { setAnalyzing(false); };
  }, [fen, sfReady, reviewActive]);

  // ---- Movimientos del usuario ----
  function onDrop(from: string, to: string): boolean {
    const c = chessRef.current;
    const before = c.get(from as Square);
    const isPromo = !!before && before.type === 'p'
      && ((before.color === 'w' && to[1] === '8') || (before.color === 'b' && to[1] === '1'));
    let mv;
    try { mv = c.move({ from, to, promotion: isPromo ? 'q' : undefined }); }
    catch { return false; }
    if (!mv) return false;
    // Truncar la historia desde el ply actual y agregar el nuevo SAN
    const newHist = [...historySan.slice(0, ply), mv.san];
    setHistorySan(newHist);
    setPly(newHist.length);
    return true;
  }

  // ---- PGN paste: SÓLO carga las jugadas. El usuario después
  // dispara el loop con "Analizar partida" (startReview). ----
  function loadPgn() {
    setPgnError(null);
    setReviewError(null);
    setReviewMoves([]);
    try {
      const c = new Chess();
      c.loadPgn(pgnInput.trim());
      const hist = c.history();
      if (hist.length === 0) {
        setPgnError('El PGN está vacío o no contiene jugadas.');
        return;
      }
      setHistorySan(hist);
      setPly(hist.length);
    } catch (e: any) {
      setPgnError('PGN inválido. Verificá el formato.');
    }
  }

  /**
   * Loop secuencial: analiza cada posición del PGN, una a una, con
   * timeout por posición y AbortSignal global. Emite progress + eval
   * por jugada en tiempo real.
   *
   * Resuelve el bug "analizando infinitamente": ahora hay timeout duro
   * por posición (15s) y el loop se puede cancelar.
   */
  async function startReview() {
    const sf = sfRef.current;
    if (!sf || !sfReady) {
      setReviewError('Stockfish todavía no está listo.');
      return;
    }
    if (historySan.length === 0) {
      setReviewError('Cargá un PGN primero.');
      return;
    }
    setReviewError(null);
    setReviewMoves([]);
    setReviewProgress({ cur: 0, total: historySan.length });
    setReviewActive(true);

    const abort = new AbortController();
    reviewAbortRef.current = abort;
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== 'production') console.log('[review] start', historySan.length, 'plies');

    const c = new Chess();
    const collected: ReviewMove[] = [];

    // Cache eval de la posición ANTERIOR para no re-analizar dos veces.
    // En el primer ply, analizamos la inicial. En siguientes, reusamos
    // el "eval después" del ply anterior como "eval antes" del siguiente.
    let prevEvalCp: number | null = 0;
    let prevTopLines: Array<{ cp: number | null; mate: number | null; pv?: string[] }> = [];
    try {
      const initInfo = await sf.analyzeOne(c.fen(), { depth: 12, multipv: 3, signal: abort.signal, timeoutMs: 15_000 });
      const top = initInfo.find((l: any) => l.multipv === 1) || initInfo[0];
      // POV blancas para guardado consistente
      const sign = c.turn() === 'w' ? 1 : -1;
      prevEvalCp = top?.cp != null ? top.cp * sign : 0;
      prevTopLines = initInfo.map((l: any) => ({ cp: l.cp, mate: l.mate, pv: l.pv }));
    } catch { /* arrancar con prevEvalCp=0 si falla */ }

    try {
      for (let i = 0; i < historySan.length; i++) {
        if (abort.signal.aborted) break;
        const san = historySan[i];
        const color: 'w' | 'b' = c.turn();
        const fenBefore = c.fen();
        const uciPlayed = sanToUci(fenBefore, san);
        let mv;
        try { mv = c.move(san); } catch { mv = null; }
        if (!mv) {
          collected.push({ ply: i + 1, san, color, fenAfter: fenBefore, cp: null, mate: null, bestUci: null, depth: 0 });
          continue;
        }

        try {
          const info = await sf.analyzeOne(c.fen(), { depth: 12, multipv: 3, signal: abort.signal, timeoutMs: 15_000 });
          const top = info.find((l: any) => l.multipv === 1) || info[0] || null;
          // El score llega POV side-to-move (el de DESPUÉS de mv). Flip a POV blancas.
          const sideAfter = c.turn(); // turno del rival
          const sign = sideAfter === 'w' ? 1 : -1;
          const cp   = top?.cp   != null ? top.cp   * sign : null;
          const mate = top?.mate != null ? top.mate * sign : null;
          const bestUci = top?.pv?.[0] || null;

          // ---- Clasificación ----
          // cpLoss POV jugador que movió: si jugó blanco, loss = prevEval - newEval; si negro, al revés.
          let cpLoss: number | null = null;
          if (cp != null && prevEvalCp != null) {
            cpLoss = color === 'w' ? (prevEvalCp - cp) : (cp - prevEvalCp);
            cpLoss = Math.max(0, cpLoss);
          }
          // matchedBest: comparar UCI jugado con bestUci de las lines previas
          const prevTop = prevTopLines[0];
          const prevBestUci = prevTop?.pv?.[0] || null;
          const matchedBest = !!(uciPlayed && prevBestUci && uciPlayed.slice(0, 4) === prevBestUci.slice(0, 4));
          // Material sacrificado para detectar brilliancies
          const materialSac = uciPlayed ? estimateMaterialSacrificed(fenBefore, uciPlayed) : 0;
          // SwungToLosing: estabamos ganando (≥+150 POV jugador) y ahora perdemos (≤-50)
          const prevPlayerEval: number | null = prevEvalCp == null
            ? null
            : (color === 'w' ? prevEvalCp : -prevEvalCp);
          const newPlayerEval: number | null  = cp != null
            ? (color === 'w' ? cp : -cp)
            : null;
          const swung = prevPlayerEval != null && prevPlayerEval >= 150 &&
                        newPlayerEval  != null && newPlayerEval  <= -50;

          // Contexto de mate (POV blancas, como espera classifyMove).
          // prevTopLines tiene mate POV side-to-move ANTES de mover = POV color.
          // mate (línea 234) ya está flipped a POV blancas.
          const prevMatePovStm = prevTopLines[0]?.mate ?? null;
          const mateBeforeWhite = prevMatePovStm == null
            ? null
            : (color === 'w' ? prevMatePovStm : -prevMatePovStm);

          const classification: Classification = classifyMove({
            cpLoss,
            matchedBest,
            swungToLosing: swung,
            topLinesBefore: prevTopLines,
            uciPlayed: uciPlayed || undefined,
            materialSacrificed: materialSac,
            color,
            mateBefore: mateBeforeWhite,
            mateAfter: mate,
            evalAfter: cp,
          });
          const phase = gamePhase(i + 1, c.fen());

          const m: ReviewMove = {
            ply: i + 1, san, color, fenAfter: c.fen(),
            cp, mate, mateBefore: mateBeforeWhite, bestUci, depth: top?.depth ?? 0,
            cpLoss, classification, phase,
          };
          collected.push(m);
          setReviewMoves([...collected]);
          setReviewProgress({ cur: i + 1, total: historySan.length });

          // Avanzar caches para el siguiente ply
          prevEvalCp = cp;
          prevTopLines = info.map((l: any) => ({ cp: l.cp, mate: l.mate, pv: l.pv }));
        } catch (err: any) {
          if (err?.message === 'aborted') break;
          // Posición con timeout: registrar sin eval y continuar.
          collected.push({ ply: i + 1, san, color, fenAfter: c.fen(), cp: null, mate: null, bestUci: null, depth: 0 });
          setReviewMoves([...collected]);
          setReviewProgress({ cur: i + 1, total: historySan.length });
        }
      }
      if (process.env.NODE_ENV !== 'production') console.log('[review] done', collected.length);
    } finally {
      setReviewActive(false);
      reviewAbortRef.current = null;
    }
  }

  function cancelReview() {
    reviewAbortRef.current?.abort();
    if (process.env.NODE_ENV !== 'production') console.log('[review] cancel');
  }

  // Cleanup abort al desmontar
  useEffect(() => {
    return () => { reviewAbortRef.current?.abort(); };
  }, []);

  // ---- Reset al inicio ----
  function reset() {
    setHistorySan([]);
    setPly(0);
  }

  /**
   * Aplica una jugada UCI sugerida por el motor (click en engine line).
   * Si estamos navegando un ply intermedio, trunca la historia desde ahí
   * y agrega la nueva jugada — comportamiento estándar de Lichess.
   */
  function applyEngineMove(uci: string | undefined) {
    if (!uci || uci.length < 4 || reviewActive) return;
    const c = chessRef.current;
    const from = uci.substring(0, 2);
    const to   = uci.substring(2, 4);
    const promo = uci.length > 4 ? uci[4] : undefined;
    let mv;
    try { mv = c.move({ from, to, promotion: promo as any }); }
    catch { return; }
    if (!mv) return;
    const newHistory = [...historySan.slice(0, ply), mv.san];
    setHistorySan(newHistory);
    setPly(newHistory.length);
  }

  /**
   * Copia el PGN al portapapeles. Útil para compartir el análisis o
   * pegarlo en otra herramienta (Lichess studies, Chessbase, etc).
   */
  const [copiedPgn, setCopiedPgn] = useState(false);
  async function copyPgn() {
    if (historySan.length === 0) return;
    // Construir PGN simple a partir de la historia SAN
    const c = new Chess();
    for (const san of historySan) {
      try { c.move(san); } catch { break; }
    }
    const pgn = c.pgn();
    try {
      await navigator.clipboard.writeText(pgn);
      setCopiedPgn(true);
      setTimeout(() => setCopiedPgn(false), 1500);
    } catch {
      // Fallback: seleccionar manualmente
    }
  }

  // ---- Atajos de teclado estilo Lichess ----
  useChessShortcuts({
    onPrev:  () => setPly((p) => Math.max(0, p - 1)),
    onNext:  () => setPly((p) => Math.min(historySan.length, p + 1)),
    onFirst: () => setPly(0),
    onLast:  () => setPly(historySan.length),
    onFlip:  () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
  });

  // ---- Apertura detectada ----
  const opening = useMemo(() => {
    const slice = historySan.slice(0, Math.min(ply, historySan.length));
    return detectOpening(slice);
  }, [historySan, ply]);

  // ---- Flechas multipv premium: top1 dorado · top2 azul · top3 esmeralda ----
  const customArrows = useMemo<Array<[Square, Square, string]>>(() => {
    const arrows: Array<[Square, Square, string]> = [];
    // Paleta colombiana premium translúcida, opacidades decrecientes
    // para que la mejor jugada se distinga claramente.
    const PALETTE = [
      'rgba(201, 162, 74, 0.85)',  // #1 dorado vivo
      'rgba(30, 77, 139, 0.55)',   // #2 azul profundo
      'rgba(31, 122, 90, 0.45)',   // #3 esmeralda
    ];
    const seen = new Set<string>();
    for (const l of lines.slice(0, 3)) {
      const uci = l.pv?.[0];
      if (!uci || uci.length < 4) continue;
      const key = uci.substring(0, 4);
      if (seen.has(key)) continue; // no duplicar (multipv puede coincidir en raros casos)
      seen.add(key);
      const idx = (l.multipv || 1) - 1;
      arrows.push([
        uci.substring(0, 2) as Square,
        uci.substring(2, 4) as Square,
        PALETTE[idx] || PALETTE[2],
      ]);
    }
    return arrows;
  }, [lines]);

  // Eval mostrada en EvalBar (siempre POV blancas)
  const { evalCp, evalMate } = useMemo(() => {
    const top = lines.find((l) => l.multipv === 1);
    if (!top) return { evalCp: 0, evalMate: null as number | null };
    // Stockfish entrega score POV side-to-move; flip si toca a negras
    const sideToMove = chessRef.current.turn();
    const sign = sideToMove === 'w' ? 1 : -1;
    return {
      evalCp: top.cp != null ? top.cp * sign : 0,
      evalMate: top.mate != null ? top.mate * sign : null,
    };
  }, [lines, fen]);

  // ---- Board width responsive ----
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

  const currentDepth = lines[0]?.depth ?? 0;

  return (
    <section className="flex-1 max-w-7xl mx-auto w-full px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-accent font-medium uppercase tracking-widest text-xs">Sandbox</p>
          <h1 className="font-display text-3xl mt-1">Tablero de análisis</h1>
          <p className="text-wood-600 text-sm mt-1">
            Movés libremente o pegás un PGN. Stockfish analiza en tu navegador.
          </p>
        </div>

        {/* Toggle modo */}
        <div className="inline-flex rounded-lg p-1 bg-wood-50 ring-1 ring-wood-200/70">
          {(['free', 'pgn'] as Mode[]).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={[
                  'px-3.5 py-1.5 rounded-md text-xs font-medium transition-all',
                  active ? 'bg-parch text-ink shadow-sm' : 'text-wood-600 hover:text-ink',
                ].join(' ')}
                style={active ? { boxShadow: '0 0 16px -6px rgba(201,162,74,0.7)' } : undefined}
              >
                {m === 'free' ? 'Tablero libre' : 'Pegar PGN'}
              </button>
            );
          })}
        </div>
      </header>

      {sfError && (
        <div className="mb-4 text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
          {sfError}. Recargá la página o probá en otro navegador.
        </div>
      )}

      <div className="review-grid">
        {/* Columna izquierda: eval + tablero */}
        <div className="flex gap-3">
          <EvalBar cp={evalCp} mate={evalMate} height={boardWidth} />
          <div>
            {opening.info && (
              <div className="mb-2 flex items-center gap-2 animate-fadeIn">
                <span className="text-[10px] uppercase tracking-widest text-wood-400 tabular-nums">
                  {opening.info.eco}
                </span>
                <span className="text-sm font-medium text-wood-700">{opening.info.name}</span>
                {opening.outOfBook && (
                  <span className="text-[10px] uppercase tracking-wider text-wood-400 italic">
                    · fuera de teoría
                  </span>
                )}
              </div>
            )}
            <div className="review-board my-2">
              <Chessboard
                position={fen}
                onPieceDrop={(s: string, t: string) => onDrop(s, t)}
                arePiecesDraggable
                boardOrientation={orientation}
                boardWidth={boardWidth}
                customArrows={customArrows}
                customSquareStyles={customSquareStyles}
                customBoardStyle={{
                  borderRadius: '12px',
                  boxShadow: '0 12px 40px -12px rgba(58,39,22,0.35)',
                }}
                customDarkSquareStyle={{ backgroundColor: '#6e4a26' }}
                customLightSquareStyle={{ backgroundColor: '#f0dcb5' }}
              />
            </div>

            {/* Controles + atajos */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setPly(0)} disabled={ply === 0} title="Inicio (Home)">⏮</button>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setPly((p) => Math.max(0, p - 1))} disabled={ply === 0} title="Atrás (←)">◀</button>
              <span className="text-xs tabular-nums text-wood-600 min-w-[60px] text-center">
                {ply} / {historySan.length}
              </span>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setPly((p) => Math.min(historySan.length, p + 1))} disabled={ply >= historySan.length} title="Adelante (→)">▶</button>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setPly(historySan.length)} disabled={ply >= historySan.length} title="Fin (End)">⏭</button>
              <button
                className="btn-ghost px-2 py-1 text-sm ml-2"
                onClick={() => setOrientation((o) => o === 'white' ? 'black' : 'white')}
                title="Girar tablero (F)"
              >⇅</button>
              <button
                className="btn-ghost px-2 py-1 text-xs"
                onClick={copyPgn}
                disabled={historySan.length === 0}
                title="Copiar PGN al portapapeles"
              >
                {copiedPgn ? '✓ Copiado' : '⧉ Copiar PGN'}
              </button>
              <button className="btn-ghost px-2 py-1 text-sm ml-auto" onClick={reset} disabled={historySan.length === 0} title="Limpiar tablero">
                Limpiar
              </button>
            </div>
            <p className="text-[10px] text-wood-400 mt-1.5 hidden sm:block">
              Atajos: <kbd className="px-1 py-0.5 rounded bg-wood-50 border border-wood-100 text-[9px] font-mono text-wood-700">←</kbd> <kbd className="px-1 py-0.5 rounded bg-wood-50 border border-wood-100 text-[9px] font-mono text-wood-700">→</kbd> navegar · <kbd className="px-1 py-0.5 rounded bg-wood-50 border border-wood-100 text-[9px] font-mono text-wood-700">f</kbd> girar
            </p>
          </div>
        </div>

        {/* Columna derecha: motor + entrada PGN */}
        <aside className="space-y-4 xl:col-span-2">
          {mode === 'pgn' && (
            <div className="card-premium p-5">
              <h3 className="font-display text-lg mb-2">Pegá un PGN</h3>
              <textarea
                value={pgnInput}
                onChange={(e) => setPgnInput(e.target.value)}
                placeholder={'[Event "..."]\n\n1. e4 e5 2. Nf3 Nc6 ...'}
                rows={5}
                disabled={reviewActive}
                className="w-full text-sm font-mono px-3 py-2 rounded-md border border-wood-200 bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all disabled:opacity-60"
              />
              {pgnError && <p className="text-xs text-danger mt-2">{pgnError}</p>}
              {reviewError && <p className="text-xs text-danger mt-2">{reviewError}</p>}

              <div className="flex gap-2 mt-3">
                <button
                  className="btn-ghost"
                  onClick={loadPgn}
                  disabled={!pgnInput.trim() || reviewActive}
                >
                  Cargar partida
                </button>
                {!reviewActive ? (
                  <button
                    className="btn-primary"
                    onClick={startReview}
                    disabled={historySan.length === 0 || !sfReady}
                    title={!sfReady ? 'Esperando motor…' : 'Analizar todas las jugadas'}
                  >
                    Analizar partida
                  </button>
                ) : (
                  <button className="btn-danger" onClick={cancelReview}>
                    Cancelar
                  </button>
                )}
              </div>

              {/* Progress real durante review */}
              {(reviewActive || reviewMoves.length > 0) && (
                <div className="mt-4 animate-fadeIn">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] uppercase tracking-widest text-gold">
                      {reviewActive ? 'Analizando…' : 'Análisis completo'}
                    </span>
                    <span className="text-xs tabular-nums text-wood-600">
                      {reviewProgress.cur} / {reviewProgress.total}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-wood-100 overflow-hidden ring-1 ring-wood-200/40">
                    <div
                      className="h-full transition-[width] duration-300 ease-out"
                      style={{
                        width: `${reviewProgress.total > 0 ? Math.round((reviewProgress.cur / reviewProgress.total) * 100) : 0}%`,
                        background: 'linear-gradient(90deg, #c9a24a 0%, #e8c873 50%, #c9a24a 100%)',
                        boxShadow: '0 0 8px rgba(232,200,115,0.4)',
                      }}
                    />
                  </div>
                  {reviewMoves.length > 0 && (
                    <EvalGraph moves={reviewMoves} total={historySan.length} onSelect={(p) => setPly(p)} active={ply} />
                  )}
                </div>
              )}
            </div>
          )}

          <div className="card-premium p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-lg">Motor</h3>
              <div className="flex items-center gap-2">
                {!sfReady && !sfError && (
                  <span className="text-[10px] uppercase tracking-widest text-wood-500">
                    Cargando…
                  </span>
                )}
                {sfReady && (
                  <span className="text-[10px] uppercase tracking-widest text-gold">
                    Stockfish
                  </span>
                )}
                {currentDepth > 0 && (
                  <span className="text-[10px] tabular-nums text-wood-600">
                    d{currentDepth}
                  </span>
                )}
              </div>
            </div>

            {!sfReady && !sfError && (
              <div className="space-y-2">
                <div className="h-3 rounded bg-wood-100 animate-pulse" />
                <div className="h-3 rounded bg-wood-100 animate-pulse w-3/4" />
                <div className="h-3 rounded bg-wood-100 animate-pulse w-1/2" />
              </div>
            )}

            {sfReady && (
              <ul className="space-y-1.5">
                {lines.length === 0 && analyzing && (
                  <li className="text-xs text-wood-500 italic">Analizando…</li>
                )}
                {lines.map((l) => (
                  <li key={l.multipv}>
                    <button
                      onClick={() => applyEngineMove(l.pv?.[0])}
                      disabled={reviewActive || !l.pv?.[0]}
                      className="w-full flex items-baseline gap-2 text-sm px-2 py-1 rounded-md transition-colors hover:bg-gold/10 disabled:hover:bg-transparent disabled:cursor-default text-left group"
                      title={reviewActive ? 'Pausá el review para jugar esta línea' : 'Click: aplicar esta jugada'}
                    >
                      <span className="text-[10px] uppercase tracking-wider text-wood-400 tabular-nums w-5">
                        #{l.multipv}
                      </span>
                      <span className={`font-display tabular-nums w-12 text-right ${
                        l.mate != null
                          ? (l.mate > 0 ? 'text-accent' : 'text-danger')
                          : (l.cp != null && l.cp >= 0 ? 'text-ink' : 'text-wood-600')
                      }`}>
                        {fmtScore(l, chessRef.current.turn())}
                      </span>
                      <span className="text-wood-700 font-mono text-xs truncate flex-1">
                        {uciToSanLine(fen, l.pv)}
                      </span>
                      <span className="text-[10px] text-gold opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        ↵
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Historial de jugadas con badges inline */}
          {historySan.length > 0 && (
            <div className="card-premium p-5 max-h-[40vh] overflow-y-auto">
              <h3 className="font-display text-lg mb-2">Jugadas</h3>
              <div className="flex flex-wrap gap-x-2 gap-y-1 text-sm">
                {historySan.map((san, i) => {
                  const moveNum = Math.floor(i / 2) + 1;
                  const isWhiteMove = i % 2 === 0;
                  const active = ply === i + 1;
                  const rm = reviewMoves[i];
                  const k = rm?.classification;
                  const symbol = k ? CLASS_META[k].symbol : '';
                  const symbolColor = k ? CLASS_META[k].glow : undefined;
                  return (
                    <span key={i} className="inline-flex items-baseline gap-0.5">
                      {isWhiteMove && (
                        <span className="text-[10px] text-wood-400 tabular-nums">{moveNum}.</span>
                      )}
                      <button
                        onClick={() => setPly(i + 1)}
                        className={`tabular-nums px-1 rounded transition-all ${
                          active
                            ? 'bg-gold/15 text-ink font-medium'
                            : 'text-wood-700 hover:text-ink hover:bg-wood-50'
                        }`}
                      >
                        {san}
                        {symbol && (
                          <span className="ml-0.5 font-bold text-[10px]" style={{ color: symbolColor }}>
                            {symbol}
                          </span>
                        )}
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Panel de jugada actual: badge + explicación humana */}
          {(() => {
            const rm = reviewMoves[ply - 1];
            if (!rm || !rm.classification) return null;
            const expl = humanExplanation({
              classification: rm.classification,
              cpLoss: rm.cpLoss,
              color: rm.color,
              phase: rm.phase,
              ply: rm.ply,
              san: rm.san,
              mateBefore: rm.mateBefore ?? null,
              mateAfter: rm.mate ?? null,
              evalAfter: rm.cp ?? null,
            });
            return (
              <div className="card-premium p-5 animate-fadeIn">
                <p className="text-[10px] uppercase tracking-widest text-wood-500 mb-2">
                  Jugada {Math.ceil(rm.ply / 2)}{rm.color === 'w' ? '.' : '…'}
                </p>
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-display text-2xl">{rm.san}</span>
                  <MoveBadge k={rm.classification} variant="large" />
                </div>
                {expl && <p className="text-sm text-wood-700 leading-snug">{expl}</p>}
                {rm.cpLoss != null && rm.cpLoss > 0 && (
                  <p className="text-[11px] text-wood-500 mt-2 tabular-nums">
                    Pérdida estimada: {Math.round(rm.cpLoss)} cp
                  </p>
                )}
              </div>
            );
          })()}

          {/* Resumen premium con breakdown por fase + timeline */}
          {reviewMoves.length > 5 && reviewMoves.some((m) => m.classification) && (
            <div className="card-premium p-5">
              <h3 className="font-display text-lg mb-4">Resumen</h3>
              <ReviewSummary
                moves={reviewMoves as any}
                onSelectPly={(p) => setPly(p)}
                selectedPly={ply}
              />
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function fmtScore(line: any, sideToMove: 'w' | 'b'): string {
  const sign = sideToMove === 'w' ? 1 : -1;
  if (line.mate != null) {
    const m = line.mate * sign;
    return m > 0 ? `#${m}` : `-#${Math.abs(m)}`;
  }
  if (line.cp != null) {
    const v = (line.cp * sign) / 100;
    return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
  }
  return '—';
}

/** Convierte la PV UCI a SAN para mostrar. Se cae a UCI si algo falla. */
function uciToSanLine(fen: string, pv: string[]): string {
  if (!pv || pv.length === 0) return '';
  try {
    const c = new Chess(fen);
    const sans: string[] = [];
    for (const u of pv.slice(0, 8)) {
      if (u.length < 4) break;
      const move = {
        from: u.substring(0, 2),
        to: u.substring(2, 4),
        promotion: u.length > 4 ? u.substring(4, 5) : undefined,
      };
      const r = c.move(move as any);
      if (!r) break;
      sans.push(r.san);
    }
    return sans.join(' ');
  } catch {
    return pv.slice(0, 8).join(' ');
  }
}

export default function AnalyzePage() {
  return (
    <AuthGuard>
      <AnalyzeInner />
    </AuthGuard>
  );
}

/**
 * EvalGraph: gráfico de evaluación parcial mientras corre el review.
 * SVG inline, sin librerías. Eje X = ply, eje Y = eval clamped a ±8.
 * Click en un ply → navega.
 */
function EvalGraph({ moves, total, onSelect, active }: {
  moves: Array<{ ply: number; cp: number | null; mate: number | null }>;
  total: number;
  onSelect: (ply: number) => void;
  active: number;
}) {
  const W = 280, H = 64;
  const clampCp = (cp: number | null, mate: number | null): number => {
    if (mate != null) return mate > 0 ? 800 : -800;
    if (cp == null)   return 0;
    return Math.max(-800, Math.min(800, cp));
  };
  const xs = (p: number) => (p / Math.max(1, total)) * W;
  const ys = (cp: number) => H / 2 - (cp / 800) * (H / 2 - 4);

  // Polígono de relleno: sigue la línea, cierra al eje 0
  const pts: string[] = ['0,' + (H / 2)];
  moves.forEach((m) => pts.push(`${xs(m.ply).toFixed(1)},${ys(clampCp(m.cp, m.mate)).toFixed(1)}`));
  pts.push(`${xs(moves[moves.length - 1]?.ply || 0).toFixed(1)},${H / 2}`);
  const poly = pts.join(' ');

  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-16 cursor-pointer"
        preserveAspectRatio="none"
        onClick={(e) => {
          const rect = (e.target as SVGElement).getBoundingClientRect();
          const px = e.clientX - rect.left;
          const p = Math.round((px / rect.width) * total);
          onSelect(Math.max(0, Math.min(total, p)));
        }}
      >
        <defs>
          <linearGradient id="evalfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#1f7a5a" stopOpacity="0.25" />
            <stop offset="50%"  stopColor="#c9a24a" stopOpacity="0.1"  />
            <stop offset="100%" stopColor="#b3392c" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        {/* línea cero */}
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#d8c094" strokeWidth="0.5" strokeDasharray="2 2" />
        <polygon points={poly} fill="url(#evalfill)" stroke="#6e4a26" strokeWidth="1" />
        {/* indicador del ply activo */}
        {active > 0 && active <= total && (
          <line
            x1={xs(active)} x2={xs(active)} y1={0} y2={H}
            stroke="#c9a24a" strokeWidth="1.5"
            style={{ filter: 'drop-shadow(0 0 4px rgba(201,162,74,0.6))' }}
          />
        )}
      </svg>
      <p className="text-[10px] text-wood-500 mt-1">Click en el gráfico para navegar</p>
    </div>
  );
}

/** Convierte un SAN a UCI desde el FEN previo. Devuelve null si falla. */
function sanToUci(fenBefore: string, san: string): string | null {
  try {
    const c = new Chess(fenBefore);
    const r = c.move(san);
    if (!r) return null;
    return `${r.from}${r.to}${r.promotion || ''}`;
  } catch { return null; }
}
