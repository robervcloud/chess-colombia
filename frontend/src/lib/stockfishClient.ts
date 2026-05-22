/**
 * Cliente Stockfish (WASM) para análisis live en el navegador.
 *
 * Mejoras vs. versión anterior:
 *   - worker.onerror se loggea (antes fallaba silencioso).
 *   - createStockfish() tiene timeout duro de inicialización.
 *   - Nueva función analyzeOne(fen, opts) que resuelve UNA promesa por
 *     posición, con timeout y soporte de AbortSignal para cancelar
 *     loops largos (modo "Analizar partida" del PGN).
 *   - Logging mínimo y útil en consola: ready/error/timeout/done.
 *   - Carga desde CDN jsdelivr; documentado cómo bajar a /public para
 *     deploy autocontenido.
 */

const WASM_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';
const INIT_TIMEOUT_MS     = 20_000;
const POSITION_TIMEOUT_MS = 15_000;

export type SfInfo = {
  depth: number;
  multipv: number;
  cp: number | null;
  mate: number | null;
  pv: string[];
};

export interface StockfishHandle {
  setPosition: (fen: string) => void;
  analyze: (opts?: { depth?: number; multipv?: number }) => void;
  stop: () => void;
  onInfo:  (cb: (info: SfInfo[]) => void) => void;
  onError: (cb: (err: string) => void) => void;
  analyzeOne: (fen: string, opts?: AnalyzeOneOpts) => Promise<SfInfo[]>;
  destroy: () => void;
}
export interface AnalyzeOneOpts {
  depth?: number;
  multipv?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const log = (...args: any[]) => {
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[stockfish]', ...args);
  }
};

