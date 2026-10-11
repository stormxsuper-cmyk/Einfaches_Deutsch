// Row-level-security test. Needs a DISPOSABLE PostgreSQL database; everything runs inside one transaction that is rolled back.
//   RLS_TEST_CONFIRM=disposable DATABASE_URL=postgres://... npm run test:rls     (after: npm run migrate)
const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const { Client } = require('pg');
if (process.env.RLS_TEST_CONFIRM !== 'disposable' || !process.env.DATABASE_URL) { console.error('Refusing to run: set RLS_TEST_CONFIRM=disposable and DATABASE_URL (a throw-away database).'); process.exit(2); }
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const as = async (uid) => { await c.query('RESET ROLE'); await c.query('SET LOCAL ROLE rls_test_user'); await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid || '']); };
  const expectDenied = async (sql, params) => { await c.query('SAVEPOINT t'); try { await c.query(sql, params); assert.fail('expected RLS rejection'); } catch (e) { assert.equal(e.code, '42501', e.message); } finally { await c.query('ROLLBACK TO SAVEPOINT t'); } };
  try {
    await c.query('BEGIN');
    // Minimal stand-in for Supabase's auth.uid() when running on plain PostgreSQL.
    await c.query("CREATE SCHEMA IF NOT EXISTS auth");
    await c.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth' AND p.proname='uid') THEN CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $f$; END IF; END $$");
    await c.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rls_test_user') THEN CREATE ROLE rls_test_user NOLOGIN; END IF; END $$");
    await c.query('GRANT USAGE ON SCHEMA public, auth TO rls_test_user'); await c.query('GRANT EXECUTE ON FUNCTION auth.uid() TO rls_test_user');
    await c.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rls_test_user'); await c.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO rls_test_user');
    await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'supabase_rls.sql'), 'utf8'));
    await c.query('INSERT INTO app_profiles(id, display_name) VALUES ($1,$2),($3,$4)', [A, 'A', B, 'B']);
    await c.query("INSERT INTO mistakes(user_id, user_answer) VALUES ($1,'a'),($2,'b')", [A, B]);
    await c.query("INSERT INTO daily_plans(user_id, available_minutes) VALUES ($1,30),($2,30)", [A, B]);

    await as(A);
    assert.equal((await c.query('SELECT count(*)::int n FROM mistakes')).rows[0].n, 1, 'A sees only own mistakes');
    assert.equal((await c.query('SELECT count(*)::int n FROM app_profiles')).rows[0].n, 1, 'A sees only own profile');
    assert.equal((await c.query('SELECT count(*)::int n FROM daily_plans')).rows[0].n, 1);
    await expectDenied("INSERT INTO mistakes(user_id, user_answer) VALUES ($1,'x')", [B]);               // cannot write rows for B
    assert.equal((await c.query("UPDATE mistakes SET user_answer='hacked' WHERE user_id=$1", [B])).rowCount, 0); // cannot update B
    assert.equal((await c.query('DELETE FROM mistakes WHERE user_id=$1', [B])).rowCount, 0);               // cannot delete B
    await expectDenied("UPDATE mistakes SET user_id=$1 WHERE user_id=$2", [B, A]);                          // cannot hand rows to B
    assert.equal((await c.query('SELECT count(*)::int n FROM exercise_answer_keys')).rows[0].n, 0, 'answer keys unreadable');
    await as(null);
    assert.equal((await c.query('SELECT count(*)::int n FROM mistakes')).rows[0].n, 0, 'no identity -> no rows');
    await c.query('RESET ROLE');
    const pol = await c.query("SELECT count(*)::int n FROM pg_policies WHERE tablename='exercise_answer_keys'");
    assert.equal(pol.rows[0].n, 0, 'no policy may expose exercise_answer_keys');
    console.log('PASS: RLS isolates users, blocks cross-user writes/updates/deletes, hides answer keys');
  } catch (e) { console.error('FAIL:', e.message); process.exitCode = 1; }
  finally { try { await c.query('ROLLBACK'); } catch {} await c.end(); }
})();
