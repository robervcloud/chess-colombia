'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Navbar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // No mostramos navbar en login/register
  if (pathname === '/login' || pathname === '/register') return null;

  function onLogout() {
    logout();
    router.push('/login');
  }

  return (
    <header className="border-b border-wood-100 bg-parch/80 backdrop-blur sticky top-0 z-30">
      <nav className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link href={user ? '/lobby' : '/'} className="flex items-center gap-2 group">
          <span className="text-2xl">♞</span>
          <span className="font-display text-xl tracking-tight">
            Ajedrez<span className="text-accent">.co</span>
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-4">
          {user ? (
            <>
              <Link
                href="/lobby"
                className={`text-sm font-medium hover:text-accent transition ${
                  pathname === '/lobby' ? 'text-accent' : 'text-wood-800'
                }`}
              >
                Jugar
              </Link>
              <Link
                href="/aprender"
                className={`text-sm font-medium hover:text-accent transition ${
                  pathname?.startsWith('/aprender') ? 'text-accent' : 'text-wood-800'
                }`}
              >
                Aprender
              </Link>
              <Link
                href="/tactics"
                className={`text-sm font-medium hover:text-accent transition ${
                  pathname?.startsWith('/tactics') ? 'text-accent' : 'text-wood-800'
                }`}
              >
                Tácticas
              </Link>
              <Link
                href="/analyze"
                className={`text-sm font-medium hover:text-accent transition ${
                  pathname?.startsWith('/analyze') ? 'text-accent' : 'text-wood-800'
                }`}
              >
                Analizar
              </Link>
              <Link
                href="/history"
                className={`text-sm font-medium hover:text-accent transition ${
                  pathname?.startsWith('/history') ? 'text-accent' : 'text-wood-800'
                }`}
              >
                Historial
              </Link>
              <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-wood-200">
                <span className="text-sm text-wood-600">
                  {user.username} <span className="text-wood-400">·</span>{' '}
                  <span className="font-medium">{user.rating}</span>
                </span>
              </div>
              <button onClick={onLogout} className="btn-ghost py-1.5 px-3 text-sm">
                Salir
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost py-1.5 px-3 text-sm">
                Iniciar sesión
              </Link>
              <Link href="/register" className="btn-primary py-1.5 px-3 text-sm">
                Crear cuenta
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
