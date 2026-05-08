'use client';

import { create } from 'zustand';
import { api, setToken, getToken } from './api';
import { disconnectSocket } from './socket';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  hydrated: boolean;            // true tras intentar restaurar sesión
  login: (identifier: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string, preferredUsername?: string) => Promise<void>;
  register: (data: { username: string; email: string; password: string; country: string }) => Promise<void>;
  logout: () => void;
  hydrate: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: false,
  hydrated: false,

  async login(identifier, password) {
    set({ loading: true });
    try {
      const { user, token } = await api<{ user: User; token: string }>('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: { identifier, password },
      });
      setToken(token);
      set({ user, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  async loginWithGoogle(idToken, preferredUsername) {
    set({ loading: true });
    try {
      const body: Record<string, string> = { idToken };
      if (preferredUsername) body.preferredUsername = preferredUsername;
      const { user, token } = await api<{ user: User; token: string }>('/api/auth/google', {
        method: 'POST',
        auth: false,
        body,
      });
      setToken(token);
      set({ user, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  async register(data) {
    set({ loading: true });
    try {
      const { user, token } = await api<{ user: User; token: string }>('/api/auth/register', {
        method: 'POST',
        auth: false,
        body: data,
      });
      setToken(token);
      set({ user, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  logout() {
    setToken(null);
    disconnectSocket();
    set({ user: null });
  },

  async hydrate() {
    if (!getToken()) {
      set({ hydrated: true });
      return;
    }
    try {
      const { user } = await api<{ user: User }>('/api/auth/me');
      set({ user, hydrated: true });
    } catch {
      setToken(null);
      set({ user: null, hydrated: true });
    }
  },
}));
