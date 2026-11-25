/** Só caminhos internos do app; qualquer outra coisa (outro host, "//", barra invertida) volta para o painel. */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.includes('\\')) return '/';
  const base = 'http://fyminance.local';
  try {
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}` : '/';
  } catch {
    return '/';
  }
}
