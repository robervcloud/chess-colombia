'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AndeanMotif } from '@/components/AndeanMotif';
import { api } from '@/lib/api';

interface LiveGame {
  id: string;
  whiteUsername: string;
  blackUsername: string;
  whiteRating: number;
  blackRating: number;
  timeControl: string;
  startedAt: string;
}

const REFRESH_MS = 5000;

export default function LivePage() {
  const router = useRouter();
  const [games, setGames] = useState<LiveGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Polling cada 5s para refrescar partidas activas
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function load() {
      try {
        const r = await api<{ games: LiveGame[] }>('/api/games/live?limit=30');
        if (cancelled) return;
        setGames(r.games || []);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Error cargando partidas');
      }
      if (!cancelled) timer = window.setTimeout(load, REFRESH_MS);
    }
    load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return (
    <section className="flex-1 max-w-4xl mx-auto w-full px-5 py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="review-eyebrow flex items-center gap-2 text-gold">
            <AndeanMotif variant="icon" className="w-6 h-3 text-gold" />
            En vivo · ahora mismo
          </p>
          <h1 className="font-display text-3xl text-ink mt-1">Partidas en curso</h1>
          <p className="text-wood-600 text-sm mt-2">
            Mirá las partidas que se están jugando en este momento.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-wood-500">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-accent animate-ping opacity-60" />
            <span className="relative rounded-full h-2 w-2 bg-accent" />
          </span>
          actualizando
        </div>
      </header>

      {error && (
        <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {!games && !error && (
        <div className="review-card p-8 flex justify-center">
          <span className="loader-dots"><span /><span /><span /></span>
        </div>
      )}

      {games && games.length === 0 && (
        <div className="review-card p-8 text-center">
          <p className="text-wood-600 mb-1">No hay partidas activas ahora mismo.</p>
          <p className="text-xs text-wood-500">
            Volvé en unos minutos o jugá una vos mismo desde el{' '}
            <button onClick={() => router.push('/lobby')} className="text-accent hover:underline">
              lobby
            </button>.
          </p>
        </div>
      )}

      {games && games.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {games.map((g) => (
            <button
              key={g.id}
              onClick={() => router.push(`/game/${g.id}`)}
              className="review-card text-left group transition-all hover-lift"
            >
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <span className="text-[10px] uppercase tracking-widest text-accent flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  En vivo
                </span>
                <span className="text-[10px] tabular-nums text-wood-500 uppercase tracking-wider">
                  {g.timeControl}
                </span>
              </div>

              <div className="space-y-1.5">
                <PlayerLine username={g.whiteUsername} rating={g.whiteRating} color="white" />
                <div className="text-[10px] text-wood-400 px-2">vs</div>
                <PlayerLine username={g.blackUsername} rating={g.blackRating} color="black" />
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-[10px] text-wood-500">
                  Comenzó {relTime(g.startedAt)}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-gold opacity-0 group-hover:opacity-100 transition-opacity">
                  Espectar →
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function PlayerLine({ username, rating, color }: {
  username: string;
  rating: number;
  color: 'white' | 'black';
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-3 h-3 rounded-sm shrink-0 ${
          color === 'white' ? 'bg-parch border border-wood-300' : 'bg-wood-800'
        }`}
      />
      <span className="text-sm font-medium text-ink truncate flex-1">@{username}</span>
      <span className="text-xs tabular-nums text-wood-500">{rating}</span>
    </div>
  );
}

function relTime(iso: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `hace ${hrs}h`;
}
