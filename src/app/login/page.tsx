import { safeNext } from '../../web/server/auth';
import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === 'string' ? params.next : '/');
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <p className="mb-1 text-lg font-bold tracking-tight">fyminance</p>
        <h1 className="mb-6 text-[15px] text-ink-2">Finanças do casal</h1>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
