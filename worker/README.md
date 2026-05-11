# Worker de análisis post-partida

Proceso **separado** del backend principal. Su única función es:
consumir partidas terminadas, analizarlas con Stockfish, y guardar los
resultados en la tabla `game_analyses`.

```
┌──────────┐  game terminada   ┌─────────────┐
│ backend  │ ────────────────▶ │ game_analyses│ (status='pending')
└──────────┘                   └──────┬──────┘
                                      │ polling
                                      ▼
                          ┌──────────────────┐
                          │ worker/index.js  │  ← ESTE PROCESO
                          │   + Stockfish    │
                          └────────┬─────────┘
                                   │ UPDATE
                                   ▼
                            game_analyses
                            (status='done')
```

## Requisitos

- Node 18+
- Stockfish instalado:
  - **Linux (Debian/Ubuntu):** `apt-get install stockfish` → binario en `/usr/games/stockfish` o `/usr/bin/stockfish`.
  - **macOS:** `brew install stockfish` → en `/opt/homebrew/bin/stockfish`.
  - **Windows / otros:** descargar de https://stockfishchess.org/download/

Verifica que el binario está en el PATH:
```bash
stockfish
> uci
> quit
```

## Setup

```bash
cd worker
cp .env.example .env
# Llenar SUPABASE_URL, SUPABASE_SERVICE_KEY, STOCKFISH_PATH (si no está en el PATH)
npm install
npm start
```

## Variables de entorno

| Variable               | Default     | Notas                                    |
|------------------------|-------------|------------------------------------------|
| `SUPABASE_URL`         | (req.)      | Mismo proyecto que el backend            |
| `SUPABASE_SERVICE_KEY` | (req.)      | service_role; nunca exponer al cliente   |
| `STOCKFISH_PATH`       | `stockfish` | Ruta al binario                          |
| `ENGINE_DEPTH`         | `12`        | 12-15 razonable. Más alto = más lento    |
| `ENGINE_MULTIPV`       | `3`         | Número de líneas por posición            |
| `POLL_INTERVAL_MS`     | `4000`      | Cada cuánto buscar trabajo si no hay     |
| `MAX_PLIES`            | `200`       | Tope de jugadas a analizar por partida   |

## Cómo funciona el reclamo de trabajo

`db.js` invoca el RPC `claim_pending_analysis` (definido en
`database/migration_002_analysis.sql`). Ese SQL hace:

```sql
SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1
UPDATE → status='running'
RETURN game_id, pgn (joined)
```

Esto permite **múltiples workers concurrentes** sin race conditions:
cada uno se queda con un row distinto.

## Despliegue gratuito

### Opción A — Render (recomendado)

En Render Dashboard:
1. **New +** → **Background Worker**.
2. Conectar el mismo repo.
3. **Root Directory:** `worker`
4. **Build Command:**
   ```bash
   apt-get update && apt-get install -y stockfish && npm install
   ```
   (Render acepta `apt-get` durante el build.)
5. **Start Command:** `npm start`
6. Variables de entorno: copiar las de `.env.example`.
7. Plan: el "Starter" gratuito alcanza para análisis razonable; si lo
   subes a paid, sube `ENGINE_DEPTH` para análisis más fino.

### Opción B — Local en la misma máquina (dev)

```bash
# Terminal 1 (backend)
cd backend && npm run dev

# Terminal 2 (worker)
cd worker && npm start
```

## Métricas que produce

Por cada jugada:
- `evalBefore` / `evalAfter` (centipawns, POV blancas)
- `mateBefore` / `mateAfter` (null o `+N` / `-N`)
- `bestMoveSan` y `bestMoveUci` (la sugerencia del motor)
- `lines`: top 3 continuaciones desde la posición previa
- `centipawnLoss`
- `classification`: `best | excellent | good | inaccuracy | mistake | blunder`
- `isMateDetected`

Resumen agregado:
- `accuracyWhite`, `accuracyBlack` (fórmula Lichess)
- `blunders/mistakes/inaccuracies` por color
- `bestMoves` por color

Estimación de Elo:
- Heurístico simple basado en accuracy + nº blunders/mistakes
- Documentado claramente como "estimación de nivel de juego, no Elo oficial"
- Rango 600–2400, con regresión a la media en partidas cortas (<10 jugadas)

## Diagnóstico

Logs típicos de un análisis exitoso:
```
[worker] Procesando 8d4f...e1 ...
[worker]   8d4f...e1: 41/41 posiciones
[worker] ✓ 8d4f...e1 en 14.7s (W:88.3% B:81.4%, Elo W:1620 B:1380)
```

Si Stockfish no se encuentra:
```
[worker] No pude iniciar el motor. Abortando.
         No se pudo iniciar Stockfish en "stockfish". Instalación: ...
```
→ Confirmar el binario o setear `STOCKFISH_PATH=/ruta/al/stockfish`.

Para reintentar análisis fallidos:
```sql
update game_analyses set status='pending', error_message=null
where status='failed';
```
