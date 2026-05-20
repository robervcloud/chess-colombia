/**
 * Cliente HTTP minimalista. Le pega al backend y agrega el JWT
 * automáticamente si está en localStorage.
 */
const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
// Log sólo en desarrollo. En producción no ensucia consola.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line no-console
  console.log('[API_BASE]', BASE);
}

export const TOKEN_KEY = 'chess_co_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || 'GET',
    headers,
    body:
      typeof opts.body === 'string'
        ? opts.body
        : opts.body
          ? JSON.stringify(opts.body)
          : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data && (data.error as string)) || `Error ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export const API_BASE = BASE;
