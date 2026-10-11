// Dependency-free tests: JWT verification, rate limiter, sync validation + push/pull logic (fake DB).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-auth-'));
function loadTs(rel) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src', rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const out = path.join(tmp, rel.replace(/\.ts$/, '.js')); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, js); return require(out);
}
const b64 = (b) => Buffer.from(b).toString('base64url');
const SUB = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const claims = (o = {}) => ({ sub: SUB, aud: 'authenticated', role: 'authenticated', iss: 'https://x.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600, email: 'a@b.c', ...o });
const hs = (payload, secret, header = { alg: 'HS256', typ: 'JWT' }) => { const i = b64(JSON.stringify(header)) + '.' + b64(JSON.stringify(payload)); return i + '.' + crypto.createHmac('sha256', secret).update(i).digest('base64url'); };
const rejects = async (p, code) => { try { await p; } catch (e) { assert.equal(e.code, code, `expected ${code}, got ${e.code}`); return; } assert.fail(`expected rejection ${code}`); };

(async () => {
  const jwt = loadTs('auth/jwt.ts'); const sec = loadTs('security.ts'); const sync = loadTs('sync/sync.ts');
  const S = 'unit-test-secret-unit-test-secret';
  const cfg = { hs256Secret: S, issuer: 'https://x.supabase.co/auth/v1', audience: 'authenticated', clockToleranceSec: 30 };

  // --- HS256 ---
  const ok = await jwt.verifyJwt(hs(claims(), S), cfg);
  assert.equal(ok.sub, SUB); assert.equal(ok.email, 'a@b.c');
  await rejects(jwt.verifyJwt(hs(claims(), 'other-secret'), cfg), 'bad_signature');
  await rejects(jwt.verifyJwt(hs(claims({ exp: Math.floor(Date.now() / 1000) - 3600 }), S), cfg), 'expired');
  await rejects(jwt.verifyJwt(hs(claims({ nbf: Math.floor(Date.now() / 1000) + 3600 }), S), cfg), 'not_yet_valid');
  await rejects(jwt.verifyJwt(hs(claims({ aud: 'anon' }), S), cfg), 'bad_claims');
  await rejects(jwt.verifyJwt(hs(claims({ iss: 'https://evil/auth/v1' }), S), cfg), 'bad_claims');
  await rejects(jwt.verifyJwt(hs(claims({ sub: 'not-a-uuid' }), S), cfg), 'bad_claims');
  await rejects(jwt.verifyJwt(hs(claims({ role: 'service_role' }), S), cfg), 'bad_claims');
  await rejects(jwt.verifyJwt(hs(claims({ exp: undefined }), S), cfg), 'bad_claims');
  await rejects(jwt.verifyJwt(hs(claims(), S, { alg: 'none' }), cfg), 'unsupported_alg');
  await rejects(jwt.verifyJwt(b64('{"alg":"none"}') + '.' + b64(JSON.stringify(claims())) + '.', cfg), 'malformed_token');
  await rejects(jwt.verifyJwt('garbage', cfg), 'malformed_token');
  await rejects(jwt.verifyJwt(hs(claims(), S), { audience: 'authenticated', clockToleranceSec: 30 }), 'auth_not_configured');
  await rejects(jwt.verifyJwt(hs(claims(), S), { jwksUrl: 'http://127.0.0.1:1/jwks', audience: 'authenticated', clockToleranceSec: 30 }), 'unsupported_alg'); // HS256 not accepted when only JWKS is configured

  // --- RS256 / ES256 through a local JWKS server ---
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwks = { keys: [{ ...rsa.publicKey.export({ format: 'jwk' }), kid: 'rsa1', use: 'sig', alg: 'RS256' }, { ...ec.publicKey.export({ format: 'jwk' }), kid: 'ec1', use: 'sig', alg: 'ES256' }] };
  let fetches = 0;
  const srv = http.createServer((_q, r) => { fetches++; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(jwks)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const jcfg = { jwksUrl: `http://127.0.0.1:${srv.address().port}/jwks`, issuer: cfg.issuer, audience: 'authenticated', clockToleranceSec: 30 };
  const asym = (alg, kid, priv, payload) => { const i = b64(JSON.stringify({ alg, kid, typ: 'JWT' })) + '.' + b64(JSON.stringify(payload)); const sig = alg === 'RS256' ? crypto.sign('sha256', Buffer.from(i), priv) : crypto.sign('sha256', Buffer.from(i), { key: priv, dsaEncoding: 'ieee-p1363' }); return i + '.' + sig.toString('base64url'); };
  assert.equal((await jwt.verifyJwt(asym('RS256', 'rsa1', rsa.privateKey, claims()), jcfg)).sub, SUB);
  assert.equal((await jwt.verifyJwt(asym('ES256', 'ec1', ec.privateKey, claims()), jcfg)).sub, SUB);
  assert.equal(fetches, 1, 'JWKS must be cached');
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  await rejects(jwt.verifyJwt(asym('RS256', 'rsa1', other.privateKey, claims()), jcfg), 'bad_signature');
  await rejects(jwt.verifyJwt(asym('RS256', 'ec1', rsa.privateKey, claims()), jcfg), 'bad_signature'); // key type must match alg
  await rejects(jwt.verifyJwt(asym('RS256', 'unknown', rsa.privateKey, claims()), jcfg), 'key_unavailable');
  await rejects(jwt.verifyJwt(hs(claims(), 'x', { alg: 'HS256', kid: 'rsa1' }), jcfg), 'unsupported_alg');
  srv.close();

  // --- rate limiter ---
  const lim = sec.createRateLimiter({ windowMs: 1000, max: 2, key: () => 'k' });
  const mkRes = () => { const r = { code: 0, h: {}, setHeader(k, v) { r.h[k] = v; }, status(c) { r.code = c; return r; }, json() { return r; } }; return r; };
  let passed = 0; for (let i = 0; i < 4; i++) { const r = mkRes(); lim({}, r, () => passed++); if (i >= 2) { assert.equal(r.code, 429); assert.ok(r.h['Retry-After']); } }
  assert.equal(passed, 2);

  // --- sync validation + logic with a fake DB ---
  const U = '11111111-1111-4111-8111-111111111111', K = '22222222-2222-4222-8222-222222222222';
  const mkPool = (script) => { const log = []; const c = { async query(sql, params) { log.push({ sql, params }); return script(sql, params) || { rows: [] }; }, release() { log.released = true; } }; return { log, connect: async () => c }; };
  const now = Date.parse('2026-10-11T10:00:00Z');
  const good = { table: 'user_vocabulary', client_updated_at: '2026-10-11T09:59:00Z', row: { vocabulary_id: K, mastery_score: 40, ease_factor: 2.5 } };
  let p = mkPool((sql) => (/RETURNING "sync_seq"/.test(sql) ? { rows: [{ sync_seq: '5' }] } : null));
  let out = await sync.pushChanges(p, U, { changes: [good] }, now);
  assert.equal(out.results[0].status, 'applied');
  const ins = p.log.find((l) => l.sql.startsWith('INSERT'));
  assert.ok(!ins.sql.includes(K) && !ins.sql.includes('2.5'), 'values must be parameterised, never inlined');
  assert.equal(ins.params[0], U, 'user id always comes from the token');
  assert.ok(/ON CONFLICT \("user_id","vocabulary_id"\) DO UPDATE/.test(ins.sql) && /"updated_at" < EXCLUDED."updated_at"/.test(ins.sql));
  assert.ok(p.log.some((l) => l.sql.startsWith('SELECT pg_advisory_xact_lock')) && p.log.at(-1).sql === 'COMMIT' && p.log.released);

  // conflict -> server row returned
  p = mkPool((sql) => (/RETURNING "sync_seq"/.test(sql) ? { rows: [] } : sql.startsWith('SELECT "vocabulary_id"') ? { rows: [{ vocabulary_id: K, mastery_score: 90 }] } : null));
  out = await sync.pushChanges(p, U, { changes: [good] }, now);
  assert.equal(out.results[0].status, 'conflict'); assert.equal(out.results[0].server_row.mastery_score, 90);

  // client cannot smuggle user_id / unknown tables / bad values / non-syncable score tables
  const bads = [
    { ...good, row: { ...good.row, user_id: 'x' } }, { ...good, table: 'exam_results' }, { ...good, table: 'user_skills' }, { ...good, table: 'users; DROP TABLE x' },
    { ...good, row: { ...good.row, mastery_score: 101 } }, { ...good, row: { ...good.row, vocabulary_id: 'nope' } }, { ...good, client_updated_at: 'yesterday' },
    { ...good, row: { vocabulary_id: K, last_answer_quality: 9 } }, { table: 'mistakes', client_updated_at: '2026-10-11T09:00:00Z', row: { id: K, severity: 'catastrophic' } },
    { table: 'mistakes', client_updated_at: '2026-10-11T09:00:00Z', row: { id: K, user_answer: 'a\u0000b' } }, { table: 'review_events', row: { id: K, quality: 3 } },
  ];
  p = mkPool(() => ({ rows: [{ sync_seq: '1' }] }));
  out = await sync.pushChanges(p, U, { changes: bads }, now);
  assert.ok(out.results.every((r) => r.status === 'rejected'), JSON.stringify(out.results));
  assert.equal(p.log.filter((l) => l.sql.startsWith('INSERT')).length, 0, 'rejected changes never reach the database');

  // future timestamps are clamped
  p = mkPool(() => ({ rows: [{ sync_seq: '1' }] }));
  await sync.pushChanges(p, U, { changes: [{ ...good, client_updated_at: '2099-01-01T00:00:00Z' }] }, now);
  assert.equal(p.log.find((l) => l.sql.startsWith('INSERT')).params.at(-1), new Date(now + 5 * 60000).toISOString());

  // FK violation on one change does not abort the others
  let n = 0;
  p = mkPool((sql) => { if (sql.startsWith('INSERT') && ++n === 1) { const e = new Error('fk'); e.code = '23503'; throw e; } return /RETURNING "sync_seq"/.test(sql) ? { rows: [{ sync_seq: '2' }] } : null; });
  out = await sync.pushChanges(p, U, { changes: [good, good] }, now);
  assert.deepEqual(out.results.map((r) => r.status + ':' + (r.reason || '')), ['rejected:unknown_reference', 'applied:']);
  assert.ok(p.log.some((l) => l.sql === 'ROLLBACK TO SAVEPOINT change') && p.log.at(-1).sql === 'COMMIT');

  // size limits + append idempotency
  await assert.rejects(sync.pushChanges(mkPool(() => null), U, { changes: [] }, now));
  await assert.rejects(sync.pushChanges(mkPool(() => null), U, { changes: new Array(201).fill(good) }, now));
  p = mkPool(() => ({ rows: [] }));
  out = await sync.pushChanges(p, U, { changes: [{ table: 'review_events', row: { id: K, quality: 4, mastery_before: 10, mastery_after: 20, reviewed_at: '2026-10-11T09:00:00Z' } }] }, now);
  assert.equal(out.results[0].status, 'duplicate'); assert.ok(p.log.some((l) => /DO NOTHING/.test(l.sql)));

  // pull: invalid cursor rejected, cursor scoped to the user, paging bound
  await assert.rejects(sync.pullChanges(mkPool(() => null).connect().then((c) => c), U, "0; DROP TABLE x"));
  const rowsOf = (from, count) => Array.from({ length: count }, (_, i) => ({ sync_seq: String(from + i) }));
  const db = { calls: [], async query(sql, params) { this.calls.push(params); return { rows: /"user_vocabulary"/.test(sql) ? rowsOf(10, 501) : /"mistakes"/.test(sql) ? rowsOf(1, 3) : [] }; } };
  const pulled = await sync.pullChanges(db, U, '0');
  assert.ok(db.calls.every((c) => c[0] === U), 'every pull query is filtered by the token user');
  assert.equal(pulled.has_more, true); assert.equal(pulled.cursor, '509');
  assert.ok(pulled.changes.every((c) => BigInt(c.row.sync_seq) <= 509n));

  console.log('PASS: JWT (HS256/RS256/ES256, alg-confusion, claims), rate limiter, sync validation/conflicts/idempotency/paging');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
