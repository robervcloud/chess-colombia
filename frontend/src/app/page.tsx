'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const router = useRouter();
  const { user, hydrate, hydrated } = useAuth();

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (hydrated && user) router.replace('/lobby');
  }, [hydrated, user, router]);

  return (
    <section className="flex-1 flex items-center">
      <div className="max-w-6xl mx-auto px-5 py-16 grid md:grid-cols-2 gap-12 items-center w-full">
        <div>
          <p className="text-accent font-medium uppercase tracking-widest text-xs mb-4">
            Hecho en Colombia
          </p>
          <h1 className="font-display text-5xl md:text-6xl leading-[1.05] tracking-tight">
            Una jugada<br />a la vez,<br />
            <span className="text-accent italic">desde casa</span>.
          </h1>
          <p className="mt-6 text-wood-800/80 text-lg max-w-md">
            Juega ajedrez en tiempo real con jugadores colombianos o del mundo.
            Crea tu cuenta gratis y entra al tablero en menos de un minuto.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="btn-primary">
              Crear cuenta
            </Link>
            <Link href="/login" className="btn-ghost">
              Ya tengo cuenta
            </Link>
          </div>

          <div className="mt-10 flex gap-8 text-sm text-wood-600">
            <div>
              <div className="font-display text-2xl text-ink">🇨🇴</div>
              <div>Filtro Colombia</div>
            </div>
            <div>
              <div className="font-display text-2xl text-ink">⚡</div>
              <div>Tiempo real</div>
            </div>
            <div>
              <div className="font-display text-2xl text-ink">🆓</div>
              <div>Gratis</div>
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="aspect-square bg-gradient-to-br from-wood-100 to-wood-50 rounded-2xl shadow-soft p-6 grid grid-cols-8 grid-rows-8 overflow-hidden">
            {Array.from({ length: 64 }).map((_, i) => {
              const row = Math.floor(i / 8);
              const col = i % 8;
              const dark = (row + col) % 2 === 1;
              return (
                <div
                  key={i}
                  className={dark ? 'bg-wood-600' : 'bg-wood-100'}
                  style={{ borderRadius: 0 }}
                />
              );
            })}
          </div>
          <div className="absolute -bottom-4 -right-4 bg-white rounded-xl px-5 py-3 shadow-soft border border-wood-100">
            <div className="text-xs text-wood-600">Última partida</div>
            <div className="font-display text-xl">Mate en 24 ♚</div>
          </div>
        </div>
      </div>
    </section>
  );
}
