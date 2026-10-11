import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import curriculum from './data/curriculum_master.json';
import { calculateSpacedRepetition } from './engine/masteryEngine';
import { generateDailyPlan } from './engine/adaptivePlanner';
import { processPlacementAnswer, startPlacementTest, PlacementState, CefrLevel } from './engine/placementTest';
import { AuthError, isAuthConfigured, loadAuthConfig, verifyJwt } from './auth/jwt';
import { createRateLimiter, noStore, parseOrigins, securityHeaders } from './security';
import { pullChanges, pushChanges, SyncValidationError } from './sync/sync';

const isProd = process.env.NODE_ENV === 'production';
const authConfig = loadAuthConfig(process.env);
const origins = parseOrigins(process.env.FRONTEND_ORIGIN);
if (isProd && !isAuthConfigured(authConfig)) { console.error('FATAL: set SUPABASE_JWT_SECRET or SUPABASE_URL; refusing to start without authentication.'); process.exit(1); }
if (isProd && origins.includes('*')) { console.error('FATAL: FRONTEND_ORIGIN must list explicit origins in production.'); process.exit(1); }

const app = express();
const port = Number(process.env.PORT || 4000);
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.use(securityHeaders);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.includes(origin)), methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'], maxAge: 600 }));
app.use(createRateLimiter({ windowMs: 60_000, max: 300, key: (req) => `ip:${req.ip}` }));
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) : null;
const json = express.json({ limit: '100kb' });
const jsonSync = express.json({ limit: '1mb' });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler => (req, res, next) => { Promise.resolve(fn(req, res)).catch(next); };

// ---- authentication: every request is tied to the user id inside a verified token ----
const knownUsers = new Set<string>();
const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
    if (!m) { res.setHeader('WWW-Authenticate', 'Bearer'); return void res.status(401).json({ error: 'unauthorized' }); }
    const user = await verifyJwt(m[1], authConfig);
    if (!pool) return void res.status(503).json({ error: 'database_not_configured' });
    if (!knownUsers.has(user.sub)) {
      await pool.query('INSERT INTO app_profiles(id) VALUES($1) ON CONFLICT (id) DO NOTHING', [user.sub]);
      if (knownUsers.size > 100_000) knownUsers.clear();
      knownUsers.add(user.sub);
    }
    res.locals.userId = user.sub; res.locals.email = user.email;
    next();
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.code === 'auth_not_configured' || e.code === 'key_unavailable') return void res.status(503).json({ error: 'auth_unavailable' });
      res.setHeader('WWW-Authenticate', 'Bearer'); return void res.status(401).json({ error: 'unauthorized' });
    }
    next(e);
  }
};
const userLimiter = createRateLimiter({ windowMs: 60_000, max: 120, key: (_q, res) => `u:${res.locals.userId}` });
const syncLimiter = createRateLimiter({ windowMs: 60_000, max: 30, key: (_q, res) => `s:${res.locals.userId}` });
const authed: RequestHandler[] = [noStore, requireAuth, userLimiter];
const uid = (res: Response): string => res.locals.userId as string;
const LEVELS = ['Foundation', 'A1', 'A2', 'B1', 'B2'];

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    if (pool) await pool.query('SELECT 1');
    res.json({ status: 'active', database: pool ? 'connected' : 'not_configured', auth: isAuthConfigured(authConfig) ? 'configured' : 'not_configured', curriculumVersion: curriculum.version, levels: curriculum.levels.length, modules: curriculum.levels.reduce((n, l) => n + l.modules.length, 0) });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
});

