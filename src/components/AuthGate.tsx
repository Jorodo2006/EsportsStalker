// Puerta de entrada: sin sesión sólo se ve la pantalla de entrar o crear cuenta. Cada usuario tiene su cartera.
import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Check, Eye, EyeOff, Loader2, Scale, Target, Wallet } from 'lucide-react';
import { cn } from '@/lib/format';
import { Button, ErrorBox, Field, Input, Loading, seg } from './ui';

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

// Las mismas reglas que el servidor (server/services/bets/auth.js): se avisa antes de mandar el formulario
const USERNAME = /^[\p{L}\p{N}_.-]{3,30}$/u;
const MIN_PASSWORD = 8;

const FEATURES: { icon: typeof CalendarDays; title: string; text: string }[] = [
  { icon: CalendarDays, title: 'Cuatro deportes, en directo', text: 'LoL, NBA, Euroliga, NBL, ATP, WTA, LaLiga, Champions y más, con marcadores y estadísticas.' },
  { icon: Scale, title: 'Cuotas comparadas', text: 'Winamax y Betway, leídas solas cada pocos minutos, con la mejor de cada línea a la vista.' },
  { icon: Target, title: 'Recomendaciones con su valor', text: 'La probabilidad del modelo frente a la de la casa, y cuánto fiarse de cada una.' },
  { icon: Wallet, title: 'Tu cartera y tus apuestas', text: 'Beneficio, ROI y gráficas. Las apuestas de cada usuario sólo las ve él.' }
];

