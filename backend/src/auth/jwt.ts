import crypto from 'node:crypto';

export type AuthErrorCode =
  | 'auth_not_configured' | 'malformed_token' | 'unsupported_alg' | 'bad_signature'
  | 'expired' | 'not_yet_valid' | 'bad_claims' | 'key_unavailable';

export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode) { super(code); }
}

export interface AuthConfig {
  hs256Secret?: string;   // Supabase "JWT secret" (legacy symmetric signing)
  jwksUrl?: string;       // Supabase asymmetric signing keys (RS256 / ES256)
  issuer?: string;
  audience: string;
  clockToleranceSec: number;
}
export interface VerifiedUser { sub: string; email?: string }

export function loadAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const base = env.SUPABASE_URL ? env.SUPABASE_URL.replace(/\/+$/, '') : undefined;
  return {
    hs256Secret: env.SUPABASE_JWT_SECRET || undefined,
    jwksUrl: env.AUTH_JWKS_URL || (base ? `${base}/auth/v1/.well-known/jwks.json` : undefined),
    issuer: env.AUTH_JWT_ISSUER || (base ? `${base}/auth/v1` : undefined),
    audience: env.AUTH_JWT_AUDIENCE || 'authenticated',
    clockToleranceSec: 30,
  };
}
export const isAuthConfigured = (c: AuthConfig): boolean => Boolean(c.hs256Secret || c.jwksUrl);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const b64u = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ---- JWKS cache (only keys fetched from the configured URL are ever trusted) ----
interface JwksEntry { keys: Map<string, crypto.KeyObject>; fetchedAt: number; lastAttempt: number }
const jwksCache = new Map<string, JwksEntry>();
const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 60 * 1000;
export const resetJwksCache = (): void => jwksCache.clear();

async function refreshJwks(url: string, entry?: JwksEntry): Promise<JwksEntry> {
  const now = Date.now();
  const next: JwksEntry = entry ?? { keys: new Map(), fetchedAt: 0, lastAttempt: 0 };
  next.lastAttempt = now;
  jwksCache.set(url, next);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`jwks ${res.status}`);
    const body = (await res.json()) as { keys?: Array<Record<string, unknown>> };
    const keys = new Map<string, crypto.KeyObject>();
    for (const jwk of body.keys ?? []) {
      if ((jwk.kty !== 'RSA' && jwk.kty !== 'EC') || (jwk.use !== undefined && jwk.use !== 'sig')) continue;
      try { keys.set(typeof jwk.kid === 'string' ? jwk.kid : '_default', crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' })); } catch { /* skip unusable key */ }
    }
    if (keys.size > 0) { next.keys = keys; next.fetchedAt = now; }
  } catch { /* keep any previous keys */ }
  return next;
}

async function getVerificationKey(url: string, kid: string | undefined): Promise<crypto.KeyObject> {
  const now = Date.now();
  let entry = jwksCache.get(url);
  const pick = (e?: JwksEntry): crypto.KeyObject | undefined => {
    if (!e) return undefined;
    if (kid !== undefined) return e.keys.get(kid);
    return e.keys.size === 1 ? [...e.keys.values()][0] : undefined;
  };
  const fresh = entry !== undefined && now - entry.fetchedAt < JWKS_TTL_MS;
  const hit = fresh ? pick(entry) : undefined;
  if (hit) return hit;
  if (!entry || !fresh || now - entry.lastAttempt >= JWKS_MIN_REFETCH_MS) entry = await refreshJwks(url, entry);
  const key = pick(entry);
  if (!key) throw new AuthError('key_unavailable');
  return key;
}

export async function verifyJwt(token: string, cfg: AuthConfig, nowMs: number = Date.now()): Promise<VerifiedUser> {
  if (!isAuthConfigured(cfg)) throw new AuthError('auth_not_configured');
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) throw new AuthError('malformed_token');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[2] || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw new AuthError('malformed_token');

  let header: Record<string, unknown>; let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64u(parts[0]).toString('utf8'));
    payload = JSON.parse(b64u(parts[1]).toString('utf8'));
  } catch { throw new AuthError('malformed_token'); }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') throw new AuthError('malformed_token');

  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = b64u(parts[2]);

  // The algorithm decides which key source is used; keys are never interchangeable (prevents alg-confusion).
  if (header.alg === 'HS256') {
    if (!cfg.hs256Secret) throw new AuthError('unsupported_alg');
    const mac = crypto.createHmac('sha256', cfg.hs256Secret).update(signingInput).digest();
    if (mac.length !== sig.length || !crypto.timingSafeEqual(mac, sig)) throw new AuthError('bad_signature');
  } else if (header.alg === 'RS256' || header.alg === 'ES256') {
    if (!cfg.jwksUrl) throw new AuthError('unsupported_alg');
    const key = await getVerificationKey(cfg.jwksUrl, typeof header.kid === 'string' ? header.kid : undefined);
    let ok = false;
    try {
      if (header.alg === 'RS256') ok = key.asymmetricKeyType === 'rsa' && crypto.verify('sha256', signingInput, key, sig);
      else ok = key.asymmetricKeyType === 'ec' && crypto.verify('sha256', signingInput, { key, dsaEncoding: 'ieee-p1363' }, sig);
    } catch { ok = false; }
    if (!ok) throw new AuthError('bad_signature');
  } else {
    throw new AuthError('unsupported_alg'); // includes "none"
  }

  const tol = cfg.clockToleranceSec;
  const nowS = Math.floor(nowMs / 1000);
  if (typeof payload.exp !== 'number') throw new AuthError('bad_claims');
  if (nowS > payload.exp + tol) throw new AuthError('expired');
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number') throw new AuthError('bad_claims');
    if (nowS + tol < payload.nbf) throw new AuthError('not_yet_valid');
  }
  if (cfg.issuer && payload.iss !== cfg.issuer) throw new AuthError('bad_claims');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(cfg.audience)) throw new AuthError('bad_claims');
  if (payload.role !== undefined && payload.role !== 'authenticated') throw new AuthError('bad_claims');
  if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) throw new AuthError('bad_claims');
  return { sub: payload.sub.toLowerCase(), email: typeof payload.email === 'string' ? payload.email : undefined };
}
