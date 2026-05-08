'use client';

/**
 * Botón de "Iniciar sesión con Google".
 *
 * Carga el script de Google Identity Services una sola vez,
 * inicializa con el Client ID público y renderiza el botón
 * oficial. Cuando el usuario completa el flujo, recibimos un
 * `credential` (ID Token) que se manda al backend.
 *
 * Si NEXT_PUBLIC_GOOGLE_CLIENT_ID está vacío, el botón no
 * se muestra (degradación silenciosa).
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

declare global {
  interface Window {
    google?: any;
    __chess_co_google_loaded__?: boolean;
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve();
    if (window.__chess_co_google_loaded__) return resolve();
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => {
        window.__chess_co_google_loaded__ = true;
        resolve();
      });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      window.__chess_co_google_loaded__ = true;
      resolve();
    };
    s.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'));
    document.head.appendChild(s);
  });
}

export default function GoogleSignInButton({
  redirectTo = '/lobby',
}: {
  redirectTo?: string;
}) {
  const router = useRouter();
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    (async () => {
      try {
        await loadScript(GSI_SRC);
        if (cancelled || !window.google?.accounts?.id) return;

        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response: { credential?: string }) => {
            if (!response?.credential) {
              setError('Google no devolvió un token válido.');
              return;
            }
            setBusy(true);
            setError(null);
            try {
              await loginWithGoogle(response.credential);
              router.push(redirectTo);
            } catch (err: any) {
              setError(err?.message || 'Error iniciando sesión con Google');
            } finally {
              setBusy(false);
            }
          },
        });

        if (containerRef.current) {
          window.google.accounts.id.renderButton(containerRef.current, {
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            width: containerRef.current.clientWidth || 320,
          });
        }
      } catch (e: any) {
        setError(e?.message || 'Error cargando Google Sign-In');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loginWithGoogle, router, redirectTo]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div className="space-y-2">
      <div ref={containerRef} className={busy ? 'opacity-50 pointer-events-none' : ''} />
      {error && (
        <p className="text-xs text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