function LoginScreen() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ['authConfig'], queryFn: () => window.api.auth.config() });
  const [choice, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // La primera cuenta sólo se puede crear; con el registro cerrado, sólo se puede entrar
  const mode = cfg?.first ? 'register' : cfg && !cfg.signupOpen ? 'login' : choice;
  const register = mode === 'register';
  const canSwitch = !!cfg && !cfg.first && cfg.signupOpen;

  const nameOk = USERNAME.test(username.trim());
  const longOk = password.length >= MIN_PASSWORD;
  const sameOk = !!repeat && password === repeat;
  const ready = register ? nameOk && longOk && sameOk : !!username.trim() && !!password;

  const switchTo = (m: 'login' | 'register') => { setMode(m); setError(''); setRepeat(''); setTouched(false); };
  const capsOf = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setTouched(true);
    if (register && !nameOk) { setError('El usuario debe tener de 3 a 30 letras, números o . _ -'); return; }
    if (register && !longOk) { setError(`La contraseña necesita al menos ${MIN_PASSWORD} caracteres`); return; }
    if (register && !sameOk) { setError('Las contraseñas no coinciden'); return; }
    setBusy(true);
    try {
      const user = await (register ? window.api.auth.register(username.trim(), password) : window.api.auth.login(username.trim(), password));
      qc.setQueryData(['me'], user);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  const rule = (ok: boolean, text: string) => (
    <li className={cn('flex items-center gap-1.5', ok ? 'text-emerald-300' : 'text-zinc-500')}><Check size={13} className={ok ? '' : 'opacity-40'} />{text}</li>
  );

  // En el ordenador, a la izquierda qué es la app y a la derecha el formulario. En el móvil, el titular arriba, el formulario
  // y debajo lo que ofrece
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid min-h-full max-w-6xl grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
        <section className="flex flex-col justify-center gap-8 px-5 pb-2 pt-10 sm:px-10 lg:py-16">
          <div>
            <div className="text-xl font-semibold tracking-tight text-zinc-50">Sharpex</div>
            <h1 className="mt-6 max-w-lg text-3xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-4xl">Apuesta con datos, no con corazonadas.</h1>
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-zinc-400">
              Partidos, cuotas, recomendaciones del modelo y tu registro de apuestas de LoL, baloncesto, tenis y fútbol, en un mismo sitio.
            </p>
          </div>
          <ul className="hidden max-w-lg flex-col gap-5 lg:flex">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <Icon size={18} className="mt-0.5 shrink-0 text-amber-400" />
                <div><div className="text-sm font-medium text-zinc-100">{title}</div><div className="text-sm text-zinc-500">{text}</div></div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col justify-center px-5 py-8 sm:px-10 lg:border-l lg:border-zinc-800 lg:py-16">
          <form onSubmit={submit} noValidate className="mx-auto w-full max-w-sm">
            <h2 className="text-xl font-semibold text-zinc-50">{register ? (cfg?.first ? 'Crea la cuenta de administrador' : 'Crea tu cuenta') : 'Entra en tu cuenta'}</h2>
            <p className="mt-1 text-sm text-zinc-500">{register ? 'Tu cartera y tus apuestas serán sólo tuyas.' : 'Con tu usuario y tu contraseña.'}</p>

            {canSwitch && (
              <div className="mt-6 grid grid-cols-2 gap-0.5 rounded-lg bg-zinc-900 p-0.5 ring-1 ring-inset ring-zinc-800" role="tablist">
                {(['login', 'register'] as const).map(m => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchTo(m)} className={seg(mode === m)}>
                    {m === 'login' ? 'Entrar' : 'Crear cuenta'}
                  </button>
                ))}
              </div>
            )}
            {cfg?.first && (
              <p className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3.5 py-3 text-sm text-zinc-300">
                Eres el primero: esta cuenta será la de <b className="text-zinc-50">administrador</b>, la que cambia los ajustes de la app, y se quedará con las apuestas y la cartera que ya hay guardadas.
              </p>
            )}

            <div className="mt-6 space-y-4">
              <Field label="Usuario" hint={register ? 'De 3 a 30 letras, números o . _ -' : undefined}>
                <Input required autoFocus autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username}
                  aria-invalid={register && touched && !nameOk} onChange={e => setUsername(e.target.value)} onBlur={() => register && username && setTouched(true)} />
              </Field>
              <Field label="Contraseña">
                <div className="relative">
                  <Input required type={show ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} className="pr-11"
                    value={password} onChange={e => setPassword(e.target.value)} onKeyUp={capsOf} onKeyDown={capsOf} />
                  <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Ocultar la contraseña' : 'Ver la contraseña'} title={show ? 'Ocultar' : 'Ver'}
                    className="absolute inset-y-0 right-0 grid w-10 cursor-pointer place-items-center text-zinc-500 transition hover:text-zinc-200">
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>
              {register && (
                <Field label="Repite la contraseña">
                  <Input required type={show ? 'text' : 'password'} autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} onKeyUp={capsOf} />
                </Field>
              )}
              {caps && <p className="flex items-center gap-1.5 text-xs text-amber-300"><AlertTriangle size={13} />Tienes activadas las mayúsculas</p>}
              {register && (
                <ul className="space-y-1 text-xs" aria-label="Requisitos">
                  {rule(nameOk, 'Usuario válido')}
                  {rule(longOk, `Al menos ${MIN_PASSWORD} caracteres`)}
                  {rule(sameOk, 'Las dos contraseñas coinciden')}
                </ul>
              )}
              <div aria-live="polite">{error && <ErrorBox error={error} />}</div>
              <Button type="submit" className="h-11 w-full" disabled={busy || !cfg || !ready}>
                {busy && <Loader2 size={16} className="animate-spin" />}
                {busy ? (register ? 'Creando la cuenta…' : 'Entrando…') : register ? 'Crear cuenta' : 'Entrar'}
              </Button>
            </div>

            <p className="mt-5 text-center text-sm text-zinc-500">
              {canSwitch
                ? register
                  ? <>¿Ya tienes cuenta? <button type="button" className="cursor-pointer font-medium text-amber-400 hover:underline" onClick={() => switchTo('login')}>Entra</button></>
                  : <>¿No tienes cuenta? <button type="button" className="cursor-pointer font-medium text-amber-400 hover:underline" onClick={() => switchTo('register')}>Créala</button></>
                : cfg && !cfg.first && !cfg.signupOpen ? 'El registro está cerrado: pídele una cuenta al administrador.' : null}
            </p>
          </form>

          <ul className="mx-auto mt-10 flex w-full max-w-sm flex-col gap-4 border-t border-zinc-800 pt-6 lg:hidden">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <Icon size={16} className="mt-0.5 shrink-0 text-amber-400" />
                <div><div className="text-sm font-medium text-zinc-100">{title}</div><div className="text-xs text-zinc-500">{text}</div></div>
              </li>
            ))}
          </ul>
          <p className="mx-auto mt-10 max-w-sm text-center text-xs text-zinc-600">Sólo para mayores de 18 años. Juega con responsabilidad: apuesta sólo lo que puedas permitirte perder.</p>
        </section>
      </div>
    </div>
  );
}
