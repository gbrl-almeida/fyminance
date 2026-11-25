import { describe, expect, it } from 'vitest';
import { sessions } from '../db/schema';
import { createTestDb } from '../db/testing';
import { hashPassword, setUserPassword, verifyPassword } from './passwords';
import { getSessionUser, login, logout, SESSION_DAYS } from './sessions';

const DAY = 86_400_000;
const T0 = new Date('2026-10-17T12:00:00.000Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);

function withUser() {
  const { db } = createTestDb();
  setUserPassword(db, 'pessoa2', 'senha-bem-longa', T0.toISOString());
  return db;
}

describe('passwords', () => {
  it('hash verifies only the right password', () => {
    const stored = hashPassword('senha-bem-longa');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('senha-bem-longa', stored)).toBe(true);
    expect(verifyPassword('senha-errada!!', stored)).toBe(false);
  });

  it('two hashes of the same password differ', () => {
    expect(hashPassword('senha-bem-longa')).not.toBe(hashPassword('senha-bem-longa'));
  });

  it('password shorter than 10 is refused', () => {
    const { db } = createTestDb();
    expect(() => setUserPassword(db, 'pessoa1', 'curta', T0.toISOString())).toThrow('A senha precisa ter pelo menos 10 caracteres.');
  });

  it('setting the password again replaces it', () => {
    const db = withUser();
    setUserPassword(db, 'pessoa2', 'outra-senha-longa', T0.toISOString());
    expect(login(db, 'pessoa2', 'senha-bem-longa', T0)).toBeNull();
    expect(login(db, 'pessoa2', 'outra-senha-longa', T0)).not.toBeNull();
  });
});

describe('sessions', () => {
  it('login fails with wrong password or unknown user', () => {
    const db = withUser();
    expect(login(db, 'pessoa2', 'senha-errada!!', T0)).toBeNull();
    expect(login(db, 'pessoa1', 'senha-bem-longa', T0)).toBeNull();
  });

  it('stores only the hash of the token', () => {
    const db = withUser();
    const session = login(db, 'pessoa2', 'senha-bem-longa', T0);
    const rows = db.select().from(sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(session?.token);
  });

  it('session lasts 180 days and renews when under 90', () => {
    const db = withUser();
    const session = login(db, 'pessoa2', 'senha-bem-longa', T0);
    if (session === null) throw new Error('login falhou');
    expect(session.expiresAt).toBe(at(SESSION_DAYS).toISOString());
    expect(getSessionUser(db, session.token, at(80))).toBe('pessoa2');
    expect(db.select().from(sessions).get()?.expiresAt).toBe(at(180).toISOString());
    expect(getSessionUser(db, session.token, at(91))).toBe('pessoa2');
    expect(db.select().from(sessions).get()?.expiresAt).toBe(at(91 + 180).toISOString());
  });

  it('expired session returns null and is deleted', () => {
    const db = withUser();
    const session = login(db, 'pessoa2', 'senha-bem-longa', T0);
    expect(getSessionUser(db, session?.token ?? '', at(181))).toBeNull();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it('logout invalidates the token', () => {
    const db = withUser();
    const session = login(db, 'pessoa2', 'senha-bem-longa', T0);
    logout(db, session?.token ?? '');
    expect(getSessionUser(db, session?.token ?? '', T0)).toBeNull();
  });

  it('unknown token returns null', () => {
    const db = withUser();
    expect(getSessionUser(db, 'nao-existe', T0)).toBeNull();
  });
});
