'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import GoogleSignInButton from '@/components/GoogleSignInButton';
import GuestButton from '@/components/GuestButton';

export default function LoginPage() {
  const router = useRouter();
  const { login, loading } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(identifier.trim(), password);
      router.push('/lobby');
    } catch (err: any) {
      setError(err?.message || 'Error iniciando sesión');
    }
  }

  return (
    <section className="flex-1 flex items-center justify-center px-5 py-16">
      <div className="card w-full max-w-md p-8">
        <div className="text-center mb-6">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="text-3xl">♞</span>
            <span className="font-display text-2xl">Ajedrez<span className="text-accent">.co</span></span>
          </Link>
          <h1 className="font-display text-3xl mt-4">Bienvenido de vuelta</h1>
          <p className="text-wood-600 text-sm mt-1">Inicia sesión para entrar al tablero</p>
        </div>

        <GoogleSignInButton redirectTo="/lobby" />
        <Divider />

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">Usuario o email</label>
            <input
              className="input"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <div className="mt-4 flex justify-center">
          <GuestButton className="btn-ghost w-full" hintClassName="text-wood-500 self-center" />
        </div>

        <p className="text-center text-sm text-wood-600 mt-6">
          ¿No tienes cuenta?{' '}
          <Link href="/register" className="text-accent font-medium hover:underline">
            Crear cuenta
          </Link>
        </p>
      </div>
    </section>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 my-5 text-xs uppercase tracking-widest text-wood-400">
      <div className="flex-1 h-px bg-wood-100" />
      <span>o</span>
      <div className="flex-1 h-px bg-wood-100" />
    </div>
  );
}
