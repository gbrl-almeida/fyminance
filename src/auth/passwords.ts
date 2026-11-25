import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Holder } from '../core/types';
import type { Db } from '../db/client';
import { users } from '../db/schema';

const KEY_LENGTH = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };
const MIN_LENGTH = 10;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, PARAMS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, PARAMS);
  return timingSafeEqual(actual, expected);
}

export function setUserPassword(db: Db, name: Holder, password: string, nowIso: string): void {
  if (password.length < MIN_LENGTH) throw new Error(`A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`);
  const passwordHash = hashPassword(password);
  db.insert(users)
    .values({ name, passwordHash, createdAt: nowIso })
    .onConflictDoUpdate({ target: users.name, set: { passwordHash } })
    .run();
}
