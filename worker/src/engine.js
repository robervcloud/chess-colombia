/**
 * Wrapper de Stockfish vía UCI sobre child_process.
 *
 * Diseño:
 *   - Una sola instancia del motor para toda la vida del worker (más
 *     rápido que reiniciarlo por partida).
 *   - Cola interna en memoria: sólo un `analyze()` corre a la vez sobre
 *     el motor. Llamadas concurrentes se serializan.
 *   - Si el motor muere/crashea, `analyze()` rechaza y main() puede
 *     reiniciarlo.
 */
const { spawn } = require('child_process');
const { Chess } = require('chess.js');

class StockfishEngine {
  constructor(opts = {}) {
    this.path = opts.path || process.env.STOCKFISH_PATH || 'stockfish';
    this.depth = opts.depth || parseInt(process.env.ENGINE_DEPTH || '15', 10);
    this.multipv = opts.multipv || parseInt(process.env.ENGINE_MULTIPV || '3', 10);
    this.proc = null;
    this.buffer = '';
    this.listeners = [];
    this.queue = Promise.resolve();
    this.alive = false;
  }

  async init() {
    return new Promise((resolve, reject) => {
      try {
        this.proc = spawn(this.path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        return reject(this._setupError(e));
      }
      this.proc.on('error', (err) => {
        this.alive = false;
        reject(this._setupError(err));
      });
      this.proc.on('exit', (code) => {
        this.alive = false;
        // Si quedan listeners, rechazarlos
        for (const l of this.listeners.splice(0)) {
          if (l.reject) l.reject(new Error(`Stockfish exited (code=${code})`));
        }
      });
      this.proc.stdout.on('data', (chunk) => this._onChunk(chunk));
      // stderr a veces lleva el banner inicial; no lo necesitamos.
      this.proc.stderr.on('data', () => {});

      this._send('uci');
      this._waitFor((l) => l === 'uciok')
        .then(() => {
          this._send(`setoption name MultiPV value ${this.multipv}`);
          this._send('isready');
          return this._waitFor((l) => l === 'readyok');
        })
        .then(() => {
          this.alive = true;
          resolve();
        })
        .catch(reject);
    });
  }

  _setupError(err) {
    return new Error(
      `No se pudo iniciar Stockfish en "${this.path}". ` +
        `Instalación: apt install stockfish (Linux) | brew install stockfish (macOS). ` +
        `O define STOCKFISH_PATH apuntando al binario. (${err.message || err})`
    );
  }

  _onChunk(chunk) {
    this.buffer += chunk.toString('utf8');
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length > 0) this._dispatch(line);
    }
  }

  _send(cmd) {
    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error('Stockfish stdin no está disponible');
    }
    this.proc.stdin.write(cmd + '\n');
  }

  _waitFor(matcher, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      const tid = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l._tid !== tid);
        reject(new Error('Engine timeout'));
      }, timeoutMs);
      this.listeners.push({
        _tid: tid,
        match: (line) => matcher(line),
        resolve: (line) => {
          clearTimeout(tid);
          resolve(line);
        },
        reject: (err) => {
          clearTimeout(tid);
          reject(err);
        },
      });
    });
  }

  _dispatch(line) {
    // Iterar en reversa porque puede haber splices.
    for (let i = this.listeners.length - 1; i >= 0; i--) {
      const l = this.listeners[i];
      if (l.collect) l.collect(line);
      if (l.match(line)) {
        this.listeners.splice(i, 1);
        l.resolve(line);
      }
    }
  }

  /**
   * Analiza una posición FEN.
   * Devuelve { bestMove, bestMoveSan, cp, mate, lines: [{rank,moves[],cp,mate}] }
   * Todos los valores numéricos están en POV de las BLANCAS.
   */
  async analyze(fen, depth = this.depth) {
    // Serializar las llamadas: una a la vez sobre el mismo motor.
    const job = this.queue.then(() => this._analyzeOne(fen, depth));
    this.queue = job.catch(() => {}); // si falla, no rompemos la cadena
    return job;
  }

  /**
   * Pide la mejor jugada para una posición, con `Skill Level` (0-20)
   * de Stockfish para simular fuerza humana. Usado por los bots.
   * Devuelve un UCI string (ej. 'e2e4', 'e7e8q').
   */
  async bestMove({ fen, skill = 10, depth = 8, moveTimeMs = 0 } = {}) {
    const job = this.queue.then(() => this._bestMoveOne(fen, skill, depth, moveTimeMs));
    this.queue = job.catch(() => {});
    return job;
  }

  _bestMoveOne(fen, skill, depth, moveTimeMs) {
    if (!this.alive) return Promise.reject(new Error('Engine no vivo'));
    return new Promise((resolve, reject) => {
      const tid = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l._tid !== tid);
        reject(new Error('bestMove timeout'));
      }, 30_000);

      this.listeners.push({
        _tid: tid,
        match: (line) => line.startsWith('bestmove '),
        resolve: (bestmoveLine) => {
          clearTimeout(tid);
          const parts = bestmoveLine.split(/\s+/);
          const uci = parts[1];
          if (!uci || uci === '(none)') return reject(new Error('sin jugada'));
          resolve(uci);
        },
        reject,
      });

      try {
        // Skill Level: 0 (peor) … 20 (mejor)
        const s = Math.max(0, Math.min(20, skill | 0));
        this._send(`setoption name Skill Level value ${s}`);
        this._send('ucinewgame');
        this._send(`position fen ${fen}`);
        if (moveTimeMs > 0) this._send(`go movetime ${moveTimeMs}`);
        else                this._send(`go depth ${depth}`);
      } catch (err) {
        clearTimeout(tid);
        reject(err);
      }
    });
  }

  _analyzeOne(fen, depth) {
    if (!this.alive) return Promise.reject(new Error('Engine no vivo'));
    return new Promise((resolve, reject) => {
      const infoLines = [];
      const tid = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l._tid !== tid);
        reject(new Error('Engine analyze timeout'));
      }, 90_000);

      this.listeners.push({
        _tid: tid,
        collect: (line) => {
          if (line.startsWith('info ')) infoLines.push(line);
        },
        match: (line) => line.startsWith('bestmove '),
        resolve: (bestmoveLine) => {
          clearTimeout(tid);
          try {
            resolve(parseAnalysis(fen, infoLines, bestmoveLine));
          } catch (err) {
            reject(err);
          }
        },
        reject,
      });

      try {
        this._send('ucinewgame');
        this._send(`position fen ${fen}`);
        this._send(`go depth ${depth}`);
      } catch (err) {
        clearTimeout(tid);
        reject(err);
      }
    });
  }

  quit() {
    this.alive = false;
    if (this.proc) {
      try {
        this.proc.stdin.write('quit\n');
      } catch {}
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
  }
}

