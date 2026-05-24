'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Chess } from 'chess.js';

import { AndeanMotif } from '@/components/AndeanMotif';
import { LESSONS, loadProgress, saveProgress, type Lesson } from '@/lib/lessons';

const Chessboard = dynamic(
  () => import('react-chessboard').then((m) => m.Chessboard),
  { ssr: false }
);

type Square = `${'a'|'b'|'c'|'d'|'e'|'f'|'g'|'h'}${'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'}`;
type Phase = 'overview' | 'playing' | 'success';

/**
 * Página "Aprender ajedrez" — para personas que entran por primera vez
 * al ajedrez, no para jugadores de torneo.
 *
 * Diseño:
 *   - Vista overview: lista de lecciones (cards con motif andino sutil).
 *   - Vista playing: tablero a la izquierda, panel guía a la derecha.
 *   - Vista success: celebración cálida + CTA a la siguiente lección.
 *
 * Persistencia: localStorage (sin backend). El usuario nuevo no necesita
 * registrarse para empezar a aprender.
 */
export default function AprenderPage() {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  // Cargar progreso al montar (cliente)
  useEffect(() => {
    setCompleted(loadProgress());
  }, []);

  const activeLesson = useMemo(
    () => LESSONS.find((l) => l.id === activeId) || null,
    [activeId]
  );

  function markCompleted(id: string) {
    setCompleted((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveProgress(next);
      return next;
    });
  }

  function startLesson(id: string) {
    setActiveId(id);
  }

  function backToOverview() {
    setActiveId(null);
  }

  function goToNext() {
    if (!activeLesson) return;
    const idx = LESSONS.findIndex((l) => l.id === activeLesson.id);
    const next = LESSONS[idx + 1];
    if (next) setActiveId(next.id);
    else setActiveId(null);
  }

  if (activeLesson) {
    return (
      <LessonView
        lesson={activeLesson}
        onComplete={() => markCompleted(activeLesson.id)}
        onBack={backToOverview}
        onNext={goToNext}
        hasNext={LESSONS.findIndex((l) => l.id === activeLesson.id) < LESSONS.length - 1}
      />
    );
  }

  return <Overview completed={completed} onStart={startLesson} />;
}

/* ============================================================ */
/* Overview — lista de lecciones                                 */
/* ============================================================ */

