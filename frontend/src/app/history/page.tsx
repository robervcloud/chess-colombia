'use client';

import { useEffect, useState } from 'react';
import AuthGuard from '@/components/AuthGuard';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { HistoryItem } from '@/types';

function HistoryInner() {
  const { user } = useAuth();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { games } = await api<{ games: HistoryItem[] }>('/api/games/history');
        setItems(games);
      } catch (e: any) {
        setErr(e?.message || 'No se pudo cargar el historial');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <section className="flex-1 max-w-4xl mx-auto w-full px-5 py-12">
      <div className="mb-8">
        <p className="text-accent font-medium uppercase tracking-widest text-xs">Historial</p>
        <h1 className="font-display text-4xl mt-1">Tus partidas</h1>
      </div>

      {loading && <p className="text-wood-600">Cargando…</p>}
      {err && (
        <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
          {err}
        </div>
      )}
      {!loading && !err && items.length === 0 && (
        <div className="card p-8 text-center text-wood-600">
          Aún no has jugado ninguna partida. ¡Anímate desde el lobby!
        </div>
      )}

      <div className="space-y-2">
        {items.map((g) => {
          const youAreWhite = g.white_id === user?.id;
          const opponent = youAreWhite ? g.black_username : g.white_username;
          const myResult = !g.result
            ? '—'
            : g.result === '1/2-1/2'
            ? 'Tablas'
            : (g.result === '1-0') === youAreWhite
            ? 'Victoria'
            : 'Derrota';
          const dot =
            myResult === 'Victoria'
              ? 'bg-accent'
              : myResult === 'Derrota'
              ? 'bg-danger'
              : 'bg-wood-400';
          return (
            <div key={g.id} className="card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${dot}`} />
                <div>
                  <div className="font-medium">
                    {youAreWhite ? '♔' : '♚'} vs <span className="text-wood-700">{opponent}</span>
                  </div>
                  <div className="text-xs text-wood-600">
                    {new Date(g.created_at).toLocaleString('es-CO')} · {g.time_control}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">{myResult}</div>
                <div className="text-xs text-wood-600">{g.result || g.status}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function HistoryPage() {
  return (
    <AuthGuard>
      <HistoryInner />
    </AuthGuard>
  );
}