// =====================================================================
// Parseo de líneas UCI
// =====================================================================
function parseAnalysis(fen, infoLines, bestmoveLine) {
  const sideToMove = fen.split(' ')[1] || 'w';

  // Quedarse con la línea de mayor depth POR multipv
  const byMultipv = new Map();
  for (const raw of infoLines) {
    const depth = matchInt(raw, /\bdepth (\d+)/);
    const multipv = matchInt(raw, /\bmultipv (\d+)/);
    if (depth === null || multipv === null) continue;

    const cp = matchInt(raw, /\bscore cp (-?\d+)/);
    const mate = matchInt(raw, /\bscore mate (-?\d+)/);

    // pv viene al final; el resto de tokens están antes.
    const pvIdx = raw.indexOf(' pv ');
    let pv = [];
    if (pvIdx >= 0) {
      pv = raw.slice(pvIdx + 4).trim().split(/\s+/);
    }

    const prev = byMultipv.get(multipv);
    if (!prev || prev.depth < depth) {
      byMultipv.set(multipv, { depth, cp, mate, pv });
    }
  }

  // Convertir UCI->SAN para cada línea
  const lines = [...byMultipv.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rank, info]) => {
      const sans = uciSequenceToSan(fen, info.pv);
      return {
        rank,
        moves: sans,
        cp: normalizeToWhite(info.cp, sideToMove),
        mate: info.mate !== null ? normalizeMateToWhite(info.mate, sideToMove) : null,
      };
    });

  // bestmove uci
  const bmTokens = bestmoveLine.split(/\s+/);
  const bestUci = bmTokens[1];
  let bestMoveSan = null;
  if (bestUci && bestUci !== '(none)') {
    bestMoveSan = uciSequenceToSan(fen, [bestUci])[0] || null;
  }

  const top = lines[0] || { cp: 0, mate: null };
  return {
    bestMove: bestUci || null,
    bestMoveSan,
    cp: top.cp,    // POV blancas
    mate: top.mate, // POV blancas
    lines,
  };
}

function uciSequenceToSan(fen, uciList) {
  if (!uciList || uciList.length === 0) return [];
  const c = new Chess(fen);
  const out = [];
  for (const uci of uciList) {
    if (uci.length < 4) break;
    const move = {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length >= 5 ? uci.slice(4, 5) : undefined,
    };
    let m;
    try {
      m = c.move(move);
    } catch {
      break;
    }
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

function matchInt(s, re) {
  const m = s.match(re);
  return m ? parseInt(m[1], 10) : null;
}

function normalizeToWhite(cp, sideToMove) {
  if (cp === null || cp === undefined) return null;
  return sideToMove === 'w' ? cp : -cp;
}

function normalizeMateToWhite(n, sideToMove) {
  // mate N desde POV side-to-move; si negras a mover, invertir signo
  return sideToMove === 'w' ? n : -n;
}

module.exports = { StockfishEngine, parseAnalysis };
