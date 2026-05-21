'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import BotPicker from '@/components/BotPicker';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

// Debe coincidir con ALLOWED_TIME_CONTROLS del backend
const TIME_CONTROLS: Array<{ value: string; label: string; sub: string }> = [
  { value: '1+0',  label: '1 min',  sub: 'Bullet' },
  { value: '3+0',  label: '3 min',  sub: 'Blitz' },
  { value: '5+0',  label: '5 min',  sub: 'Blitz' },
  { value: '10+0', label: '10 min', sub: 'Rápida' },
];

function LobbyInner() {
  const router = useRouter();
  const { user } = useAuth();
  const [searching, setSearching] = useState(false);
  const [countryFilter, setCountryFilter] = useState<'CO' | 'GLOBAL'>('GLOBAL');
  const [timeControl, setTimeControl] = useState<string>('10+0');
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [expanded, setExpanded] = useState<boolean>(false); // si saltó CO->GLOBAL
  const [botCreating, setBotCreating] = useState<string | null>(null);
  // Vista del panel: 'match' = matchmaking, 'bots' = grid de bots inline.
  const [view, setView] = useState<'match' | 'bots'>('match');
  // Indica si entramos a 'bots' por timeout (cambia el copy del intro).
  const [fromTimeout, setFromTimeout] = useState(false);

  // Necesitamos el valor "vivo" en el cleanup, sin re-suscribir el effect
  const searchingRef = useRef(searching);
  searchingRef.current = searching;

  useEffect(() => {
    const socket = getSocket();

    function onMatchFound(payload: { gameId: string }) {
      // Importante: setear searching=false ANTES de navegar para que el
      // cleanup del effect (que se dispara al desmontar el lobby) no
      // emita un match:cancel innecesario tras el router.push.
      setSearching(false);
      router.push(`/game/${payload.gameId}`);
    }
    function onMatchExpanded(_: { from: string; to: string }) {
      setExpanded(true);
      setStatusMsg('Buscamos en Colombia y no apareció nadie. Ampliando a global…');
    }
    function onMatchTimeout(_payload: { message?: string }) {
      setSearching(false);
      setExpanded(false);
      setStatusMsg('');
      // Fallback elegante: pasamos a la vista de bots con un copy cálido.
      setFromTimeout(true);
      setView('bots');
    }
    function onConnectError(err: Error) {
      setError(`No se pudo conectar al servidor: ${err.message}`);
    }

    socket.on('match:found', onMatchFound);
    socket.on('match:expanded', onMatchExpanded);
    socket.on('match:timeout', onMatchTimeout);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('match:found', onMatchFound);
      socket.off('match:expanded', onMatchExpanded);
      socket.off('match:timeout', onMatchTimeout);
      socket.off('connect_error', onConnectError);
      // Si seguimos en cola al desmontar, cancelamos
      if (searchingRef.current) socket.emit('match:cancel');
    };
  }, [router]);

  function findMatch() {
    setError(null);
    setExpanded(false);
    setStatusMsg('Buscando rival…');
    setSearching(true);
    const socket = getSocket();
    socket.emit(
      'match:find',
      { countryFilter, timeControl },
      (ack: { ok: boolean; status?: string; gameId?: string; error?: string }) => {
        if (!ack?.ok) {
          setSearching(false);
          setStatusMsg('');
          setError(ack?.error || 'Error iniciando búsqueda');
          return;
        }
        if (ack.status === 'matched' && ack.gameId) {
          router.push(`/game/${ack.gameId}`);
        } else {
          setStatusMsg('En cola. Esperando rival…');
        }
      }
    );
  }

  function cancelSearch() {
    const socket = getSocket();
    socket.emit('match:cancel', null, () => {
      setSearching(false);
      setExpanded(false);
      setStatusMsg('');
    });
  }

  async function pickBot(botId: string) {
    setBotCreating(botId);
    setError(null);
    try {

      const r = await api<{ gameId: string }>('/api/games/bot', {
        method: 'POST',
        body: { botId, timeControl, color: 'random' },
      });
      router.push(`/game/${r.gameId}`);
    } catch (e: any) {
      setError(e?.message || 'No se pudo crear la partida vs bot');
    } finally {
      setBotCreating(null);
    }

  }

  return (
    <section className="flex-1 max-w-4xl mx-auto w-full px-5 py-12">
      <div className="mb-8">
        <p className="text-accent font-medium uppercase tracking-widest text-xs">Lobby</p>
        <h1 className="font-display text-4xl mt-1">Hola, {user?.username}.</h1>
        <p className="text-wood-600 mt-1">Elige con quién quieres jugar y entra al tablero.</p>
      </div>

      <div className="card p-8">
        <h2 className="font-display text-2xl mb-1">Encontrar partida</h2>
        <p className="text-sm text-wood-600 mb-6">Elige tiempo y oponente.</p>

        {/* ---------- TIEMPO ---------- */}
        <label className="label">Tiempo</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
          {TIME_CONTROLS.map((tc) => (
            <button
              key={tc.value}
              type="button"
              onClick={() => setTimeControl(tc.value)}
              disabled={searching}
              className={`text-center p-3 rounded-lg border-2 transition ${
                timeControl === tc.value
                  ? 'border-accent bg-accent/5'
                  : 'border-wood-100 hover:border-wood-200'
              } disabled:opacity-50`}
            >
              <div className="font-display text-xl">{tc.label}</div>
              <div className="text-xs text-wood-600">{tc.sub}</div>
            </button>
          ))}
        </div>

        {/* ---------- PAÍS ---------- */}
        <label className="label">¿Contra quién?</label>
        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={() => setCountryFilter('GLOBAL')}
            className={`text-left p-4 rounded-lg border-2 transition ${
              countryFilter === 'GLOBAL'
                ? 'border-accent bg-accent/5'
                : 'border-wood-100 hover:border-wood-200'
            }`}
            disabled={searching}
          >
            <div className="text-2xl">🌍</div>
            <div className="font-medium mt-1">Global</div>
            <div className="text-xs text-wood-600">Cualquier jugador del mundo</div>
          </button>
          <button
            type="button"
            onClick={() => setCountryFilter('CO')}
            className={`text-left p-4 rounded-lg border-2 transition ${
              countryFilter === 'CO'
                ? 'border-accent bg-accent/5'
                : 'border-wood-100 hover:border-wood-200'
            } ${user?.country !== 'CO' ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={searching || user?.country !== 'CO'}
            title={user?.country !== 'CO' ? 'Sólo para jugadores de Colombia' : ''}
          >
            <div className="text-2xl">🇨🇴</div>
            <div className="font-medium mt-1">Sólo Colombia</div>
            <div className="text-xs text-wood-600">
              Únicamente jugadores colombianos. Si nadie aparece en 8 s, ampliamos a global.
            </div>
          </button>
        </div>

        {error && (
          <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {view === 'match' && !searching && (
          <div className="space-y-3 animate-fadeIn">
            <button onClick={findMatch} className="btn-primary w-full">
              Jugar online
            </button>
            <button
              onClick={() => { setFromTimeout(false); setView('bots'); }}
              className="btn-ghost w-full"
            >
              Jugar contra bots
            </button>
          </div>
        )}

        {view === 'match' && searching && (
          <div className="space-y-3 animate-fadeIn">
            <div className="text-center py-6">
              <div className="inline-block animate-pulse">
                <span className="text-3xl">♟️</span>
              </div>
              <p className="text-wood-700 mt-2">{statusMsg}</p>
              {expanded && (
                <p className="text-xs text-accent mt-1">
                  Pool ampliado a global automáticamente.
                </p>
              )}
            </div>
            <button onClick={cancelSearch} className="btn-ghost w-full">
              Cancelar
            </button>
          </div>
        )}

        {view === 'bots' && (
          <div className="animate-fadeIn">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => { setView('match'); setFromTimeout(false); }}
                className="text-sm text-wood-600 hover:text-ink transition-colors inline-flex items-center gap-1"
              >
                <span aria-hidden>←</span> Volver
              </button>
              {!fromTimeout && (
                <p className="text-xs uppercase tracking-[0.18em] text-wood-500">
                  Bots colombianos
                </p>
              )}
            </div>

            <BotPicker
              variant="inline"
              timeControl={timeControl}
              onTimeControlChange={setTimeControl}
              onPick={pickBot}
              loading={!!botCreating}
              picked={botCreating}
              intro={
                fromTimeout ? (
                  <div className="rounded-md border border-wood-100 bg-wood-50/60 px-4 py-3">
                    <p className="font-display text-base text-ink">
                      Por ahora no hay rivales humanos disponibles.
                    </p>
                    <p className="text-sm text-wood-600 mt-1">
                      Mientras tanto, puedes seguir jugando contra uno de nuestros
                      bots colombianos. Mismas reglas, mismo análisis al terminar.
                    </p>
                  </div>
                ) : null
              }
            />
          </div>
        )}
      </div>

      <RecentGames />
    </section>
  );
}

/* ====== Partidas recientes ====== */
function RecentGames() {
  const router = useRouter();
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ games: any[] }>('/api/games/recent')
      .then((r) => { if (!cancelled) setItems(r.games); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  if (items === null) return (
    <div className="mt-10 h-24 rounded-xl bg-wood-50/40 animate-pulse" />
  );
  if (items.length === 0) return null;

  return (
    <div className="mt-12">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-display text-lg">Partidas recientes</h3>
        <a href="/history" className="text-xs uppercase tracking-wider text-wood-600 hover:text-accent">Ver todas →</a>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {items.map((g) => (
          <button
            key={g.id}
            onClick={() => router.push(`/game/${g.id}/analysis`)}
            className="text-left card-premium p-4 hover-lift group transition-all"
            style={{ backdropFilter: 'saturate(115%)' }}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className={`text-[10px] uppercase tracking-widest font-medium ${
                g.iWon === true  ? 'text-accent'
                : g.iWon === false ? 'text-danger'
                : 'text-wood-500'
              }`}>
                {g.iWon === true ? 'Victoria' : g.iWon === false ? 'Derrota' : 'Tablas'}
              </span>
              <span className="text-[10px] text-wood-500 tabular-nums">{g.timeControl}</span>
            </div>
            <div className="font-display text-base text-ink mb-1 truncate">
              vs <span className="font-medium">{g.opponent}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-wood-600">
              <span className="truncate">{g.openingHint || '—'}</span>
              {g.myAccuracy != null && (
                <span className="tabular-nums shrink-0 ml-2">
                  <span className="text-wood-400">precisión</span> {g.myAccuracy}%
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-wood-400">{relTime(g.endedAt)}</span>
              <span className="text-[10px] uppercase tracking-wider text-gold opacity-0 group-hover:opacity-100 transition-opacity">
                Revisar →
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function relTime(iso: string) {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

export default function LobbyPage() {
  return (
    <AuthGuard>
      <LobbyInner />
    </AuthGuard>
  );
}