function Overview({
  completed,
  onStart,
}: {
  completed: Set<string>;
  onStart: (id: string) => void;
}) {
  const totalDone = completed.size;
  const totalLessons = LESSONS.length;
  const pct = totalLessons === 0 ? 0 : Math.round((totalDone / totalLessons) * 100);

  return (
    <section className="flex-1 max-w-5xl mx-auto w-full px-5 py-10">
      {/* Hero con motif andino sutil */}
      <header className="relative mb-10 overflow-hidden rounded-2xl review-card" style={{ padding: '2.5rem 2rem 5rem' }}>
        <div className="relative z-10">
          <p className="review-eyebrow flex items-center gap-2 text-gold mb-2">
            <AndeanMotif variant="icon" className="w-6 h-3 text-gold" />
            Para quienes empiezan
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-ink leading-tight">
            Aprende ajedrez desde el primer movimiento
          </h1>
          <p className="text-wood-700 mt-3 max-w-2xl leading-relaxed">
            Seis lecciones cortas, hechas con cariño. Cada una te enseña una
            idea y la practicas en el tablero. No hace falta saber nada antes
            de empezar.
          </p>

          {/* Progreso global */}
          {totalLessons > 0 && (
            <div className="mt-6 max-w-md">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="review-eyebrow">Tu progreso</span>
                <span className="text-xs tabular-nums text-wood-700">
                  {totalDone} / {totalLessons} · {pct}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-wood-100 overflow-hidden ring-1 ring-wood-200/40">
                <div
                  className="h-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${pct}%`,
                    background: 'linear-gradient(90deg, #c9a24a 0%, #e8c873 50%, #c9a24a 100%)',
                    boxShadow: '0 0 8px rgba(232,200,115,0.4)',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Cordillera al pie del hero */}
        <div className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none">
          <AndeanMotif variant="banner" className="w-full h-full" />
        </div>
      </header>

      {/* Grilla de lecciones */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {LESSONS.map((lesson, idx) => {
          const done = completed.has(lesson.id);
          const isNext = !done && LESSONS.slice(0, idx).every((l) => completed.has(l.id));
          return (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              index={idx + 1}
              done={done}
              recommended={isNext}
              onStart={() => onStart(lesson.id)}
            />
          );
        })}
      </div>

      <p className="mt-10 text-center text-xs text-wood-500">
        ¿Ya sabes lo básico? <a href="/lobby" className="text-accent hover:underline">Juega una partida →</a>
      </p>
    </section>
  );
}

function LessonCard({
  lesson,
  index,
  done,
  recommended,
  onStart,
}: {
  lesson: Lesson;
  index: number;
  done: boolean;
  recommended: boolean;
  onStart: () => void;
}) {
  return (
    <button
      onClick={onStart}
      className={[
        'relative overflow-hidden review-card text-left group',
        'transition-all duration-200 ease-out',
        recommended ? 'ring-1 ring-gold/50' : '',
      ].join(' ')}
      style={{
        boxShadow: recommended
          ? '0 0 22px -6px rgba(201,162,74,0.45), 0 8px 24px -16px rgba(58,39,22,0.18)'
          : undefined,
      }}
    >
      {/* Motif esquinero sutil */}
      <div className="absolute bottom-0 right-0 w-32 h-16 opacity-40 text-gold pointer-events-none">
        <AndeanMotif variant="corner" className="w-full h-full" />
      </div>

      <div className="relative z-10">
        <div className="flex items-start justify-between gap-2 mb-3">
          <span className="text-[10px] uppercase tracking-widest text-wood-500 tabular-nums">
            Lección {index}
          </span>
          {done && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent">
              ✓ Completada
            </span>
          )}
          {recommended && !done && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-gold/50 bg-gold/15 text-wood-800">
              Empezar acá
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-3 mb-2">
          <span className="font-display text-3xl text-wood-700 leading-none">
            {lesson.glyph}
          </span>
          <h3 className="font-display text-lg text-ink leading-tight">
            {lesson.title}
          </h3>
        </div>

        <p className="text-sm text-wood-600 leading-snug">{lesson.tagline}</p>

        <div className="mt-4 flex items-center justify-between">
          <DifficultyDots level={lesson.difficulty} />
          <span className="text-xs uppercase tracking-wider text-gold opacity-0 group-hover:opacity-100 transition-opacity">
            Empezar →
          </span>
        </div>
      </div>
    </button>
  );
}

function DifficultyDots({ level }: { level: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`block w-1.5 h-1.5 rounded-full ${
            i <= level ? 'bg-gold' : 'bg-wood-200'
          }`}
        />
      ))}
    </div>
  );
}

/* ============================================================ */
/* LessonView — tablero interactivo + guía                       */
/* ============================================================ */

