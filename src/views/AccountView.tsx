// Tu cuenta: lo de cada usuario, a lo que entra cualquiera. Contraseña y salir, su banca inicial (cada uno tiene su cartera) y
// los avisos de este navegador. Los ajustes de la app (moneda, casas, cuotas automáticas…) son del administrador y valen para
// todos: están en SettingsView
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, LogOut, Settings as Cog, X } from 'lucide-react';
import { useApp, useCurrency, useWallet } from '@/lib/app-context';
import { cn, money } from '@/lib/format';
import { GoogleMark, useUser } from '@/components/AuthGate';
import { Button, Card, Field, Input, PageHeader, TeamLogo } from '@/components/ui';
import { Toggle } from '@/components/sport';
import { useFavorites } from '@/components/Favorites';
import { alertPrefs, askPermission, notifyPermission, setAlertPrefs, type AlertKind } from '@/lib/notify';

export default function AccountView() {
  const isAdmin = !!useUser().data?.isAdmin;
  const { go } = useApp();
  return (
    <>
      <PageHeader title="Tu cuenta" subtitle="Tu contraseña, tu cartera, tus avisos y tus favoritos" />
      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <Notice />
        <AccountCard isAdmin={isAdmin} />
        <WalletCard />
        <AlertsCard />
        <FavoritesCard />
        {isAdmin && (
          <Card title="Ajustes de la app">
            <p className="mb-4 text-sm text-zinc-400">Moneda, casas del comparador, cuotas automáticas, registro de cuentas… Eres administrador: lo que cambies allí vale para todos los usuarios.</p>
            <Button variant="secondary" onClick={() => go('settings')}><Cog size={14} />Abrir los ajustes</Button>
          </Card>
        )}
      </div>
    </>
  );
}

// Resultado de vincular Google (lo deja app-context al volver de Google): se queda hasta cerrarlo
function Notice() {
  const [n, setN] = useState<{ ok: boolean; text: string } | null>(() => { try { return JSON.parse(sessionStorage.getItem('account-notice') || 'null'); } catch { return null; } });
  if (!n) return null;
  const close = () => { setN(null); try { sessionStorage.removeItem('account-notice'); } catch { /* sin almacenamiento */ } };
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm 2xl:col-span-2', n.ok ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-200' : 'border-rose-500/40 bg-rose-500/5 text-rose-200')}>
      {n.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-400" />}
      <span className="min-w-0 flex-1">{n.text}</span>
      <button onClick={close} aria-label="Cerrar" className="shrink-0 cursor-pointer text-zinc-400 transition hover:text-zinc-100"><X size={16} /></button>
    </div>
  );
}

// La banca inicial de cada uno: con el beneficio de sus apuestas da su cartera
function WalletCard() {
  const { settings, saveSettings, toast } = useApp();
  const cur = useCurrency();
  const w = useWallet();
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (settings) setV(String(settings.initialBankroll ?? 0)); }, [settings?.initialBankroll]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await saveSettings({ initialBankroll: Math.max(0, parseFloat(v.replace(',', '.')) || 0) }); toast('Banca guardada'); }
    catch (err) { toast((err as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Card title="Tu cartera">
      <p className="mb-4 text-sm text-zinc-400">
        Lo que tenías para apostar al empezar. Se le suma el beneficio de tus apuestas: ahora tienes <b className="text-zinc-100 tnum">{money(w.balance, cur)}</b>.
      </p>
      <form onSubmit={submit} className="grid grid-cols-[1fr_auto] items-end gap-3">
        <Field label={`Banca inicial (${cur})`}><Input type="number" inputMode="decimal" step="0.01" min={0} value={v} onChange={e => setV(e.target.value)} /></Field>
        <Button type="submit" variant="secondary" disabled={busy}>Guardar</Button>
      </form>
    </Card>
  );
}

// Contraseña y salir
function AccountCard({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useApp();
  const qc = useQueryClient();
  const user = useUser().data;
  const { data: cfg } = useQuery({ queryKey: ['authConfig'], queryFn: () => window.api.auth.config(), staleTime: 10 * 60e3 });
  // Quien se registró con Google no tiene contraseña: se pone una sin que se le pida la actual
  const hasPassword = user?.hasPassword !== false;
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [busy, setBusy] = useState(false);

  async function change(e: FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.repeat) { toast('Las contraseñas no coinciden'); return; }
    setBusy(true);
    try {
      await window.api.auth.changePassword(hasPassword ? pw.current : '', pw.next);
      setPw({ current: '', next: '', repeat: '' });
      toast(hasPassword ? 'Contraseña cambiada' : 'Contraseña puesta: ya puedes entrar también con tu usuario');
      if (!hasPassword) qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) { toast((err as Error).message); }
    finally { setBusy(false); }
  }

  async function logout() {
    await window.api.auth.logout();
    // El cupón se queda en el navegador: no debe verlo quien entre después
    try { localStorage.removeItem('slip'); } catch { /* sin almacenamiento */ }
    location.reload();
  }

  return (
    <Card className="2xl:col-span-2" title="Tu cuenta" action={<Button variant="secondary" size="sm" onClick={logout}><LogOut size={14} />Salir</Button>}>
      <p className="mb-4 text-sm text-zinc-400">
        Has entrado como <b className="text-zinc-100">{user?.username}</b>{isAdmin ? ' (administrador)' : ''}. Tus apuestas, tu cartera y tus avisos son sólo tuyos.
      </p>
      {!hasPassword && <p className="mb-3 text-sm text-zinc-400">Entras con Google. Si quieres entrar también con tu usuario, ponte una contraseña:</p>}
      <form onSubmit={change} className={cn('grid grid-cols-1 items-end gap-3', hasPassword ? 'sm:grid-cols-[1fr_1fr_1fr_auto]' : 'sm:grid-cols-[1fr_1fr_auto]')}>
        {hasPassword && <Field label="Contraseña actual"><Input required type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} /></Field>}
        <Field label="Contraseña nueva"><Input required minLength={8} type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} /></Field>
        <Field label="Repítela"><Input required minLength={8} type="password" autoComplete="new-password" value={pw.repeat} onChange={e => setPw(p => ({ ...p, repeat: e.target.value }))} /></Field>
        <Button type="submit" variant="secondary" disabled={busy}>{hasPassword ? 'Cambiar' : 'Poner contraseña'}</Button>
      </form>
      {(user?.google || cfg?.google) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
          <div className="flex min-w-0 items-center gap-2.5 text-sm">
            <GoogleMark />
            {user?.google
              ? <span className="min-w-0 truncate text-zinc-300">Google vinculado{user.googleEmail ? <>: <b className="text-zinc-100">{user.googleEmail}</b></> : ''}</span>
              : <span className="text-zinc-400">Vincula tu cuenta de Google para entrar con ella.</span>}
          </div>
          {!user?.google && <a href="/api/auth/google?link=1" className="inline-flex h-8 items-center rounded-md bg-zinc-800 px-3 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700">Vincular con Google</a>}
        </div>
      )}
    </Card>
  );
}

