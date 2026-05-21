import type { Metadata } from 'next';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import '@/app/globals.css';
import Navbar from '@/components/Navbar';

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const body = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ajedrez.co — Plataforma de ajedrez online de Colombia',
  description: 'Juega ajedrez en tiempo real con jugadores colombianos o de todo el mundo.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable}`}>
      <body className="font-sans antialiased min-h-screen flex flex-col surface-haze bg-grain">
        <Navbar />
        <main className="flex-1 flex flex-col">{children}</main>
        <footer className="border-t border-wood-100 py-6 text-center text-sm text-wood-600">
          Ajedrez.co · MVP · Hecho con ♞ en Colombia
        </footer>
      </body>
    </html>
  );
}
