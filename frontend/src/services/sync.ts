// Offline-first sync. Changes are applied locally at once, queued, and pushed when online.
// Conflict rule: per row, the change with the later logical time wins; if the server holds a newer row, this device adopts it.
import { create } from 'zustand';
import { syncPull, syncPush } from './api';

const KEYS: Record<string, string[]> = { user_progress: ['unit_id'], user_knowledge_mastery: ['knowledge_item_id'], user_vocabulary: ['vocabulary_id'], user_grammar: ['grammar_topic_id'], daily_plans: ['plan_date'], mistakes: ['id'], review_events: ['id'] };
const APPEND = new Set(['review_events']);
type Row = Record<string, unknown>;
type Change = { table: string; row: Row; client_updated_at?: string };
interface SyncStatus { pending: number; syncing: boolean; lastSyncedAt: string | null; error: string; rejected: number; set: (p: Partial<Omit<SyncStatus, 'set'>>) => void }
export const useSyncStore = create<SyncStatus>((set) => ({ pending: 0, syncing: false, lastSyncedAt: null, error: '', rejected: 0, set: (p) => set(p) }));

const k = (u: string, n: string) => `ed_sync_${n}_${u}`;
const load = <T,>(key: string, fallback: T): T => { try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : fallback; } catch { return fallback; } };
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* quota or private mode */ } };
const keyOf = (table: string, row: Row) => KEYS[table].map((c) => String(row[c])).join('|');
const deviceId = (): string => { let d = localStorage.getItem('ed_device_id'); if (!d) { d = crypto.randomUUID(); localStorage.setItem('ed_device_id', d); } return d; };

let uid = ''; let queue: Change[] = []; let state: Record<string, Record<string, Row>> = {}; let running: Promise<void> | null = null;
const flushQueue = () => { save(k(uid, 'queue'), queue); useSyncStore.getState().set({ pending: queue.length }); };

/** Read locally cached rows of a synced table (always works offline). */
export const getRows = (table: string): Row[] => Object.values(state[table] ?? {});

export function recordChange(table: string, row: Row): void {
  if (!uid || !KEYS[table]) throw new Error('sync is not active');
  const now = new Date().toISOString();
  (state[table] ??= {})[keyOf(table, row)] = { ...(state[table]?.[keyOf(table, row)] ?? {}), ...row };
  save(k(uid, 'state'), state);
  if (APPEND.has(table)) queue.push({ table, row });
  else {
    const i = queue.findIndex((c) => c.table === table && keyOf(table, c.row) === keyOf(table, row));
    if (i >= 0) queue[i] = { table, row: { ...queue[i].row, ...row }, client_updated_at: now }; else queue.push({ table, row, client_updated_at: now });
  }
  flushQueue();
  scheduleSoon();
}

let timer: ReturnType<typeof setTimeout> | undefined;
const scheduleSoon = () => { clearTimeout(timer); timer = setTimeout(() => void syncNow(), 2000); };

export function syncNow(): Promise<void> {
  if (!uid) return Promise.resolve();
  running ??= (async () => {
    const st = useSyncStore.getState(); st.set({ syncing: true, error: '' });
    try {
      while (queue.length) {
        const batch = queue.slice(0, 200);
        const res = await syncPush({ device_id: deviceId(), changes: batch });
        let rejected = 0;
        res.results.forEach((r) => {
          if (r.status === 'conflict' && r.server_row) (state[r.table!] ??= {})[keyOf(r.table!, r.server_row)] = r.server_row; // newer data exists on the server
          if (r.status === 'rejected') { rejected++; console.warn('sync change rejected:', r.table, r.reason); }
        });
        queue = queue.slice(batch.length); // every change got a final verdict; rejected ones are never retried
        if (rejected) useSyncStore.getState().set({ rejected: useSyncStore.getState().rejected + rejected });
        flushQueue();
      }
      let cursor = load<string>(k(uid, 'cursor'), '0');
      for (let guard = 0; guard < 200; guard++) {
        const page = await syncPull(cursor);
        for (const c of page.changes) (state[c.table] ??= {})[keyOf(c.table, c.row)] = c.row;
        cursor = page.cursor; save(k(uid, 'cursor'), cursor);
        if (!page.has_more) break;
      }
      save(k(uid, 'state'), state);
      useSyncStore.getState().set({ lastSyncedAt: new Date().toISOString() });
    } catch (e) {
      useSyncStore.getState().set({ error: e instanceof Error ? e.message : 'Sync failed' }); // queue is kept; retried automatically
    } finally { useSyncStore.getState().set({ syncing: false }); running = null; }
  })();
  return running;
}

export function startSync(userId: string): () => void {
  uid = userId;
  queue = load<Change[]>(k(uid, 'queue'), []); state = load(k(uid, 'state'), {});
  useSyncStore.getState().set({ pending: queue.length, error: '', rejected: 0 });
  const trigger = () => { if (document.visibilityState !== 'hidden') void syncNow(); };
  window.addEventListener('online', trigger); document.addEventListener('visibilitychange', trigger);
  const interval = setInterval(trigger, 60_000); void syncNow();
  return () => { window.removeEventListener('online', trigger); document.removeEventListener('visibilitychange', trigger); clearInterval(interval); clearTimeout(timer); uid = ''; };
}
/** On sign-out: send what is pending, then remove this account's data from the device. */
export async function flushAndClearLocal(userId: string): Promise<void> {
  await syncNow().catch(() => undefined);
  ['queue', 'state', 'cursor'].forEach((n) => { try { localStorage.removeItem(k(userId, n)); } catch { /* ignore */ } });
  queue = []; state = {};
}
