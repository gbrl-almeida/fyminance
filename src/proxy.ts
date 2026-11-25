import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from './auth/sessions';
import { getAppContext } from './web/server/context';

const SESSION_COOKIE = 'fy_session';
const SESSION_SECONDS = 180 * 86_400;

/** Sem sessão válida, vai ao login e volta depois para o mesmo caminho. */
export function proxy(request: NextRequest) {
  const path = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  // Toda requisição (página, navegação no cliente, server action) passa por aqui: a sessão é validada no banco.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  // Server actions validam a sessão com requireUser, que redireciona ao login do jeito que a action entende.
  const isAction = request.headers.has('next-action');
  if (!isAction && (token === undefined || getSessionUser(getAppContext().db, token, new Date()) === null)) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', path);
    const response = NextResponse.redirect(login);
    if (token !== undefined) response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  const headers = new Headers(request.headers);
  headers.set('x-fy-path', path);
  if (token === undefined) return NextResponse.next({ request: { headers } });
  const response = NextResponse.next({ request: { headers } });
  // O cookie acompanha a renovação da sessão: cada visita empurra a validade para frente.
  const secure = request.headers.get('x-forwarded-proto') === 'https' || request.nextUrl.protocol === 'https:';
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_SECONDS,
  });
  return response;
}

export const config = {
  matcher: ['/((?!login|_next/|favicon.ico|icon|apple-icon).*)'],
};
