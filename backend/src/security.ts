import type { Request, Response, NextFunction } from 'express';

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}
export const noStore = (_req: Request, res: Response, next: NextFunction): void => { res.setHeader('Cache-Control', 'no-store'); next(); };

export interface LimiterOptions { windowMs: number; max: number; key: (req: Request, res: Response) => string }
/** Fixed-window in-memory limiter. Single-instance only: use a shared store (e.g. Redis) when running several replicas. */
export function createRateLimiter(opts: LimiterOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    if (hits.size > 50_000) hits.clear();
    const k = opts.key(req, res);
    let h = hits.get(k);
    if (!h || h.resetAt <= now) { h = { count: 0, resetAt: now + opts.windowMs }; hits.set(k, h); }
    h.count++;
    if (h.count > opts.max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((h.resetAt - now) / 1000))));
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    next();
  };
}
export function parseOrigins(value: string | undefined): string[] {
  return (value || 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean);
}
