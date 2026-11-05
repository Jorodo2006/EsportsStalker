// Puerta de entrada: sin sesión sólo se ve la pantalla de entrar o crear cuenta. Cada usuario tiene su cartera.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SquareTerminal } from 'lucide-react';
import { Button, ErrorBox, Field, Input, Loading, Mark, seg } from './ui';

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
        <div className="mb-6 flex items-center justify-center gap-2 text-2xl font-bold tracking-tight">
          <SquareTerminal size={24} className="text-amber-400" /><span>Esports<span className="text-amber-400">Stalker</span></span>
        </div>
        <form onSubmit={submit} className="overflow-hidden rounded-2xl border border-zinc-800 bg-surface shadow-2xl shadow-black/40">
          <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-5 py-2.5 text-sm font-semibold">
            <Mark />{mode === 'register' ? 'Crear cuenta' : 'Entrar'}
          </div>
          <div className="space-y-4 p-5">
          {cfg?.first
            ? <p className="text-sm text-zinc-300">Crea la primera cuenta. Será la de <b>administrador</b> y se quedará con las apuestas y la cartera que ya hay guardadas.</p>
            : cfg?.signupOpen && (
              <div className="grid grid-cols-2 gap-0.5 rounded-full bg-zinc-900 p-1 ring-1 ring-inset ring-zinc-800">
                {(['login', 'register'] as const).map(m => (
                  <button key={m} type="button" onClick={() => { setMode(m); setError(''); }} aria-pressed={mode === m}
                    className={seg(mode === m)}>
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
          </div>
        </form>
      </div>
    </div>
  );
}
