/**
 * Configura la app Express. La separamos del `server.js` para
 * poder testear más fácil y para que `server.js` sólo se encargue
 * del bootstrap del servidor HTTP + Socket.io.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const env = require('./config/env');
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/games');
const tacticsRoutes = require('./routes/tactics');
const analyzeRoutes = require('./routes/analyze');
const profileRoutes = require('./routes/profile');
const friendsRoutes = require('./routes/friends');
const studiesRoutes = require('./routes/studies');
const { errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();

// Detrás del proxy de Render: confiar en 1 nivel para que req.ip
// devuelva la IP real del cliente (necesario para rate limiting).
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: env.clientOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '64kb' }));
app.use(apiLimiter);

// Healthcheck
app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/auth', authRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/tactics', tacticsRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/studies', studiesRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Errores
app.use(errorHandler);

module.exports = app;
