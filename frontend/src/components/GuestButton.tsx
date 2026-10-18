'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

/**
 * "Jugar como invitado": crea una sesión temporal (24 h) sin registro
 * y lleva directo al lobby, con los bots abiertos.
 * Pensado para que cualquiera (por ejemplo, un recruiter) pruebe la
 * plataforma en segundos.
 */
export default function GuestButton({
  className = 'btn-ghost hover-lift',
  label = 'Jugar como invitado',
  showHint = true,
  hintClassName = 'text-wood-500',
}: {
  className?: string;
  label?: string;
  showHint?: boolean;
  hintClassName?: string;
}) {
  const router = useRouter();
  const loginAsGuest = useAuth((s) => s.loginAsGuest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      await loginAsGuest();
      router.push('/lobby');
    } catch (e: any) {
      setError(e?.message || 'No se pudo entrar como invitado');
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={onClick} disabled={busy} className={className}>
        {busy ? 'Entrando…' : label}
      </button>
      {showHint && !error && (
        <span className={`text-xs ${hintClassName}`}>Play as guest · no sign-up</span>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
