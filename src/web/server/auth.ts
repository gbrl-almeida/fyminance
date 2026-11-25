import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../auth/sessions';
import type { Holder } from '../../core/types';
import type { CurationContext } from '../../curation/context';
import { getAppContext } from './context';

export const SESSION_COOKIE = 'fy_session';
export const PATH_HEADER = 'x-fy-path';

export async function currentUser(): Promise<Holder | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token === undefined) return null;
  return getSessionUser(getAppContext().db, token, new Date());
}

/** Dono da sessão; sem sessão válida, vai para o login e volta para a mesma página depois. */
export async function requireUser(nextPath?: string): Promise<Holder> {
  const user = await currentUser();
  if (user !== null) return user;
  const path = nextPath ?? (await headers()).get(PATH_HEADER) ?? '/';
  redirect(`/login?next=${encodeURIComponent(path)}`);
}

export function curationContext(user: Holder): CurationContext {
  const app = getAppContext();
  return { pipeline: app.pipeline, now: app.now, actor: user };
}

export { safeNext } from '../safe-next';
