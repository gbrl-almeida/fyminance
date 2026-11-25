'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OWNER_LABEL } from '../../owner-labels';
import { loginAction, type LoginState } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-ink-2">Quem é você?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['pessoa1', OWNER_LABEL.pessoa1],
              ['pessoa2', OWNER_LABEL.pessoa2],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center justify-center rounded-lg border border-line bg-surface px-3 py-3 text-[15px] font-medium has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white">
              <input type="radio" name="name" value={value} className="sr-only" required />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2 text-sm text-ink-2">
        Senha
        <Input type="password" name="password" autoComplete="current-password" required className="h-11 bg-surface text-[15px]" />
      </label>
      {state.error !== null && <p className="text-sm text-warn">{state.error}</p>}
      <Button type="submit" disabled={pending} className="h-11 text-[15px]">
        {pending ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  );
}
