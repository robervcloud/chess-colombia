'use client';

import { io, Socket } from 'socket.io-client';
import { API_BASE, getToken } from './api';

/**
 * Socket singleton. Se conecta al backend con el JWT actual.
 * Si el token cambia (logout/login), llamar disconnectSocket()
 * antes de pedir el siguiente.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket && socket.connected) return socket;
  if (socket) return socket;

  const token = getToken();
  socket = io(API_BASE, {
    auth: { token: token || '' },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 800,
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
