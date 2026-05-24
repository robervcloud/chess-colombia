'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { AndeanMotif } from '@/components/AndeanMotif';

/**
 * Landing — premium, minimalista, identidad colombiana sutil.
 *
 * Decisiones de diseño:
 * - Tipografía display (Fraunces) para titulares; sans Plus Jakarta para texto.
 * - Paleta cálida ya existente (wood + parch + accent + gold + clay).
 * - "Identidad Colombia" se evoca sólo con: una estrella entre el wordmark,
 *   la palabra "patrimonio" en una microcopy, y el footer "Hecho en Colombia".
 *   No banderas, no clichés.
 * - Cero animaciones agresivas; sólo `breath` muy suave en una pieza decorativa.
 */
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
    <>
      <Hero />
      <HowItWorks />
      <FeatureGrid />
      <FinalCTA />
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Hero                                                             */
/* ---------------------------------------------------------------- */
function Hero() {
  return (
    <section className="surface-warm relative overflow-hidden">
      {/* Decoración: tablero parcial difuminado, puramente visual */}
      <div className="pointer-events-none absolute -right-24 -top-10 hidden md:block opacity-[0.18]">
        <div className="grid grid-cols-8 grid-rows-8 w-[520px] h-[520px] rotate-12 animate-breath">
          {Array.from({ length: 64 }).map((_, i) => {
            const r = Math.floor(i / 8);
            const c = i % 8;
            const dark = (r + c) % 2 === 1;
            return (
              <div
                key={i}
                className={dark ? 'bg-wood-600' : 'bg-wood-100'}
              />
            );
          })}
        </div>
      </div>

      <div className="relative max-w-6xl mx-auto px-5 py-20 md:py-28">
        {/* Eyebrow con motif andino */}
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-wood-700">
          <AndeanMotif variant="icon" className="w-7 h-3.5 text-gold" />
          <span>Hecho en Colombia, para Colombia</span>
        </div>

        <h1 className="font-display mt-6 text-5xl md:text-7xl leading-[1.02] tracking-tight max-w-3xl">
          El ajedrez,
          <br />
          jugado <span className="italic text-accent">en casa</span>.
        </h1>

        <p className="mt-6 text-lg text-wood-800/80 max-w-xl leading-relaxed">
          Una plataforma para jugar, analizar y aprender ajedrez con la
          comunidad colombiana. Tiempo real, motor Stockfish, lecciones
          desde cero. Sin anuncios, sin distracciones.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/register" className="btn-primary hover-lift">
            Crear cuenta gratis
          </Link>
          <Link
            href="/aprender"
            className="btn-ghost hover-lift inline-flex items-center gap-2"
            style={{
              borderColor: 'rgba(201,162,74,0.55)',
              color: '#5a4423',
            }}
          >
            <span>Aprender ajedrez</span>
            <span className="text-gold">→</span>
          </Link>
          <Link href="/login" className="btn-ghost hover-lift">
            Ya tengo cuenta
          </Link>
        </div>

        {/* Microcopy de comunidad */}
        <p className="mt-10 text-xs tracking-wider text-wood-500 uppercase flex items-center gap-2">
          <span>Comunidad</span>
          <span className="w-1 h-1 rounded-full bg-gold" />
          <span>Juego limpio</span>
          <span className="w-1 h-1 rounded-full bg-gold" />
          <span>Patrimonio</span>
        </p>
      </div>

      {/* Cordillera al pie del hero — identidad andina sutil */}
      <div className="absolute bottom-0 left-0 right-0 h-28 pointer-events-none">
        <AndeanMotif variant="banner" className="w-full h-full" />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* How it works                                                     */
/* ---------------------------------------------------------------- */
function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Encuentra rival',
      body: 'Filtra por jugadores de Colombia o juega global. El emparejamiento es inmediato.',
    },
    {
      n: '02',
      title: 'Juega en tiempo real',
      body: 'Reloj profesional, sin lag, validado en servidor. Reconexión automática si te cortan.',
    },
    {
      n: '03',
      title: 'Aprende del análisis',
      body: 'Al terminar, Stockfish revisa cada jugada y estima tu nivel. Mejor jugada, alternativas y precisión.',
    },
  ];
  return (
    <section className="bg-parch border-y border-wood-100">
      <div className="max-w-6xl mx-auto px-5 py-20">
        <SectionHeader
          eyebrow="Cómo funciona"
          title="Tres pasos. Cero fricción."
        />
        <div className="grid md:grid-cols-3 gap-6 mt-12">
          {steps.map((s) => (
            <article key={s.n} className="card-premium hover-lift p-7">
              <div className="font-display text-3xl text-gold tabular-nums">{s.n}</div>
              <h3 className="font-display text-xl mt-4">{s.title}</h3>
              <p className="text-wood-700/80 mt-2 text-sm leading-relaxed">{s.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Feature grid                                                     */
/* ---------------------------------------------------------------- */
function FeatureGrid() {
  return (
    <section className="surface-warm">
      <div className="max-w-6xl mx-auto px-5 py-20">
        <SectionHeader
          eyebrow="Hecho con cuidado"
          title="Lo que esperas de una plataforma seria, sin las complicaciones."
        />

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mt-12">
          <Feature
            icon="✦"
            title="Aprende desde cero"
            body="Lecciones interactivas para personas que nunca jugaron. Cada pieza, cada idea, en un tablero que responde."
            href="/aprender"
          />
          <Feature
            icon="♟︎"
            title="Validación en servidor"
            body="Cada jugada se valida contra el estado real de la partida. Imposible hacer trampa con un cliente modificado."
          />
          <Feature
            icon="⏱"
            title="Reloj profesional"
            body="Tics de décima de segundo bajo presión. Detección de tiempo agotado en el servidor, no en tu pantalla."
          />
          <Feature
            icon="△"
            title="Filtro Colombia"
            body="Juega sólo con paisanos cuando quieras. Si no aparece nadie en 8 segundos, abrimos al mundo."
            subtle
          />
          <Feature
            icon="📊"
            title="Análisis con Stockfish"
            body="Revisión jugada por jugada al terminar. Precisión, blunders, mejores jugadas, líneas alternativas."
          />
          <Feature
            icon="↻"
            title="Reconexión sin perder partida"
            body="Si se te cae el internet, vuelves a la misma posición. Treinta segundos de gracia antes de declarar abandono."
          />
        </div>
      </div>
    </section>
  );
}

function Feature({
  icon,
  title,
  body,
  subtle,
  href,
}: {
  icon: string;
  title: string;
  body: string;
  subtle?: boolean;
  href?: string;
}) {
  const content = (
    <>
      <div className={`text-2xl ${subtle ? 'opacity-90' : 'text-accent'}`}>{icon}</div>
      <h3 className="font-display text-lg mt-3 flex items-center gap-1.5">
        {title}
        {href && (
          <span className="text-xs text-gold opacity-0 group-hover:opacity-100 transition-opacity">
            →
          </span>
        )}
      </h3>
      <p className="text-wood-700/80 mt-2 text-sm leading-relaxed">{body}</p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="card-premium hover-lift p-6 group block">
        {content}
      </Link>
    );
  }
  return <article className="card-premium hover-lift p-6">{content}</article>;
}

/* ---------------------------------------------------------------- */
/* Final CTA                                                        */
/* ---------------------------------------------------------------- */
function FinalCTA() {
  return (
    <section className="bg-wood-800 text-parch relative overflow-hidden">
      {/* Halo dorado decorativo */}
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          background:
            'radial-gradient(60% 60% at 50% 0%, rgba(232,200,115,0.45), transparent 70%)',
        }}
      />
      <div className="relative max-w-4xl mx-auto px-5 py-24 text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-gold-light">
          Empieza ahora
        </p>
        <h2 className="font-display text-4xl md:text-5xl mt-4 leading-tight">
          Tu primera partida está
          <br />
          a un clic de distancia.
        </h2>
        <div className="mt-10 flex justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 px-7 py-3 rounded-md
                       font-medium bg-gold text-ink hover:bg-gold-light
                       transition-colors shadow-soft hover-lift"
          >
            Crear cuenta gratis
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 px-7 py-3 rounded-md
                       font-medium border border-parch/30 hover:bg-parch/10 text-parch
                       transition-colors hover-lift"
          >
            Iniciar sesión
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Section header reutilizable                                      */
/* ---------------------------------------------------------------- */
function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="max-w-2xl">
      <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-wood-600">
        <span className="w-6 h-px bg-gold/70" />
        <span>{eyebrow}</span>
      </div>
      <h2 className="font-display text-3xl md:text-4xl mt-3 leading-tight">
        {title}
      </h2>
    </div>
  );
}
