# Frontend - Chess Colombia

Next.js 14 (App Router) + TypeScript + TailwindCSS.
Tablero con `react-chessboard` y comunicación en tiempo real con `socket.io-client`.

## Estructura

```
src/
├── app/                 # rutas (App Router)
│   ├── page.tsx         # landing
│   ├── login/           # /login
│   ├── register/        # /register
│   ├── lobby/           # /lobby (matchmaking)
│   ├── game/[id]/       # /game/:id (partida en vivo)
│   └── history/         # /history
├── components/
│   ├── Navbar.tsx
│   ├── ChessBoard.tsx
│   └── AuthGuard.tsx
├── hooks/
│   └── useGame.ts       # ciclo de vida de una partida
├── lib/
│   ├── api.ts           # cliente HTTP + JWT
│   ├── socket.ts        # singleton de Socket.io
│   └── auth.ts          # store Zustand
└── types/index.ts
```

## Setup

1. **Instalar**
   ```bash
   npm install
   ```
2. **Variables**
   ```bash
   cp .env.example .env.local
   ```
   Edita `NEXT_PUBLIC_API_URL` apuntando a tu backend (ej: `http://localhost:4000`).
3. **Dev**
   ```bash
   npm run dev
   ```
   Abre `http://localhost:3000`.

## Despliegue (Vercel)

1. Sube el repo a GitHub.
2. En Vercel, importa el repo y elige **Root Directory: `frontend`**.
3. Define `NEXT_PUBLIC_API_URL` con la URL pública del backend.
4. Deploy.

## Notas

- El JWT se guarda en `localStorage` (clave `chess_co_token`). Para mayor seguridad en producción se recomienda usar cookies httpOnly emitidas desde el backend; está aislado en `lib/api.ts` para hacer el cambio sin tocar el resto.
- El cliente nunca confía en sus propias validaciones de jugadas. Lo único que importa es la respuesta del servidor (`game:move` ack y broadcast).