// Avisos: cada uno se enciende por separado y se guarda en este navegador. Al encender el primero se pide permiso
function AlertsCard() {
  const [p, setP] = useState(alertPrefs);
  const [perm, setPerm] = useState(notifyPermission);
  const ITEMS: [AlertKind, string, string][] = [
    ['settled', 'Apuestas resueltas', 'Cuando el servidor resuelve sola una de tus apuestas: ganada, perdida o nula, y cuánto.'],
    ['picks', 'Recomendaciones fuertes', 'Cuando aparece una con mucho valor (EV de 8 % o más) y fiabilidad de 65 o más, de baloncesto o tenis.'],
    ['injuries', 'Bajas en tus apuestas', 'Si un jugador de una apuesta pendiente de baloncesto sale de baja o en duda antes del partido.']
  ];
  async function flip(k: AlertKind, on: boolean) {
    const n = { ...p, [k]: on };
    setP(n); setAlertPrefs(n);
    if (on) setPerm(await askPermission());
  }
  const note = perm === 'unsupported'
    ? 'Este navegador no deja avisar desde aquí (pasa en el móvil entrando por la IP de casa, sin https): los avisos saldrán dentro de la app mientras la tengas abierta.'
    : perm === 'denied' ? 'Has bloqueado los avisos para esta web: actívalos en el candado de la barra de direcciones. Mientras, salen dentro de la app.'
      : perm === 'granted' ? 'Llegan como avisos del sistema mientras la app esté abierta en alguna pestaña.'
        : 'Al encender uno, el navegador te pedirá permiso.';
  return (
    <Card title="Avisos">
      <div className="flex flex-col divide-y divide-zinc-800/60">
        {ITEMS.map(([k, label, hint]) => (
          <div key={k} className="flex items-start justify-between gap-4 py-2.5 first:pt-0">
            <div className="min-w-0"><div className="text-sm font-medium">{label}</div><div className="text-xs text-zinc-500">{hint}</div></div>
            <Toggle on={p[k]} onChange={v => flip(k, v)} label="" />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-500">{note}</p>
    </Card>
  );
}

// Favoritos de los cinco deportes: se añaden con la estrella de la ficha del partido; aquí se ven todos y se quitan
const SPORT_NAME = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA' } as const;
function FavoritesCard() {
  const { list, remove } = useFavorites();
  return (
    <Card title="Tus favoritos" action={<span className="text-[11px] text-zinc-500">{list.length || 'ninguno'}</span>}>
      {!list.length ? (
        <p className="text-sm text-zinc-400">Pulsa la estrella junto al nombre de un equipo, jugador o luchador en la ficha de su partido. Saldrán arriba de Partidos con su próximo partido, en el móvil y en el ordenador.</p>
      ) : (
        <ul className="-mx-5 -my-3 divide-y divide-zinc-800/60">
          {list.map(f => (
            <li key={`${f.sport}|${f.name}`} className="flex items-center gap-3 px-5 py-2">
              <TeamLogo src={f.logo} name={f.name} size={22} />
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">{f.name}</span>
              <span className="text-xs text-zinc-500">{SPORT_NAME[f.sport]}</span>
              <button type="button" onClick={() => remove(f)} title={`Dejar de seguir a ${f.name}`} aria-label={`Dejar de seguir a ${f.name}`}
                className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
