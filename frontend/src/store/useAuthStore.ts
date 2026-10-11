import { create } from 'zustand';
export type Session = { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email?: string } };
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'recovery';
interface AuthState { status: AuthStatus; session: Session | null; recoveryToken: string | null; set: (p: Partial<Omit<AuthState, 'set'>>) => void }
export const useAuthStore = create<AuthState>((set) => ({ status: 'loading', session: null, recoveryToken: null, set: (p) => set(p) }));
