import React, { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { InteractiveReadingCard } from './components/InteractiveReadingCard';
import { CurriculumExplorer } from './components/CurriculumExplorer';
import { AuthScreen } from './components/AuthScreen';
import { ProfilePanel } from './components/ProfilePanel';
import { handleRecoveryHash, restoreSession } from './services/auth';
import { getMe } from './services/api';
import { startSync } from './services/sync';
import { useAuthStore } from './store/useAuthStore';
import { useAppStore } from './store/useAppStore';
export default function App() {
  const status = useAuthStore((s) => s.status); const userId = useAuthStore((s) => s.session?.user.id);
  const setUser = useAppStore((s) => s.setUser);
  const [showAccount, setShowAccount] = useState(false);
  useEffect(() => { if (!handleRecoveryHash()) void restoreSession(); }, []);
  useEffect(() => {
    if (status !== 'signedIn' || !userId) return;
    const stop = startSync(userId);
    getMe().then((m) => setUser({ id: m.id, name: m.display_name, currentLevel: m.verified_level || 'Foundation' })).catch(() => undefined);
    return stop;
  }, [status, userId, setUser]);
  if (status === 'loading') return <div className="auth-wrap"><p className="muted">Loading…</p></div>;
  if (status !== 'signedIn') return <AuthScreen />;
  return <div className="app"><nav className="nav"><div className="brand"><div className="flag">🇩🇪</div><div>Einfaches Deutsch<div className="muted">Your German learning space</div></div></div><span className="tag">CEFR · ZERO TO B2</span><button className="link" onClick={() => setShowAccount((v) => !v)}>Account</button></nav>
    <main className="stack">{showAccount && <ProfilePanel onClose={() => setShowAccount(false)} />}<Dashboard /><CurriculumExplorer />
      <div className="bottom-grid"><InteractiveReadingCard />
        <div className="card"><div className="section-head"><h3>Learning method</h3><span className="pill">MASTERY FIRST</span></div>
          <p className="muted">Every unit should progress through learning, guided practice, active recall, real use, assessment, and spaced review.</p>
          <div className="task"><div className="task-icon">🧠</div><div><h4>Active recall</h4><p>Try to remember before checking.</p></div></div>
          <div className="task"><div className="task-icon">🗓️</div><div><h4>Spaced repetition</h4><p>Review again at the right time.</p></div></div>
          <a className="official-link" href="https://www.goethe.de/en/spr/kup/prf.html" target="_blank" rel="noreferrer">Official Goethe practice resources ↗</a>
          <p className="notice">Signed in · your progress syncs between your devices.</p></div></div></main></div>;
}
