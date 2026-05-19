'use client';

import { useEffect, useMemo, useState } from 'react';
import AuthGuard from '@/components/AuthGuard';
import { api } from '@/lib/api';
import type { TacticsInsights, RadarItem } from '@/types/tactics';

const RANGES: Array<[string, string]> = [
  ['1', '1 día'],
  ['7', '7 días'],
  ['30', '30 días'],
  ['60', '60 días'],
  ['90', '90 días'],
  ['all', 'Todo'],
];

export default function PanelPage() {
  return (
    <AuthGuard>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const [range, setRange] = useState('30');
  const [data, setData] = useState<TacticsInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<TacticsInsights>(`/api/tactics/insights?range=${range}`)
      .then((r) => { if (!cancelled) { setData(r); setError(null); } })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Error al cargar'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  return (
    <section className="flex-1 max-w-7xl mx-auto w-full px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-accent font-medium uppercase tracking-widest text-xs">Tácticas</p>
          <h1 className="font-display text-3xl mt-1">Panel de ejercicios</h1>
          <p className="text-wood-600 text-sm mt-1">
            Tu rendimiento real en el rango seleccionado.
          </p>
        </div>
        <a
          href="/tactics"
          className="text-xs uppercase tracking-wider text-wood-600 hover:text-accent transition border-b border-transparent hover:border-accent pb-0.5"
        >
          ← Volver a entrenar
        </a>
      </header>

      {/* Parte 3: filtro temporal */}
      <div className="mb-6 inline-flex flex-wrap rounded-lg p-1 bg-wood-50 ring-1 ring-wood-200/70">
        {RANGES.map(([key, label]) => {
          const active = range === key;
          return (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={[
                'px-3.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200',
                active ? 'bg-parch text-ink shadow-sm' : 'text-wood-600 hover:text-ink',
              ].join(' ')}
              style={active ? { boxShadow: '0 0 16px -6px rgba(201,162,74,0.7)' } : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card-premium p-5 h-24 animate-pulse bg-wood-50/50" />
          ))}
        </div>
      )}

      {data && (
        <>
          {data.lowData && (
            <div className="mb-5 text-xs text-wood-700 bg-gold/10 border border-gold/30 rounded-md px-3 py-2">
              Precisión poco confiable: pocos ejercicios en este rango ({data.totalAttempts}).
              Resuelve más para una lectura estable.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Precisión real" value={data.accuracy === null ? '—' : `${data.accuracy}%`} accent />
            <Metric label="Rating actual" value={data.rating} sub={`±${data.rd}`} />
            <Metric label="Ejercicios" value={data.totalAttempts} sub={`${data.correct} ok · ${data.incorrect} fallos`} />
            <Metric
              label="Rating ganado"
              value={`${data.ratingGain >= 0 ? '+' : ''}${data.ratingGain}`}
              tone={data.ratingGain >= 0 ? 'up' : 'down'}
            />
            <Metric label="Con pista" value={data.withHints} />
            <Metric label="Repetidos" value={data.repeated} />
            <Metric label="Pendientes de repetir" value={data.pendingRepeat} />
            <Metric label="Tiempo medio" value={fmtTime(data.avgTimeMs)} />
          </div>

          {/* Parte 4: radar premium */}
          <div className="card-premium p-6 mt-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display text-lg">Rendimiento por tema</h3>
              <span className="text-[11px] text-wood-500">precisión · volumen</span>
            </div>
            {data.radar.length >= 3 ? (
              <Radar items={data.radar} />
            ) : (
              <p className="text-sm text-wood-600 py-8 text-center">
                Aún no hay suficientes temas con datos en este rango.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Metric({
  label, value, sub, accent, tone,
}: {
  label: string;
  value: any;
  sub?: string;
  accent?: boolean;
  tone?: 'up' | 'down';
}) {
  const color = tone === 'up' ? '#2f9d6e' : tone === 'down' ? '#b4564a' : undefined;
  return (
    <div
      className={`card-premium p-5 ${accent ? 'ring-1 ring-gold/40' : ''}`}
      style={accent ? { boxShadow: '0 0 22px -10px rgba(201,162,74,0.5)' } : undefined}
    >
      <div className="text-[10px] uppercase tracking-widest text-wood-500">{label}</div>
      <div className="font-display text-3xl tabular-nums mt-1" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-wood-500 mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}

/* ===== Parte 4: radar chart SVG premium (sin libs) ===== */
function Radar({ items }: { items: RadarItem[] }) {
  const N = items.length;
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 46;

  const pt = (i: number, r: number) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)] as const;
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const dataPath = useMemo(() => {
    return items
      .map((it, i) => {
        const [x, y] = pt(i, (it.accuracy / 100) * R);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ') + ' Z';
  }, [items]);

  return (
    <div className="w-full flex justify-center overflow-x-auto">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="max-w-full">
        <defs>
          <radialGradient id="radarFill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(232,200,115,0.45)" />
            <stop offset="100%" stopColor="rgba(201,162,74,0.12)" />
          </radialGradient>
        </defs>

        {rings.map((rr, idx) => (
          <polygon
            key={idx}
            points={items.map((_, i) => pt(i, rr * R).join(',')).join(' ')}
            fill="none"
            stroke="rgba(110,74,38,0.16)"
            strokeWidth={1}
          />
        ))}

        {items.map((_, i) => {
          const [x, y] = pt(i, R);
          return (
            <line key={i} x1={cx} y1={cy} x2={x} y2={y}
              stroke="rgba(110,74,38,0.12)" strokeWidth={1} />
          );
        })}

        <path
          d={dataPath}
          fill="url(#radarFill)"
          stroke="#c9a24a"
          strokeWidth={2}
          style={{ filter: 'drop-shadow(0 0 6px rgba(201,162,74,0.5))' }}
        />

        {items.map((it, i) => {
          const [x, y] = pt(i, (it.accuracy / 100) * R);
          return <circle key={i} cx={x} cy={y} r={3} fill="#c9a24a" />;
        })}

        {items.map((it, i) => {
          const [x, y] = pt(i, R + 22);
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9}
              fill="rgba(74,48,26,0.85)"
              style={{ textTransform: 'capitalize' }}
            >
              {prettyTheme(it.theme)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function prettyTheme(t: string) {
  return t.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}
function fmtTime(ms: number) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
