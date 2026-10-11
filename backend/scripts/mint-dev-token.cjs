// Local development only: mints an HS256 token the API accepts when SUPABASE_JWT_SECRET is set.
// Usage: SUPABASE_JWT_SECRET=... node scripts/mint-dev-token.cjs [user-uuid]
const crypto = require('node:crypto');
const secret = process.env.SUPABASE_JWT_SECRET;
if (!secret) { console.error('Set SUPABASE_JWT_SECRET first.'); process.exit(1); }
const sub = process.argv[2] || crypto.randomUUID();
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const payload = { sub, aud: 'authenticated', role: 'authenticated', email: 'dev@example.test', exp: Math.floor(Date.now() / 1000) + 3600 };
if (process.env.AUTH_JWT_ISSUER) payload.iss = process.env.AUTH_JWT_ISSUER;
const input = `${b({ alg: 'HS256', typ: 'JWT' })}.${b(payload)}`;
console.log(`user: ${sub}\n${input}.${crypto.createHmac('sha256', secret).update(input).digest('base64url')}`);
