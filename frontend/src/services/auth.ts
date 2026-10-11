// Email + password accounts through Supabase Auth (GoTrue REST API). Passwords never touch our own server or database.
import { useAuthStore, Session } from '../store/useAuthStore';
const BASE = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const ANON = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '');
export const authConfigured = Boolean(BASE && ANON);
const STORAGE_KEY = 'ed_session';
const nowSec = () => Math.floor(Date.now() / 1000);

async function gotrue<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  if (!authConfigured) throw new Error('Accounts are not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  const res = await fetch(`${BASE}/auth/v1${path}`, {
    method: init.method || 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${init.token || ANON}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data.error_description || data.msg || data.message || `Request failed (${res.status})`));
  return data as T;
}

function toSession(d: any): Session {
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Number(d.expires_at) || nowSec() + Number(d.expires_in || 3600), user: { id: d.user?.id, email: d.user?.email } };
}
function persist(s: Session | null) {
  try { s ? localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) : localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  useAuthStore.getState().set({ session: s, status: s ? 'signedIn' : 'signedOut' });
}

export async function signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  const d: any = await gotrue('/signup', { body: { email, password } });
  if (d.access_token) { persist(toSession(d)); return { needsConfirmation: false }; }
  return { needsConfirmation: true }; // project requires email confirmation first
}
export async function signIn(email: string, password: string): Promise<void> {
  persist(toSession(await gotrue('/token?grant_type=password', { body: { email, password } })));
}
export async function requestPasswordReset(email: string): Promise<void> {
  await gotrue(`/recover?redirect_to=${encodeURIComponent(window.location.origin)}`, { body: { email } });
}
/** Called on page load: the reset e-mail link returns here with #access_token=...&type=recovery. */
export function handleRecoveryHash(): boolean {
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (h.get('type') !== 'recovery' || !h.get('access_token')) return false;
  useAuthStore.getState().set({ recoveryToken: h.get('access_token'), status: 'recovery', session: null });
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return true;
}
export async function setNewPassword(password: string): Promise<void> {
  const token = useAuthStore.getState().recoveryToken;
  if (!token) throw new Error('The reset link has expired. Request a new one.');
  await gotrue('/user', { method: 'PUT', body: { password }, token });
  useAuthStore.getState().set({ recoveryToken: null, status: 'signedOut' });
}

let refreshing: Promise<Session | null> | null = null;
async function refresh(s: Session): Promise<Session | null> {
  refreshing ??= (async () => {
    try { const n = toSession(await gotrue('/token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } })); persist(n); return n; }
    catch { persist(null); return null; }
    finally { refreshing = null; }
  })();
  return refreshing;
}
export async function restoreSession(): Promise<void> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const s: Session | null = raw ? JSON.parse(raw) : null;
    if (!s?.refresh_token || !s.user?.id) return persist(null);
    if (s.expires_at - nowSec() > 60) return persist(s);
    await refresh(s);
  } catch { persist(null); }
}
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  const s = useAuthStore.getState().session;
  if (!s) return null;
  if (!forceRefresh && s.expires_at - nowSec() > 60) return s.access_token;
  return (await refresh(s))?.access_token ?? null;
}
export async function signOut(): Promise<void> {
  const s = useAuthStore.getState().session;
  if (s) { try { await gotrue('/logout?scope=local', { token: s.access_token }); } catch { /* still sign out locally */ } }
  persist(null);
}
