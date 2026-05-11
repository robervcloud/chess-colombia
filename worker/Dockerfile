# =====================================================================
# Worker de análisis post-partida — Dockerfile productivo
# =====================================================================
# Cambios respecto al Dockerfile original:
#   - Base slim (más liviana, mismo Debian con apt)
#   - npm ci --omit=dev en vez de npm install
#   - COPY src (no COPY .) -> requiere .dockerignore
#   - Sin EXPOSE (este servicio no es HTTP, es Background Worker)
#   - CMD node directo (propaga SIGTERM correctamente)
#   - Usuario no-root
# =====================================================================
FROM node:20-bookworm-slim

# Stockfish vía apt — queda en /usr/games/stockfish
RUN apt-get update \
 && apt-get install -y --no-install-recommends stockfish ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Capa de dependencias (cache eficiente)
COPY package*.json ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

# Sólo el código fuente (el .dockerignore filtra el resto)
COPY src ./src

# Defaults sensatos; Render los puede sobreescribir en el dashboard
ENV NODE_ENV=production \
    STOCKFISH_PATH=/usr/games/stockfish \
    ENGINE_DEPTH=12 \
    ENGINE_MULTIPV=3 \
    POLL_INTERVAL_MS=4000

# Usuario no-root
RUN useradd -m -u 1001 worker && chown -R worker:worker /app
USER worker

# CMD directo (sin npm) para señales limpias en Render
CMD ["node", "src/index.js"]