export async function createStockfish(): Promise<StockfishHandle> {
  const workerCode = `
    try { importScripts('${WASM_URL}'); }
    catch (e) { self.postMessage('LOAD_ERROR: ' + (e && e.message ? e.message : String(e))); }
  `;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const worker = new Worker(URL.createObjectURL(blob));

  let infoCb:  ((info: SfInfo[]) => void) | null = null;
  let errorCb: ((err: string)   => void) | null = null;
  const multipvBuf = new Map<number, SfInfo>();
  let lastEmit = 0;

  worker.onerror = (e) => {
    const msg = `worker error: ${e.message || 'unknown'}`;
    log('error', msg);
    if (errorCb) errorCb(msg);
  };

  worker.onmessage = (e: MessageEvent<any>) => {
    const line = typeof e.data === 'string' ? e.data : e.data?.data;
    if (typeof line !== 'string') return;

    if (line.startsWith('LOAD_ERROR')) {
      log('error', line);
      if (errorCb) errorCb(line);
      return;
    }
    if (line.startsWith('info ')) {
      const parsed = parseInfo(line);
      if (!parsed) return;
      multipvBuf.set(parsed.multipv, parsed);
      const now = Date.now();
      if (now - lastEmit > 80 && infoCb) {
        lastEmit = now;
        infoCb([...multipvBuf.values()].sort((a, b) => a.multipv - b.multipv));
      }
    } else if (line.startsWith('bestmove') && infoCb) {
      infoCb([...multipvBuf.values()].sort((a, b) => a.multipv - b.multipv));
    }
  };

  try {
    await sendAndWait(worker, 'uci', /^uciok$/, INIT_TIMEOUT_MS);
  } catch (e: any) {
    log('init timeout', e?.message);
    try { worker.terminate(); } catch {}
    throw new Error('Stockfish no respondió en tiempo. Recargá la página.');
  }

  worker.postMessage('setoption name MultiPV value 3');
  worker.postMessage('isready');
  try { await sendAndWait(worker, 'isready', /^readyok$/, 5000); }
  catch { log('warn: readyok no llegó, continuando'); }
  log('ready');

  function setPosition(fen: string) {
    multipvBuf.clear();
    worker.postMessage('stop');
    worker.postMessage(`position fen ${fen}`);
  }
  function analyze({ depth = 16, multipv = 3 }: { depth?: number; multipv?: number } = {}) {
    worker.postMessage(`setoption name MultiPV value ${multipv}`);
    worker.postMessage(`go depth ${depth}`);
  }
  function stop() { worker.postMessage('stop'); }
  function onInfo(cb: (info: SfInfo[]) => void)  { infoCb  = cb; }
  function onError(cb: (err: string) => void)    { errorCb = cb; }
  function destroy() {
    infoCb = null; errorCb = null;
    try { worker.postMessage('quit'); } catch {}
    worker.terminate();
    log('destroyed');
  }

  // ---- Cache LRU de posiciones (analyzeOne) ----
  // Evita reanalizar FENs ya vistos en el loop de review o navegación.
  // Cap a 256 entradas; FIFO al exceder.
  const evalCache = new Map<string, SfInfo[]>();
  const cacheKey = (fen: string, depth: number, multipv: number) => `${depth}|${multipv}|${fen}`;
  function cacheGet(key: string): SfInfo[] | null {
    if (!evalCache.has(key)) return null;
    const v = evalCache.get(key)!;
    // refresh LRU: re-set para moverlo al final
    evalCache.delete(key);
    evalCache.set(key, v);
    return v;
  }
  function cachePut(key: string, value: SfInfo[]) {
    evalCache.set(key, value);
    if (evalCache.size > 256) {
      const first = evalCache.keys().next().value;
      if (first !== undefined) evalCache.delete(first);
    }
  }

  function analyzeOne(fen: string, opts: AnalyzeOneOpts = {}): Promise<SfInfo[]> {
    const depth     = opts.depth     ?? 14;
    const multipv   = opts.multipv   ?? 3;
    const timeoutMs = opts.timeoutMs ?? POSITION_TIMEOUT_MS;
    const signal    = opts.signal;

    // Cache hit → resolve inmediato (mismo fen/depth/multipv)
    const key = cacheKey(fen, depth, multipv);
    const cached = cacheGet(key);
    if (cached) {
      // notificar al onInfo global para que la UI refleje el resultado
      if (infoCb) {
        try { infoCb(cached); } catch {}
      }
      return Promise.resolve(cached);
    }

    return new Promise<SfInfo[]>((resolve, reject) => {
      const localBuf = new Map<number, SfInfo>();
      let done = false;
      let timer: any = null;

      const cleanup = () => {
        worker.removeEventListener('message', onMsg);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
      };
      const finish = (info: SfInfo[]) => {
        if (done) return;
        done = true; cleanup();
        // Guardar en cache solo si tenemos datos completos
        if (info.length > 0) cachePut(key, info);
        resolve(info);
      };
      const fail = (err: Error) => {
        if (done) return;
        done = true; cleanup();
        try { worker.postMessage('stop'); } catch {}
        reject(err);
      };

      const onMsg = (e: MessageEvent<any>) => {
        const line = typeof e.data === 'string' ? e.data : e.data?.data;
        if (typeof line !== 'string') return;
        if (line.startsWith('info ')) {
          const p = parseInfo(line);
          if (p) {
            localBuf.set(p.multipv, p);
            if (infoCb) {
              const now = Date.now();
              if (now - lastEmit > 80) {
                lastEmit = now;
                infoCb([...localBuf.values()].sort((a, b) => a.multipv - b.multipv));
              }
            }
          }
        } else if (line.startsWith('bestmove')) {
          const final = [...localBuf.values()].sort((a, b) => a.multipv - b.multipv);
          if (infoCb) infoCb(final);
          finish(final);
        }
      };
      const onAbort = () => fail(new Error('aborted'));

      if (signal?.aborted) return fail(new Error('aborted'));
      signal?.addEventListener('abort', onAbort);

      worker.addEventListener('message', onMsg);
      try { worker.postMessage('stop'); } catch {}
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`setoption name MultiPV value ${multipv}`);
      worker.postMessage(`go depth ${depth}`);

      timer = setTimeout(() => {
        log('timeout on position', fen.slice(0, 24) + '…');
        try { worker.postMessage('stop'); } catch {}
        if (localBuf.size > 0) {
          finish([...localBuf.values()].sort((a, b) => a.multipv - b.multipv));
        } else {
          fail(new Error('timeout'));
        }
      }, timeoutMs);
    });
  }

  return { setPosition, analyze, stop, onInfo, onError, analyzeOne, destroy };
}

function sendAndWait(worker: Worker, cmd: string, match: RegExp, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      worker.removeEventListener('message', listener);
      reject(new Error(`timeout esperando ${match}`));
    }, timeoutMs);
    function listener(e: MessageEvent<any>) {
      const line = typeof e.data === 'string' ? e.data : e.data?.data;
      if (typeof line === 'string' && match.test(line.trim())) {
        clearTimeout(to);
        worker.removeEventListener('message', listener);
        resolve();
      }
    }
    worker.addEventListener('message', listener);
    worker.postMessage(cmd);
  });
}

function parseInfo(line: string): SfInfo | null {
  const tokens = line.split(/\s+/);
  let depth = 0, multipv = 1;
  let cp: number | null = null, mate: number | null = null;
  let pv: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth')        depth   = parseInt(tokens[++i], 10);
    else if (t === 'multipv') multipv = parseInt(tokens[++i], 10);
    else if (t === 'score') {
      const kind = tokens[++i];
      const val  = parseInt(tokens[++i], 10);
      if      (kind === 'cp')   cp = val;
      else if (kind === 'mate') mate = val;
    } else if (t === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
  }
  if (!depth) return null;
  return { depth, multipv, cp, mate, pv };
}
