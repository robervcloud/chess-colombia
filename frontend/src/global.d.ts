/**
 * Declaraciones globales de módulos para side-effect imports.
 *
 * TypeScript 5.6+ requiere declaraciones explícitas para imports sin
 * binding (`import './globals.css'`) — sin esto lanza:
 *   TS2882: Cannot find module or type declarations for side-effect
 *   import of './globals.css'.
 *
 * Estas declaraciones le indican al compilador que los archivos CSS
 * son módulos válidos sin tipos. No afecta runtime ni Tailwind.
 */

declare module '*.css';
declare module '*.scss';
declare module '*.sass';