function LessonView({
  lesson,
  onComplete,
  onBack,
  onNext,
  hasNext,
}: {
  lesson: Lesson;
  onComplete: () => void;
  onBack: () => void;
  onNext: () => void;
  hasNext: boolean;
}) {
  const chessRef = useRef(new Chess(lesson.startFen));
  const [fen, setFen] = useState(lesson.startFen);
  const [history, setHistory] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('playing');
  const [showHint, setShowHint] = useState(false);
  const [attemptedWrong, setAttemptedWrong] = useState(false);

  // Resetear al cambiar de lección
  useEffect(() => {
    chessRef.current = new Chess(lesson.startFen);
    setFen(lesson.startFen);
    setHistory([]);
    setPhase('playing');
    setShowHint(false);
    setAttemptedWrong(false);
  }, [lesson.id, lesson.startFen]);

  function reset() {
    chessRef.current = new Chess(lesson.startFen);
    setFen(lesson.startFen);
    setHistory([]);
    setPhase('playing');
    setAttemptedWrong(false);
  }

  function onPieceDrop(from: string, to: string): boolean {
    if (phase !== 'playing') return false;
    const c = chessRef.current;
    const before = c.get(from as Square);
    const isPromo = !!before && before.type === 'p' &&
      ((before.color === 'w' && to[1] === '8') || (before.color === 'b' && to[1] === '1'));
    let mv;
    try { mv = c.move({ from, to, promotion: isPromo ? 'q' : undefined }); }
    catch { return false; }
    if (!mv) return false;

    const newHistory = [...history, mv.san];
    setHistory(newHistory);
    setFen(c.fen());

    // Validar objetivo
    if (lesson.validate(newHistory, c.fen())) {
      setPhase('success');
      onComplete();
      return true;
    }

    // No es la jugada correcta — marcar como intento fallido
    setAttemptedWrong(true);
    return true;
  }

  // Tamaño responsive del board
  const [boardWidth, setBoardWidth] = useState(440);
  useEffect(() => {
    function resize() {
      const w = typeof window === 'undefined' ? 440 : window.innerWidth;
      setBoardWidth(Math.min(480, Math.max(260, w - 64)));
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  return (
    <section className="flex-1 max-w-6xl mx-auto w-full px-5 py-8">
      {/* Header con back + título */}
      <header className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div>
          <button
            onClick={onBack}
            className="text-xs uppercase tracking-widest text-wood-500 hover:text-accent transition mb-2"
          >
            ← Todas las lecciones
          </button>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-4xl text-wood-700 leading-none">
              {lesson.glyph}
            </span>
            <div>
              <p className="review-eyebrow text-gold">Lección</p>
              <h1 className="font-display text-2xl sm:text-3xl text-ink leading-tight">
                {lesson.title}
              </h1>
            </div>
          </div>
        </div>
        <DifficultyDots level={lesson.difficulty} />
      </header>

      <div className="grid lg:grid-cols-[auto_1fr] gap-6 items-start">
        {/* Tablero */}
        <div className="review-board mx-auto lg:mx-0">
          <Chessboard
            position={fen}
            onPieceDrop={(s: string, t: string) => onPieceDrop(s, t)}
            arePiecesDraggable={phase === 'playing'}
            boardOrientation="white"
            boardWidth={boardWidth}
            customBoardStyle={{
              borderRadius: '12px',
              boxShadow: '0 12px 40px -12px rgba(58,39,22,0.35)',
            }}
            customDarkSquareStyle={{ backgroundColor: '#6e4a26' }}
            customLightSquareStyle={{ backgroundColor: '#f0dcb5' }}
          />
        </div>

        {/* Panel guía */}
        <aside className="space-y-4">
          {/* Intro */}
          <div className="review-card">
            <p className="review-eyebrow mb-2">Cómo funciona</p>
            <p className="text-wood-800 leading-relaxed">{lesson.intro}</p>
          </div>

          {/* Objetivo */}
          <div className="review-card">
            <p className="review-eyebrow mb-2 text-gold">Tu objetivo</p>
            <p className="text-ink font-medium text-lg leading-snug">{lesson.goal}</p>
            {history.length > 0 && phase === 'playing' && (
              <p className="text-xs text-wood-500 mt-2 italic">
                Jugaste: {history.join(' ')}
              </p>
            )}
          </div>

          {/* Estado: éxito / pista */}
          {phase === 'success' ? (
            <div
              className="review-card animate-fadeIn"
              style={{
                borderColor: 'rgba(31, 122, 90, 0.4)',
                background: 'linear-gradient(180deg, rgba(31,122,90,0.08), rgba(31,122,90,0.02))',
              }}
            >
              <p className="review-eyebrow text-accent mb-2">¡Lo lograste!</p>
              <p className="text-ink font-medium">
                Excelente. Esta idea ya está en tu cabeza para toda la vida.
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                {hasNext ? (
                  <button onClick={onNext} className="btn-primary">
                    Siguiente lección →
                  </button>
                ) : (
                  <a href="/lobby" className="btn-primary">
                    Jugar una partida →
                  </a>
                )}
                <button onClick={reset} className="btn-ghost">
                  Repetir esta lección
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {!showHint ? (
                <button
                  onClick={() => setShowHint(true)}
                  className="btn-ghost text-sm"
                >
                  ¿Necesitas una pista?
                </button>
              ) : (
                <div className="w-full review-card animate-fadeIn" style={{ background: 'rgba(201,162,74,0.08)', borderColor: 'rgba(201,162,74,0.3)' }}>
                  <p className="review-eyebrow text-gold mb-1.5">Pista</p>
                  <p className="text-sm text-wood-800 leading-snug">{lesson.hint}</p>
                </div>
              )}
              {attemptedWrong && (
                <button onClick={reset} className="btn-ghost text-sm text-clay">
                  Reintentar
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
