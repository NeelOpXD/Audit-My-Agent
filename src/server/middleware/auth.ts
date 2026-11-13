import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../../db/index.ts';
import { ciTokens, users } from '../../db/schema.ts';
import { getOrCreateUser } from '../../db/users.ts';

export interface DbUserRecord {
  id: number;
  uid: string;
  email: string;
  createdAt: Date;
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  dbUser?: DbUserRecord;
  authMethod?: 'firebase' | 'ci_token';
}

export const CI_TOKEN_PREFIX = 'ama_ci_';

export function hashCiToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateCiToken(): {
  plaintext: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const secret = crypto.randomBytes(24).toString('base64url');
  const plaintext = `${CI_TOKEN_PREFIX}${secret}`;
  const tokenPrefix = `${plaintext.slice(0, 12)}••••${plaintext.slice(-4)}`;
  return {
    plaintext,
    tokenHash: hashCiToken(plaintext),
    tokenPrefix,
  };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  const apiKeyHeader =
    typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'].trim() : null;
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : null;

  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : null;

  const rawToken = bearerToken || apiKeyHeader || queryToken;

  if (!rawToken) {
    res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
    return;
  }

  // Scoped CI/CD PR Gate Token authentication
  if (rawToken.startsWith(CI_TOKEN_PREFIX)) {
    try {
      const tokenHash = hashCiToken(rawToken);
      const [tokenRow] = await db
        .select({
          token: ciTokens,
          user: users,
        })
        .from(ciTokens)
        .innerJoin(users, eq(ciTokens.userId, users.id))
        .where(and(eq(ciTokens.tokenHash, tokenHash), isNull(ciTokens.revokedAt)));

      if (!tokenRow) {
        res.status(401).json({ error: 'Unauthorized: Invalid or revoked CI token' });
        return;
      }

      req.authMethod = 'ci_token';
      req.dbUser = tokenRow.user;

      // Best-effort lastUsedAt update (do not fail auth if timestamp update races)
      void db
        .update(ciTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(ciTokens.id, tokenRow.token.id))
        .catch(() => {});

      next();
      return;
    } catch (error) {
      console.error('Error verifying CI token:', error);
      res.status(401).json({ error: 'Unauthorized: CI token verification failed' });
      return;
    }
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(rawToken);
    req.authMethod = 'firebase';
    req.user = decodedToken;
    const dbUser = await getOrCreateUser(
      decodedToken.uid,
      decodedToken.email || `${decodedToken.uid}@firebase.local`
    );
    req.dbUser = dbUser;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

export const requireFirebaseSession = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (req.authMethod !== 'firebase') {
    res.status(403).json({
      error: 'Forbidden: CI API tokens cannot manage user sessions or mint/revoke CI tokens.',
    });
    return;
  }
  next();
};
