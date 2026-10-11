import React, { useState } from 'react';
import { authConfigured, requestPasswordReset, setNewPassword, signIn, signUp } from '../services/auth';
import { useAuthStore } from '../store/useAuthStore';
type Mode = 'login' | 'register' | 'forgot';
export function AuthScreen() {
  const status = useAuthStore((s) => s.status);
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [info, setInfo] = useState('');
  const recovery = status === 'recovery';
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setInfo('');
    if (!recovery && !/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid e-mail address.');
    if ((recovery || mode !== 'forgot') && password.length < 8) return setError('Use at least 8 characters for the password.');
    setBusy(true);
    try {
      if (recovery) { await setNewPassword(password); setInfo('Password updated. Sign in with the new password.'); setMode('login'); setPassword(''); }
      else if (mode === 'login') await signIn(email.trim(), password);
      else if (mode === 'register') { const r = await signUp(email.trim(), password); if (r.needsConfirmation) { setInfo('Account created. Check your e-mail and confirm the address, then sign in.'); setMode('login'); } }
      else { await requestPasswordReset(email.trim()); setInfo('If this address has an account, a reset link is on its way.'); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  }
  if (!authConfigured) return <div className="auth-wrap"><div className="card auth-card"><h2>Accounts are not configured</h2><p className="muted">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see frontend/.env.example), then restart.</p></div></div>;
  const title = recovery ? 'Choose a new password' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create your account' : 'Reset your password';
  return <div className="auth-wrap"><form className="card auth-card" onSubmit={submit} noValidate>
    <div className="brand"><div className="flag">🇩🇪</div><div>Einfaches Deutsch<div className="muted">Zero to B2</div></div></div>
    <h2>{title}</h2>
    {!recovery && <label className="field">E-mail<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>}
    {(recovery || mode !== 'forgot') && <label className="field">{recovery ? 'New password' : 'Password'}<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></label>}
    {error && <p className="error" role="alert">{error}</p>}{info && <p className="notice" role="status">{info}</p>}
    <button className="primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : recovery ? 'Save password' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}</button>
    {!recovery && <div className="auth-links">
      {mode !== 'login' && <button type="button" className="link" onClick={() => { setMode('login'); setError(''); }}>Back to sign in</button>}
      {mode === 'login' && <><button type="button" className="link" onClick={() => { setMode('register'); setError(''); }}>Create account</button><button type="button" className="link" onClick={() => { setMode('forgot'); setError(''); }}>Forgot password?</button></>}
    </div>}
  </form></div>;
}
