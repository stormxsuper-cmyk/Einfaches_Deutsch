import React, { useEffect, useState } from 'react';
import { deleteMyData, getMe, updateMe } from '../services/api';
import { signOut, stopGuest } from '../services/auth';
import { flushAndClearLocal, syncNow, useSyncStore } from '../services/sync';
import { useAuthStore } from '../store/useAuthStore';
import { useAppStore } from '../store/useAppStore';
const LEVELS = ['Foundation', 'A1', 'A2', 'B1', 'B2'];
export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const session = useAuthStore((s) => s.session); const status = useAuthStore((s) => s.status); const setUser = useAppStore((s) => s.setUser);
  const guest = status === 'guest';
  const sync = useSyncStore();
  const [name, setName] = useState(''); const [target, setTarget] = useState('B2'); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { if (guest) return; getMe().then((m) => { setName(m.display_name); setTarget(m.target_level); }).catch((e) => setErr(e.message)); }, [guest]);
  async function save() {
    setErr(''); setMsg('');
    try { const m = await updateMe({ display_name: name, target_level: target }); setUser({ id: m.id, name: m.display_name, currentLevel: m.verified_level || 'Foundation' }); setMsg('Saved.'); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); }
  }
  async function leave() { const id = session!.user.id; await flushAndClearLocal(id); await signOut(); onClose(); }
  async function wipe() {
    if (!window.confirm('Delete ALL your learning progress on the server? This cannot be undone.')) return;
    try { await deleteMyData(); await flushAndClearLocal(session!.user.id); await signOut(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not delete'); }
  }
  if (guest) return <div className="card profile-panel"><div className="section-head"><h3>Account</h3><button className="link" onClick={onClose}>Close</button></div>
    <p className="muted">You are in demo mode. There is no account, so nothing is uploaded: vocabulary, plans and progress stay in this browser and are lost if you clear the site data.</p>
    <p className="notice">Create a free account to keep your progress and sync it between your phone and computer.</p>
    <button className="primary" onClick={() => { stopGuest(); onClose(); }}>Sign in or create an account</button></div>;
  return <div className="card profile-panel"><div className="section-head"><h3>Account</h3><button className="link" onClick={onClose}>Close</button></div>
    <p className="muted">{session?.user.email}</p>
    <label className="field">Display name<input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
    <label className="field">Target level<select value={target} onChange={(e) => setTarget(e.target.value)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></label>
    <button className="primary" onClick={save}>Save profile</button>
    <p className="notice">Sync: {sync.syncing ? 'syncing…' : sync.error ? `offline (${sync.pending} waiting)` : `up to date${sync.lastSyncedAt ? ' · ' + new Date(sync.lastSyncedAt).toLocaleTimeString() : ''}`}{sync.pending > 0 && !sync.syncing ? ` · ${sync.pending} change(s) waiting` : ''} <button className="link" onClick={() => void syncNow()}>Sync now</button></p>
    {msg && <p className="notice">{msg}</p>}{err && <p className="error" role="alert">{err}</p>}
    <div className="auth-links"><button className="link" onClick={leave}>Sign out</button><button className="link danger" onClick={wipe}>Delete my learning data</button></div></div>;
}
