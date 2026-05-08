'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import GoogleSignInButton from '@/components/GoogleSignInButton';

export default function RegisterPage() {
  const router = useRouter();
  const { register, loading } = useAuth();

  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    country: 'CO',
  });
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register({
        username: form.username.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        country: form.country.toUpperCase(),
      });
      router.push('/lobby');
    } catch (err: any) {
      setError(err?.message || 'Error al registrarse');
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
          <h1 className="font-display text-3xl mt-4">Crea tu cuenta</h1>
          <p className="text-wood-600 text-sm mt-1">Es gratis y toma menos de un minuto</p>
        </div>

        <GoogleSignInButton redirectTo="/lobby" />
        <Divider />

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">Usuario</label>
            <input
              className="input"
              minLength={3}
              maxLength={30}
              pattern="[a-zA-Z0-9_-]+"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
            <p className="text-xs text-wood-600 mt-1">Letras, números, guion y guion bajo. 3-30 caracteres.</p>
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input
              className="input"
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
            <p className="text-xs text-wood-600 mt-1">Mínimo 8 caracteres.</p>
          </div>
          <div>
            <label className="label">País</label>
            <select
              className="input"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
            >
              <option value="CO">🇨🇴 Colombia</option>
              <option value="MX">🇲🇽 México</option>
              <option value="AR">🇦🇷 Argentina</option>
              <option value="PE">🇵🇪 Perú</option>
              <option value="CL">🇨🇱 Chile</option>
              <option value="EC">🇪🇨 Ecuador</option>
              <option value="VE">🇻🇪 Venezuela</option>
              <option value="ES">🇪🇸 España</option>
              <option value="US">🇺🇸 Estados Unidos</option>
              <option value="OT">🌍 Otro</option>
            </select>
          </div>

          {error && (
            <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Creando…' : 'Crear cuenta'}
          </button>
        </form>

        <p className="text-center text-sm text-wood-600 mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-accent font-medium hover:underline">
            Iniciar sesión
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
