import { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.ts';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(options: { windowMs: number; maxRequests: number; keyPrefix: string }) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const identity = req.dbUser?.uid || req.ip || 'anon';
    const key = `${options.keyPrefix}:${identity}`;
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (existing.count >= options.maxRequests) {
      res.status(429).json({
        error: 'Rate limit exceeded. Please wait before launching additional evaluation requests.',
        retryAfterMs: existing.resetAt - now,
      });
      return;
    }

    existing.count++;
    next();
  };
}
