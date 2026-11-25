import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Holder } from '../core/types';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';
import { verifyPassword } from './passwords';

export const SESSION_DAYS = 180;
const RENEW_BELOW_DAYS = 90;
const DAY_MS = 86_400_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');
const plusDays = (now: Date, days: number) => new Date(now.getTime() + days * DAY_MS).toISOString();

export function login(db: Db, name: Holder, password: string, now: Date): { token: string; expiresAt: string } | null {
  const user = db.select().from(users).where(eq(users.name, name)).get();
  if (user === undefined || !verifyPassword(password, user.passwordHash)) return null;
  const token = randomBytes(32).toString('base64url');
  const expiresAt = plusDays(now, SESSION_DAYS);
  db.insert(sessions).values({ tokenHash: hashToken(token), userName: name, expiresAt, createdAt: now.toISOString() }).run();
  return { token, expiresAt };
}

/** Dono da sessão, renovando-a quando faltam menos de 90 dias; sessão vencida é apagada. */
export function getSessionUser(db: Db, token: string, now: Date): Holder | null {
  const tokenHash = hashToken(token);
  const session = db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get();
  if (session === undefined) return null;
  const remainingMs = Date.parse(session.expiresAt) - now.getTime();
  if (remainingMs <= 0) {
    db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
    return null;
  }
  if (remainingMs < RENEW_BELOW_DAYS * DAY_MS) {
    db.update(sessions).set({ expiresAt: plusDays(now, SESSION_DAYS) }).where(eq(sessions.tokenHash, tokenHash)).run();
  }
  return session.userName;
}

export function logout(db: Db, token: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}