// ---- public, non-personal content ----
app.get('/api/curriculum', (_req, res) => res.json(curriculum));
app.get('/api/curriculum/levels', (_req, res) => res.json(curriculum.levels.map(({ level, purpose, modules }) => ({ level, purpose, moduleCount: modules.length }))));
app.get('/api/curriculum/modules/:id', (req, res) => {
  for (const level of curriculum.levels) {
    const module = level.modules.find((item) => item.id.toLowerCase() === req.params.id.toLowerCase());
    if (module) return res.json({ level: level.level, purpose: level.purpose, ...module });
  }
  return res.status(404).json({ error: 'Curriculum module not found' });
});
app.get('/api/knowledge', async (_req, res) => {
  if (!pool) return res.json(curriculum.levels.flatMap((level) => level.modules.map((module) => ({ code: module.id, title: module.title, level: level.level, category: 'module', description: module.learning_outcome, prerequisites: [] }))));
  try {
    const result = await pool.query("SELECT code,title,level,category,description,prerequisites FROM knowledge_items ORDER BY array_position(ARRAY['Foundation','A1','A2','B1','B2'], level::text), title");
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Could not load knowledge items' });
  }
});
app.get('/api/goethe/resources', (_req, res) => res.json({ title: 'Official Goethe-Institut exam preparation', policy: 'Use official resources through their source links; this application does not reproduce protected exam content.', url: 'https://www.goethe.de/en/spr/kup/prf.html', levels: ['A1', 'A2', 'B1', 'B2'] }));

// ---- account / profile (requires a verified token) ----
app.get('/api/me', ...authed, wrap(async (_req, res) => {
  const r = await pool!.query('SELECT id, display_name, target_level, verified_level, created_at, updated_at FROM app_profiles WHERE id = $1', [uid(res)]);
  res.json({ ...r.rows[0], email: res.locals.email ?? null });
}));
app.put('/api/me', ...authed, json, wrap(async (req, res) => {
  const { display_name, target_level } = (req.body || {}) as { display_name?: unknown; target_level?: unknown };
  const name = typeof display_name === 'string' ? display_name.trim() : undefined;
  if (name !== undefined && (name.length < 1 || name.length > 100 || name.includes('\u0000'))) return void res.status(400).json({ error: 'invalid_display_name' });
  if (target_level !== undefined && (typeof target_level !== 'string' || !LEVELS.includes(target_level))) return void res.status(400).json({ error: 'invalid_target_level' });
  if (name === undefined && target_level === undefined) return void res.status(400).json({ error: 'nothing_to_update' });
  const r = await pool!.query('UPDATE app_profiles SET display_name = COALESCE($2, display_name), target_level = COALESCE($3::user_cefr_level, target_level), updated_at = NOW() WHERE id = $1 RETURNING id, display_name, target_level, verified_level', [uid(res), name ?? null, target_level ?? null]);
  res.json(r.rows[0]);
}));
// Deletes all learning data for the signed-in user. The login itself lives in the auth provider and is removed there.
app.delete('/api/me', ...authed, json, wrap(async (req, res) => {
  if ((req.body || {}).confirm !== 'DELETE') return void res.status(400).json({ error: 'confirmation_required' });
  await pool!.query('DELETE FROM app_profiles WHERE id = $1', [uid(res)]);
  knownUsers.delete(uid(res));
  res.json({ deleted: true });
}));
app.get('/api/mistakes', ...authed, wrap(async (_req, res) => {
  const r = await pool!.query('SELECT id, knowledge_item_id, user_answer, expected_answer, context, severity, is_resolved, occurrence_count, created_at FROM mistakes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200', [uid(res)]);
  res.json(r.rows);
}));

// ---- sync ----
app.get('/api/sync/pull', ...authed, wrap(async (req, res) => {
  try { res.json(await pullChanges(pool!, uid(res), req.query.since)); }
  catch (e) { if (e instanceof SyncValidationError) return void res.status(400).json({ error: 'invalid_request', detail: `${e.field}:${e.reason}` }); throw e; }
}));
app.post('/api/sync/push', noStore, requireAuth, userLimiter, syncLimiter, jsonSync, wrap(async (req, res) => {
  try { res.json(await pushChanges(pool!, uid(res), req.body)); }
  catch (e) { if (e instanceof SyncValidationError) return void res.status(400).json({ error: 'invalid_request', detail: `${e.field}:${e.reason}` }); throw e; }
}));

