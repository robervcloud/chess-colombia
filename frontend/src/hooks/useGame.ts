'use client';

import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { getSocket } from '@/lib/socket';
import type {
  Color,
  GameStatePayload,
  GameEndPayload,
  PlayerInfo,
} from '@/types';

/** Lado de un jugador en la actualización de rating post-partida. */
export interface RatingUpdateSide {
  userId: string;
  old: number;
  new: number;
  delta: number;
  rd: number;
  provisional: boolean;
}

/** Payload del evento socket `rating:update` (emitido por gameService). */
export interface RatingUpdate {
  mode: 'bullet' | 'blitz' | 'rapid' | 'classical';
  white: RatingUpdateSide;
  black: RatingUpdateSide;
}

interface UseGameResult {
  ready: boolean;
  notFound: boolean;
  fen: string;
  pgn: string;
  turn: Color;
  myColor: Color | null;
  white: PlayerInfo | null;
  black: PlayerInfo | null;
  isMyTurn: boolean;
  endResult: GameEndPayload | null;
  /** Actualización de rating tras finalizar (null hasta que llega). */
  ratingUpdate: RatingUpdate | null;
  opponentDisconnected: boolean;
  errorMsg: string | null;
  /** Reloj — ms restantes según el último snapshot del server */
  whiteMs: number;
  blackMs: number;
  /** Timestamp local (Date.now()) del cliente cuando recibimos el snapshot.
   *  Sirve de ancla para extrapolar el tic en pantalla. */
  clockBaseAt: number;
  /** Intenta jugar. Devuelve true si el server lo aceptó. */
  makeMove: (from: string, to: string, promotion?: string) => Promise<boolean>;
  resign: () => Promise<void>;
}

/**
 * Hook que gestiona la partida en /game/[id].
 *
 * IMPORTANTE — sincronización inicial:
 *   El componente que monta /game/[id] llega DESPUÉS de que el evento
 *   `match:found` se haya emitido (lo recibió el lobby para navegar).
 *   Por eso, al montar, NO podemos sólo "esperar" eventos: tenemos que
 *   pedir activamente el snapshot con `game:request_state`. El backend
 *   responde con `game:state` y `applyState` activa `ready=true`.
 *
 *   Si el socket todavía no estuviera conectado al montar, se espera a
 *   `connect` para hacer la petición.
 */
