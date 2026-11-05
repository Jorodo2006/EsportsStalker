// Puerta de entrada: sin sesión sólo se ve la pantalla de entrar o crear cuenta. Cada usuario tiene su cartera.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/format';
import { Button, ErrorBox, Field, Input, Loading } from './ui';

// Usuario conectado (ya cargado por AuthGate cuando se usa dentro de la app)
export function useUser() {
  return useQuery({ queryKey: ['me'], queryFn: () => window.api.auth.me(), staleTime: Infinity, retry: 1 });
}

export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: user, isLoading, error, refetch } = useUser();
  useEffect(() => {
    const lost = () => qc.setQueryData(['me'], null);
    window.addEventListener('auth:lost', lost);
    return () => window.removeEventListener('auth:lost', lost);
  }, [qc]);
  if (isLoading) return <div className="grid h-full place-items-center"><Loading /></div>;
  if (error) return (
    <div className="mx-auto max-w-md p-6">
      <ErrorBox error={error} />
      <Button className="mt-3" variant="secondary" onClick={() => refetch()}>Reintentar</Button>
    </div>
  );
  return user ? <>{children}</> : <LoginScreen />;
}

function LoginScreen() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ['authConfig'], queryFn: () => window.api.auth.config() });
  const [choice, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // La primera cuenta sólo se puede crear; con el registro cerrado, sólo se puede entrar
  const mode = cfg?.first ? 'register' : cfg && !cfg.signupOpen ? 'login' : choice;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== repeat) { setError('Las contraseñas no coinciden'); return; }
    setBusy(true);
    try {
      const user = await (mode === 'register' ? window.api.auth.register(username, password) : window.api.auth.login(username, password));
      qc.setQueryData(['me'], user);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto px-4 py-10 sm:items-center">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center font-score text-3xl font-bold tracking-tight">Esports<span className="text-amber-400">Stalker</span></div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          {cfg?.first
            ? <p className="text-sm text-zinc-300">Crea la primera cuenta. Será la de <b>administrador</b> y se quedará con las apuestas y la cartera que ya hay guardadas.</p>
            : cfg?.signupOpen && (
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-950/60 p-1">
                {(['login', 'register'] as const).map(m => (
                  <button key={m} type="button" onClick={() => { setMode(m); setError(''); }}
                    className={cn('cursor-pointer rounded-md py-2 text-sm font-medium transition', mode === m ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200')}>
                    {m === 'login' ? 'Entrar' : 'Crear cuenta'}
                  </button>
                ))}
              </div>
            )}
          <Field label="Usuario"><Input required autoFocus autoComplete="username" autoCapitalize="none" autoCorrect="off" value={username} onChange={e => setUsername(e.target.value)} /></Field>
          <Field label="Contraseña" hint={mode === 'register' ? 'Al menos 8 caracteres.' : undefined}>
            <Input required type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} />
          </Field>
          {mode === 'register' && <Field label="Repite la contraseña"><Input required type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} /></Field>}
          {error && <div className="text-sm text-rose-300" role="alert">{error}</div>}
          <Button type="submit" className="h-11 w-full" disabled={busy || !cfg}>{mode === 'register' ? 'Crear cuenta' : 'Entrar'}</Button>
        </form>
      </div>
    </div>
  );
}