// ---- engines (stateless helpers; authenticated and size-limited) ----
app.post('/api/mastery/review', ...authed, json, (req, res) => {
  try {
    const { qualityScore, currentEase = 2.5, currentInterval = 0, currentMastery = 0 } = req.body;
    res.json(calculateSpacedRepetition(Number(qualityScore), Number(currentEase), Number(currentInterval), Number(currentMastery)));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid review' }); }
});
app.post('/api/planner/generate', ...authed, json, (req, res) => {
  try {
    const mastery = Array.isArray(req.body.masteryList) ? req.body.masteryList : [];
    const mistakes = Array.isArray(req.body.mistakes) ? req.body.mistakes : [];
    if (mastery.length > 500 || mistakes.length > 500) throw new Error('too many items');
    res.json(generateDailyPlan(Number(req.body.availableMinutes), mastery, mistakes));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid plan request' }); }
});
app.post('/api/placement/start', ...authed, json, (req, res) => {
  try { res.json(startPlacementTest((req.body.level || 'Foundation') as CefrLevel)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid level' }); }
});
app.post('/api/placement/answer', ...authed, json, (req, res) => {
  try {
    const state = req.body.state as PlacementState;
    if (!state || typeof req.body.isCorrect !== 'boolean') throw new Error('state and boolean isCorrect are required');
    res.json(processPlacementAnswer({ ...state }, req.body.isCorrect));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid answer' }); }
});

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
// Never leak stack traces or database messages to clients.
app.use((err: { type?: string; status?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'invalid_json' });
  if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'payload_too_large' });
  console.error('Unhandled error:', err?.message ?? 'unknown');
  res.status(500).json({ error: 'internal_error' });
});
async function seedCurriculum(): Promise<void> {
  if (!pool) return;
  for (let index = 0; index < curriculum.levels.length; index++) {
    const level = curriculum.levels[index];
    await pool.query('INSERT INTO levels(id,title,purpose,sort_order) VALUES($1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET purpose=EXCLUDED.purpose', [level.level, level.purpose, index]);
    for (let unitIndex = 0; unitIndex < level.modules.length; unitIndex++) {
      const unit = level.modules[unitIndex];
      await pool.query(`INSERT INTO units(id,level_id,title,vocabulary_scope,grammar_scope,learning_outcome,assessment,sort_order)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET level_id=EXCLUDED.level_id,title=EXCLUDED.title,vocabulary_scope=EXCLUDED.vocabulary_scope,grammar_scope=EXCLUDED.grammar_scope,learning_outcome=EXCLUDED.learning_outcome,assessment=EXCLUDED.assessment,sort_order=EXCLUDED.sort_order`,
      [unit.id, level.level, unit.title, unit.vocabulary_scope, unit.grammar_scope, unit.learning_outcome, unit.assessment, unitIndex]);
      await pool.query(`INSERT INTO knowledge_items(code,title,level,category,description,prerequisites,unit_id)
        VALUES($1,$2,$3,'module',$4,'[]'::jsonb,$5) ON CONFLICT(code) DO UPDATE SET title=EXCLUDED.title,level=EXCLUDED.level,description=EXCLUDED.description,unit_id=EXCLUDED.unit_id`,
      [unit.id, unit.title, level.level, unit.learning_outcome, unit.id]);
    }
  }
}
const server = app.listen(port, () => {
  void seedCurriculum().then(() => console.log('Curriculum seeded from curriculum_master.json')).catch((error) => console.error('Curriculum seed failed:', error instanceof Error ? error.message : error));
  console.log(`Einfaches Deutsch API listening on ${port}`);
});
process.on('SIGTERM', () => { server.close(() => { void pool?.end(); }); });