export function useGame(gameId: string): UseGameResult {
  const chessRef = useRef(new Chess());
  const [fen, setFen] = useState<string>('start');
  const [pgn, setPgn] = useState<string>('');
  const [turn, setTurn] = useState<Color>('w');
  const [myColor, setMyColor] = useState<Color | null>(null);
  const [white, setWhite] = useState<PlayerInfo | null>(null);
  const [black, setBlack] = useState<PlayerInfo | null>(null);
  const [endResult, setEndResult] = useState<GameEndPayload | null>(null);
  const [ratingUpdate, setRatingUpdate] = useState<RatingUpdate | null>(null);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // ----- Reloj -----
  const [whiteMs, setWhiteMs] = useState<number>(0);
  const [blackMs, setBlackMs] = useState<number>(0);
  const [clockBaseAt, setClockBaseAt] = useState<number>(0);

  useEffect(() => {
    const socket = getSocket();
    let cancelled = false;
    let snapshotReceived = false; // local al effect, sirve para evitar retries innecesarios

    function applyState(p: GameStatePayload) {
      if (cancelled) return;
      snapshotReceived = true;
      try {
        chessRef.current.load(p.fen);
      } catch {
        chessRef.current.reset();
      }
      setFen(p.fen);
      setPgn(p.pgn);
      setTurn(p.turn);
      setWhite(p.white);
      setBlack(p.black);
      setMyColor(p.color);
      // ---- Reloj ----
      if (typeof p.whiteMs === 'number') setWhiteMs(p.whiteMs);
      if (typeof p.blackMs === 'number') setBlackMs(p.blackMs);
      setClockBaseAt(Date.now());
      // ---------------
      setReady(true);
      setNotFound(false);
      setOpponentDisconnected(false);
    }

    function onMove(payload: {
      gameId: string;
      move: { from: string; to: string; promotion: string | null };
      fen: string;
      pgn: string;
      turn: Color;
      whiteMs?: number;
      blackMs?: number;
    }) {
      if (cancelled || payload.gameId !== gameId) return;
      try {
        chessRef.current.load(payload.fen);
      } catch {
        /* noop */
      }
      setFen(payload.fen);
      setPgn(payload.pgn);
      setTurn(payload.turn);
      if (typeof payload.whiteMs === 'number') setWhiteMs(payload.whiteMs);
      if (typeof payload.blackMs === 'number') setBlackMs(payload.blackMs);
      setClockBaseAt(Date.now());
    }

    function onEnd(payload: GameEndPayload) {
      if (cancelled || payload.gameId !== gameId) return;
      // Si llegamos aquí sin haber recibido snapshot (porque pedimos
      // estado de una partida ya finalizada), igual marcamos ready
      // para que el componente renderice algo.
      snapshotReceived = true;
      setEndResult(payload);
      setFen(payload.fen);
      setPgn(payload.pgn);
      // Congelar reloj con los valores finales del server
      if (typeof payload.whiteMs === 'number') setWhiteMs(payload.whiteMs);
      if (typeof payload.blackMs === 'number') setBlackMs(payload.blackMs);
      setClockBaseAt(Date.now());
      setReady(true);
    }

    function onRatingUpdate(rt: RatingUpdate) {
      if (cancelled || !rt) return;
      setRatingUpdate(rt);
    }

    function onMatchFound(p: GameStatePayload) {
      if (cancelled || p.gameId !== gameId) return;
      applyState(p);
    }

    function onState(p: GameStatePayload) {
      if (cancelled || p.gameId !== gameId) return;
      applyState(p);
    }

    function onNotFound(p: { gameId: string | null }) {
      if (cancelled) return;
      if (p.gameId === gameId || p.gameId === null) {
        setNotFound(true);
      }
    }

    function onOppDisconnected() {
      if (!cancelled) setOpponentDisconnected(true);
    }
    function onOppReconnected() {
      if (!cancelled) setOpponentDisconnected(false);
    }

    // ---- 1) Registrar listeners ANTES de emitir nada ----
    socket.on('match:found', onMatchFound);
    socket.on('game:state', onState);
    socket.on('game:move', onMove);
    socket.on('game:end', onEnd);
    socket.on('rating:update', onRatingUpdate);
    socket.on('game:not_found', onNotFound);
    socket.on('opponent:disconnected', onOppDisconnected);
    socket.on('opponent:reconnected', onOppReconnected);

    // ---- 2) Pedir el snapshot inicial (incondicional) ----
    // Socket.io bufferiza el emit si todavía no está conectado y lo
    // envía en cuanto se conecta, así que NO necesitamos chequear
    // socket.connected antes de llamar a emit. Hacerlo así nos quita
    // un caso de race en el mount post-navegación SPA.
    function requestState(reason: string) {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.log(`[useGame] request_state (${reason})`, {
        gameId,
        connected: socket.connected,
      });
      socket.emit('game:request_state', { gameId });
    }

    requestState('mount');

    // ---- 3) Retry si tras 1.5s no llegó snapshot ----
    // Es una red de seguridad. En el flujo normal el server responde
    // inmediato; este timer cubre paquetes perdidos, restarts del
    // server o transitorios de red entre el emit y el ack.
    const retryTimer = setTimeout(() => {
      if (!snapshotReceived && !cancelled) {
        requestState('retry-1500ms');
      }
    }, 1500);

    // ---- 4) Si el socket se (re)conecta más tarde, volver a pedir ----
    function onConnect() {
      requestState('socket-connect');
    }
    socket.on('connect', onConnect);

    // ---- Cleanup ----
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      socket.off('match:found', onMatchFound);
      socket.off('game:state', onState);
      socket.off('game:move', onMove);
      socket.off('game:end', onEnd);
      socket.off('rating:update', onRatingUpdate);
      socket.off('game:not_found', onNotFound);
      socket.off('opponent:disconnected', onOppDisconnected);
      socket.off('opponent:reconnected', onOppReconnected);
      socket.off('connect', onConnect);
    };
  }, [gameId]);

  async function makeMove(from: string, to: string, promotion?: string): Promise<boolean> {
    setErrorMsg(null);
    return new Promise((resolve) => {
      const socket = getSocket();
      socket.emit(
        'game:move',
        { gameId, from, to, promotion },
        (ack: { ok: boolean; error?: string }) => {
          if (!ack?.ok) {
            setErrorMsg(ack?.error || 'Movimiento ilegal');
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  }

  async function resign(): Promise<void> {
    return new Promise((resolve) => {
      const socket = getSocket();
      socket.emit('game:resign', { gameId }, () => resolve());
    });
  }

  const isMyTurn = !!myColor && myColor === turn && !endResult;

  return {
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
  };
}
