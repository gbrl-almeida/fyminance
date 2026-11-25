'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { login, logout } from '../../auth/sessions';
import { getAppContext } from '../../web/server/context';
import { SESSION_COOKIE, safeNext } from '../../web/server/auth';

export interface LoginState {
  error: string | null;
}

const WRONG = 'Nome ou senha incorretos.';

export async function loginAction(_previous: LoginState, form: FormData): Promise<LoginState> {
  const name = form.get('name');
  const password = form.get('password');
  const next = safeNext(String(form.get('next') ?? '/'));
  if ((name !== 'pessoa1' && name !== 'pessoa2') || typeof password !== 'string') return { error: WRONG };
  const session = login(getAppContext().db, name, password, new Date());
  if (session === null) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { error: WRONG };
  }
  const secure = (await headers()).get('x-forwarded-proto') === 'https';
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: new Date(session.expiresAt),
  });
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token !== undefined) logout(getAppContext().db, token);
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}
