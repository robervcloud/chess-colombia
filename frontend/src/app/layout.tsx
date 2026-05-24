import type { Metadata } from 'next';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import { AndeanMotif } from '@/components/AndeanMotif';

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
        <footer className="relative border-t border-wood-100 py-8 text-center text-sm text-wood-600 overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 opacity-50 text-wood-300">
            <AndeanMotif variant="banner" className="w-full h-full" />
          </div>
          <div className="relative">
            <p className="font-medium text-wood-700">
              Ajedrez.co
              <span className="mx-2 text-gold">·</span>
              Una plataforma colombiana
            </p>
            <p className="text-xs text-wood-500 mt-1.5 tracking-wide">
              Hecho con <span className="text-accent">♞</span> entre montañas, café y código
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
