// Cross-device sync.
// * "state" tables  : one row per key, last-write-wins by the client's logical time (updated_at). The server never overwrites a newer row.
// * "append" tables : immutable events, inserted idempotently by client-generated UUID, so no conflict is possible.
// * NOT syncable    : exam_results, user_skills, user_skill_evidence, exercise_attempts, user_achievements. These are derived or graded
//                     on the server (answer keys never leave it), so a client can never write its own scores or unlocks.

export class SyncValidationError extends Error {
  constructor(public readonly field: string, public readonly reason: string) { super(`${field}:${reason}`); }
}
type V = (v: unknown, f: string) => unknown;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (f: string, r: string): never => { throw new SyncValidationError(f, r); };

const uuid: V = (v, f) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : bad(f, 'uuid'));
const textId = (max = 64): V => (v, f) => (typeof v === 'string' && v.length >= 1 && v.length <= max && /^[A-Za-z0-9_.:-]+$/.test(v) ? v : bad(f, 'id'));
const code = (max = 30): V => (v, f) => (typeof v === 'string' && v.length <= max && /^[A-Z_]+$/.test(v) ? v : bad(f, 'code'));
const int = (min: number, max: number): V => (v, f) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : bad(f, 'int_range'));
const num = (min: number, max: number): V => (v, f) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : bad(f, 'num_range'));
const oneOf = (list: readonly string[]): V => (v, f) => (typeof v === 'string' && list.includes(v) ? v : bad(f, 'enum'));
const text = (max: number): V => (v, f) => (typeof v === 'string' && v.length <= max && !v.includes('\u0000') ? v : bad(f, 'text'));
const bool: V = (v, f) => (typeof v === 'boolean' ? v : bad(f, 'bool'));
const ts: V = (v, f) => {
  if (typeof v !== 'string' || v.length > 40) return bad(f, 'timestamp');
  const d = new Date(v);
  const y = d.getUTCFullYear();
  return Number.isNaN(d.getTime()) || y < 2000 || y > 2100 ? bad(f, 'timestamp') : d.toISOString();
};
const dateOnly: V = (v, f) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return bad(f, 'date');
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? bad(f, 'date') : v;
};
const jsonArray = (maxBytes: number): V => (v, f) => {
  if (!Array.isArray(v)) return bad(f, 'array');
  const s = JSON.stringify(v);
  return s.length > maxBytes || s.includes('\\u0000') ? bad(f, 'json_size') : s; // bound to jsonb by cast in SQL
};
const nullable = (inner: V): V => (v, f) => (v === null ? null : inner(v, f));

export const MASTERY_STATES = ['LOCKED', 'INTRODUCED', 'LEARNING', 'PRACTICED', 'FAMILIAR', 'FUNCTIONAL', 'MASTERED', 'REINFORCING', 'WEAKENING', 'REVIEW_REQUIRED'] as const;
export const MISTAKE_SEVERITIES = ['minor', 'moderate', 'major', 'recurring'] as const;

export interface TableSpec {
  name: string;
  kind: 'state' | 'append';
  keys: Record<string, V>;     // identity columns supplied by the client
  conflict: string[];          // ON CONFLICT target
  cols: Record<string, V>;     // other writable columns
  jsonCols?: string[];         // columns stored as jsonb
  floatCols?: string[];        // numeric columns returned as numbers
}
const mastery = int(0, 100);
export const SYNC_TABLES: Record<string, TableSpec> = {
  user_progress: { name: 'user_progress', kind: 'state', keys: { unit_id: textId() }, conflict: ['user_id', 'unit_id'], cols: { status: code(), completion_percent: int(0, 100) } },
  user_knowledge_mastery: { name: 'user_knowledge_mastery', kind: 'state', keys: { knowledge_item_id: uuid }, conflict: ['user_id', 'knowledge_item_id'], floatCols: ['ease_factor'],
    cols: { mastery_score: mastery, state: oneOf(MASTERY_STATES), last_reviewed: nullable(ts), next_review: nullable(ts), interval_days: int(0, 3650), ease_factor: num(1.3, 9.99) } },
  user_vocabulary: { name: 'user_vocabulary', kind: 'state', keys: { vocabulary_id: uuid }, conflict: ['user_id', 'vocabulary_id'], floatCols: ['ease_factor'],
    cols: { mastery_score: mastery, next_review: nullable(ts), interval_days: int(0, 3650), ease_factor: num(1.3, 9.99), last_answer_quality: nullable(int(0, 5)) } },
  user_grammar: { name: 'user_grammar', kind: 'state', keys: { grammar_topic_id: uuid }, conflict: ['user_id', 'grammar_topic_id'], cols: { mastery_score: mastery, state: oneOf(MASTERY_STATES) } },
  daily_plans: { name: 'daily_plans', kind: 'state', keys: { plan_date: dateOnly }, conflict: ['user_id', 'plan_date'], jsonCols: ['tasks'], cols: { available_minutes: int(1, 480), tasks: jsonArray(20_000) } },
  mistakes: { name: 'mistakes', kind: 'state', keys: { id: uuid }, conflict: ['id'],
    cols: { knowledge_item_id: nullable(uuid), exercise_id: nullable(uuid), user_answer: text(2000), expected_answer: text(2000), context: text(2000),
      severity: oneOf(MISTAKE_SEVERITIES), is_resolved: bool, occurrence_count: int(1, 100000), resolved_at: nullable(ts) } },
  review_events: { name: 'review_events', kind: 'append', keys: { id: uuid }, conflict: ['id'],
    cols: { knowledge_item_id: nullable(uuid), vocabulary_id: nullable(uuid), quality: int(0, 5), mastery_before: mastery, mastery_after: mastery, reviewed_at: ts, next_review: nullable(ts) } },
};

export interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> }
export interface PoolLike { connect(): Promise<Queryable & { release(err?: unknown): void }> }

export const MAX_CHANGES = 200;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const q = (id: string): string => `"${id}"`; // identifiers come from the whitelist above only, never from client input

interface Prepared { index: number; spec: TableSpec; keys: Record<string, unknown>; vals: Record<string, unknown>; updatedAt: string }

function prepare(change: unknown, index: number, nowMs: number): Prepared {
  if (!change || typeof change !== 'object') return bad(`changes[${index}]`, 'object');
  const c = change as { table?: unknown; row?: unknown; client_updated_at?: unknown };
  const spec = typeof c.table === 'string' && Object.prototype.hasOwnProperty.call(SYNC_TABLES, c.table) ? SYNC_TABLES[c.table] : undefined;
  if (!spec) return bad(`changes[${index}].table`, 'unknown_table');
  if (!c.row || typeof c.row !== 'object' || Array.isArray(c.row)) return bad(`changes[${index}].row`, 'object');
  const row = c.row as Record<string, unknown>;
  for (const k of Object.keys(row)) if (!(k in spec.keys) && !(k in spec.cols)) return bad(`changes[${index}].row.${k}`, 'unknown_field');
  const keys: Record<string, unknown> = {}; const vals: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec.keys)) keys[k] = v(row[k], k);
  for (const [k, v] of Object.entries(spec.cols)) if (row[k] !== undefined) vals[k] = v(row[k], k);
  if (spec.kind === 'append') {
    for (const k of Object.keys(spec.cols)) if (!(k in vals) && !['knowledge_item_id', 'vocabulary_id', 'next_review'].includes(k)) return bad(k, 'required');
  }
  let updatedAt = new Date(nowMs).toISOString();
  if (spec.kind === 'state') {
    updatedAt = ts(c.client_updated_at, 'client_updated_at') as string;
    if (Date.parse(updatedAt) > nowMs + MAX_FUTURE_MS) updatedAt = new Date(nowMs + MAX_FUTURE_MS).toISOString(); // a bad clock cannot pin a row forever
  }
  return { index, spec, keys, vals, updatedAt };
}

function selectList(spec: TableSpec): string {
  const names = [...Object.keys(spec.keys), ...Object.keys(spec.cols)];
  const cols = names.map((n) => (spec.floatCols?.includes(n) ? `${q(n)}::float8 AS ${q(n)}` : q(n)));
  if (spec.kind === 'state') cols.push(q('updated_at'));
  cols.push(q('sync_seq'));
  return cols.join(', ');
}

export type ChangeResult = { index: number; table?: string; status: 'applied' | 'duplicate' | 'conflict' | 'rejected'; reason?: string; server_row?: Record<string, unknown> };

