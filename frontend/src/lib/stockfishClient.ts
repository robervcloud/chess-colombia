/**
 * Cliente Stockfish para análisis LIVE en el cliente.
 *
 * Decisión de arquitectura:
 *   El "Stockfish actual" del proyecto vive en un worker remoto (Render)
 *   que persiste en DB vía polling. Es excelente para análisis batch de
 *   partidas terminadas, pero NO sirve para análisis en tiempo real
 *   mientras el usuario explora variantes (latencia + cold start).
 *
 *   Para el sandbox de /analyze usamos Stockfish vía WebAssembly EN EL
 *   CLIENTE, cargado on-demand SOLO en esta ruta (dynamic import). No
 *   afecta el bundle de otras páginas. Comparte la MISMA lógica de
 *   clasificación / accuracy / eval bar — sólo cambia la ubicación del
 *   motor para el caso de uso "tiempo real".
 *
 * Carga: desde CDN jsdelivr (sin npm install, sin assets en /public).
 *        Si querés deploy más estable, bajá los archivos a /public y
 *        cambiá WASM_URL a relativo.
 */

const WASM_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';

export type SfInfo = {
  depth: number;
  multipv: number;
  cp: number | null;    // POV side-to-move
  mate: number | null;  // POV side-to-move
  pv: string[];         // UCI moves
};

export interface StockfishHandle {
  setPosition: (fen: string) => void;
  analyze: (opts?: { depth?: number; multipv?: number }) => void;
  stop: () => void;
  onInfo: (cb: (info: SfInfo[]) => void) => void;  // top N líneas actualizadas
  destroy: () => void;
}

export async function createStockfish(): Promise<StockfishHandle> {
  // Stockfish.js es un script monolítico que cuando se importa en un
  // Worker dispara `onmessage` con líneas UCI. Lo cargamos en un worker
  // inline para no bloquear UI.
  const workerCode = `importScripts('${WASM_URL}');`;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const worker = new Worker(URL.createObjectURL(blob));

  // Estado de las líneas (multipv); reset cada nueva posición.
  let infoCb: ((info: SfInfo[]) => void) | null = null;
  let multipvBuf = new Map<number, SfInfo>();
  let lastEmit = 0;

  worker.onmessage = (e: MessageEvent<string>) => {
    const line = typeof e.data === 'string' ? e.data : (e.data as any)?.data;
    if (!line) return;
    if (line.startsWith('info ')) {
      const parsed = parseInfo(line);
      if (!parsed) return;
      multipvBuf.set(parsed.multipv, parsed);
      const now = Date.now();
      // throttle: emitir como mucho cada 80ms para no saturar React
      if (now - lastEmit > 80 && infoCb) {
        lastEmit = now;
        infoCb([...multipvBuf.values()].sort((a, b) => a.multipv - b.multipv));
      }
    } else if (line.startsWith('bestmove') && infoCb) {
      // flush final
      infoCb([...multipvBuf.values()].sort((a, b) => a.multipv - b.multipv));
    }
  };

  // Esperar a que Stockfish responda "uciok" para considerarlo listo
  await sendAndWait(worker, 'uci', /^uciok$/);
  worker.postMessage('setoption name MultiPV value 3');
  worker.postMessage('isready');
  await sendAndWait(worker, 'isready', /^readyok$/);

  function setPosition(fen: string) {
    multipvBuf.clear();
    worker.postMessage('stop');
    worker.postMessage(`position fen ${fen}`);
  }
  function analyze({ depth = 16, multipv = 3 }: { depth?: number; multipv?: number } = {}) {
    worker.postMessage(`setoption name MultiPV value ${multipv}`);
    worker.postMessage(`go depth ${depth}`);
  }
  function stop() {
    worker.postMessage('stop');
  }
  function onInfo(cb: (info: SfInfo[]) => void) {
    infoCb = cb;
  }
  function destroy() {
    infoCb = null;
    try { worker.postMessage('quit'); } catch {}
    worker.terminate();
  }

  return { setPosition, analyze, stop, onInfo, destroy };
}

function sendAndWait(worker: Worker, cmd: string, match: RegExp, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      worker.removeEventListener('message', listener);
      reject(new Error(`Stockfish timeout esperando ${match}`));
    }, timeoutMs);
    function listener(e: MessageEvent<string>) {
      const line = typeof e.data === 'string' ? e.data : (e.data as any)?.data;
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
  // ex: "info depth 14 multipv 1 score cp 23 nodes ... pv e2e4 c7c5 ..."
  const tokens = line.split(/\s+/);
  let depth = 0, multipv = 1;
  let cp: number | null = null, mate: number | null = null;
  let pv: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth')   depth = parseInt(tokens[++i], 10);
    else if (t === 'multipv') multipv = parseInt(tokens[++i], 10);
    else if (t === 'score') {
      const kind = tokens[++i];
      const val = parseInt(tokens[++i], 10);
      if (kind === 'cp') cp = val;
      else if (kind === 'mate') mate = val;
    } else if (t === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
  }
  if (!depth) return null;
  return { depth, multipv, cp, mate, pv };
}