export async function pushChanges(pool: PoolLike, userId: string, body: unknown, nowMs: number = Date.now()): Promise<{ results: ChangeResult[]; server_time: string }> {
  if (!body || typeof body !== 'object') throw new SyncValidationError('body', 'object');
  const b = body as { changes?: unknown; device_id?: unknown };
  if (!Array.isArray(b.changes) || b.changes.length === 0 || b.changes.length > MAX_CHANGES) throw new SyncValidationError('changes', `1..${MAX_CHANGES}`);
  if (b.device_id !== undefined) textId(64)(b.device_id, 'device_id');

  const results: ChangeResult[] = new Array(b.changes.length);
  const prepared: Prepared[] = [];
  b.changes.forEach((ch, i) => {
    try { prepared.push(prepare(ch, i, nowMs)); }
    catch (e) { results[i] = { index: i, status: 'rejected', reason: e instanceof SyncValidationError ? `${e.field}:${e.reason}` : 'invalid' }; }
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialise pushes per user so sync_seq values become visible in order (no missed rows on pull).
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
    for (const p of prepared) {
      const { spec } = p;
      await client.query('SAVEPOINT change');
      try {
        const names = [...Object.keys(spec.keys), ...Object.keys(p.vals)];
        const params: unknown[] = [userId, ...names.map((n) => (n in spec.keys ? p.keys[n] : p.vals[n]))];
        const ph = names.map((n, i) => (spec.jsonCols?.includes(n) ? `$${i + 2}::jsonb` : `$${i + 2}`));
        let sql: string; let cols = ['user_id', ...names];
        if (spec.kind === 'append') {
          sql = `INSERT INTO ${q(spec.name)} (${cols.map(q).join(',')}) VALUES ($1,${ph.join(',')}) ON CONFLICT (${spec.conflict.map(q).join(',')}) DO NOTHING RETURNING ${q('sync_seq')}`;
          const r = await client.query(sql, params);
          results[p.index] = { index: p.index, table: spec.name, status: r.rows.length ? 'applied' : 'duplicate' };
        } else {
          cols = [...cols, 'updated_at'];
          params.push(p.updatedAt);
          const sets = [...Object.keys(p.vals), 'updated_at'].map((n) => `${q(n)}=EXCLUDED.${q(n)}`).join(',');
          sql = `INSERT INTO ${q(spec.name)} (${cols.map(q).join(',')}) VALUES ($1,${ph.join(',')},$${params.length}) ON CONFLICT (${spec.conflict.map(q).join(',')}) DO UPDATE SET ${sets} WHERE ${q(spec.name)}.${q('updated_at')} < EXCLUDED.${q('updated_at')} AND ${q(spec.name)}.${q('user_id')} = EXCLUDED.${q('user_id')} RETURNING ${q('sync_seq')}`;
          const r = await client.query(sql, params);
          if (r.rows.length) results[p.index] = { index: p.index, table: spec.name, status: 'applied' };
          else {
            const keyNames = Object.keys(spec.keys);
            const where = keyNames.map((n, i) => `${q(n)} = $${i + 2}`).join(' AND ');
            const cur = await client.query(`SELECT ${selectList(spec)} FROM ${q(spec.name)} WHERE ${q('user_id')} = $1 AND ${where}`, [userId, ...keyNames.map((n) => p.keys[n])]);
            results[p.index] = cur.rows.length
              ? { index: p.index, table: spec.name, status: 'conflict', server_row: cur.rows[0] }
              : { index: p.index, table: spec.name, status: 'rejected', reason: 'id_unavailable' };
          }
        }
        await client.query('RELEASE SAVEPOINT change');
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT change');
        const pg = (e as { code?: string }).code ?? '';
        const reason = pg === '23503' ? 'unknown_reference' : pg.startsWith('23') || pg.startsWith('22') ? 'invalid_value' : 'error';
        if (reason === 'error') console.error('sync change failed:', pg || (e instanceof Error ? e.message : 'unknown'));
        results[p.index] = { index: p.index, table: spec.name, status: 'rejected', reason };
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection already unusable */ }
    throw e;
  } finally { client.release(); }
  return { results, server_time: new Date(nowMs).toISOString() };
}

export const PULL_PAGE = 500;
export async function pullChanges(db: Queryable, userId: string, sinceRaw: unknown): Promise<{ cursor: string; has_more: boolean; server_time: string; changes: Array<{ table: string; row: Record<string, unknown> }> }> {
  const since = sinceRaw === undefined || sinceRaw === '' ? '0' : String(sinceRaw);
  if (!/^\d{1,18}$/.test(since)) throw new SyncValidationError('since', 'cursor');
  type Row = { table: string; seq: bigint; row: Record<string, unknown> };
  const all: Row[] = [];
  let bound: bigint | null = null;
  for (const spec of Object.values(SYNC_TABLES)) {
    const r = await db.query(`SELECT ${selectList(spec)} FROM ${q(spec.name)} WHERE ${q('user_id')} = $1 AND ${q('sync_seq')} > $2::bigint ORDER BY ${q('sync_seq')} LIMIT ${PULL_PAGE + 1}`, [userId, since]);
    let rows = r.rows;
    if (rows.length > PULL_PAGE) {
      rows = rows.slice(0, PULL_PAGE);
      const last = BigInt(rows[rows.length - 1].sync_seq);
      if (bound === null || last < bound) bound = last;
    }
    for (const row of rows) all.push({ table: spec.name, seq: BigInt(row.sync_seq), row });
  }
  const kept = (bound === null ? all : all.filter((x) => x.seq <= (bound as bigint))).sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
  const cursor = kept.length ? kept[kept.length - 1].seq.toString() : since;
  return { cursor, has_more: bound !== null, server_time: new Date().toISOString(), changes: kept.map((x) => ({ table: x.table, row: x.row })) };
}
