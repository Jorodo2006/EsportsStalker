// Tu cuenta: lo de cada usuario, a lo que entra cualquiera. Contraseña y salir, su banca inicial (cada uno tiene su cartera) y
// los avisos de este navegador. Los ajustes de la app (moneda, casas, cuotas automáticas…) son del administrador y valen para
// todos: están en SettingsView
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, LogOut, Settings as Cog, Shield, X } from 'lucide-react';
import { useApp, useCurrency, useWallet } from '@/lib/app-context';
import { cn, money } from '@/lib/format';
import { GoogleMark, useUser } from '@/components/AuthGate';
import { Button, Card, Field, Input, PageHeader, TeamLogo } from '@/components/ui';
import { Toggle } from '@/components/sport';
import { useFavorites } from '@/components/Favorites';
import { alertPrefs, askPermission, notifyPermission, setAlertPrefs, type AlertKind } from '@/lib/notify';
import { disablePush, enablePush, isIosBrowser, pushState, testPush, type PushState } from '@/lib/push';
import { useAlerts } from '@/components/Alerts';
import type { OddsAlertKind, OddsAlertPrefs } from '@/lib/types';

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
        <OddsAlertsCard />
        <AlertsCard />
        <FavoritesCard />
        {isAdmin && (
          <Card title="Ajustes de la app">
            <p className="mb-4 text-sm text-zinc-400">Moneda, casas del comparador, cuotas automáticas, registro de cuentas… Eres administrador: lo que cambies allí vale para todos los usuarios.</p>
            <Button variant="secondary" onClick={() => go('settings')}><Cog size={14} />Abrir los ajustes</Button>
          </Card>
        )}
        {isAdmin && (
          <Card title="Administración">
            <p className="mb-4 text-sm text-zinc-400">Las cuentas de los usuarios (renombrar, rol, suspender, contraseña temporal, borrar) y el registro de actividad.</p>
            <Button variant="secondary" onClick={() => go('admin')}><Shield size={14} />Abrir la administración</Button>
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

// La banca inicial de cada uno: con el beneficio de sus apuestas da su cartera. Y lo que vale su unidad, para ver el beneficio
// también en unidades en Mis apuestas (vacía, el 1 % de la banca: useUnit)
function WalletCard() {
  const { settings, saveSettings, toast } = useApp();
  const cur = useCurrency();
  const w = useWallet();
  const [v, setV] = useState('');
  const [u, setU] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (settings) setV(String(settings.initialBankroll ?? 0)); }, [settings?.initialBankroll]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (settings) setU(settings.unitSize ? String(settings.unitSize) : ''); }, [settings?.unitSize]); // eslint-disable-line react-hooks/exhaustive-deps
  const amount = (s: string) => Math.max(0, parseFloat(s.replace(',', '.')) || 0);
  const autoUnit = amount(v) / 100;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await saveSettings({ initialBankroll: amount(v), unitSize: amount(u) }); toast('Banca y unidad guardadas'); }
    catch (err) { toast((err as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Card title="Tu cartera">
      <p className="mb-4 text-sm text-zinc-400">
        {settings?.initialBankroll
          ? <>Lo que tenías para apostar al empezar. Se le suma el beneficio de tus apuestas: ahora tienes <b className="text-zinc-100 tnum">{money(w.balance, cur)}</b>.</>
          : <>Pon con cuánto empezaste a apostar y verás tu saldo: la banca más el beneficio de tus apuestas. Hasta entonces sólo se cuenta el beneficio (<b className="text-zinc-100 tnum">{money(w.profit, cur, true)}</b>).</>}
      </p>
      <form onSubmit={submit} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field label={`Banca inicial (${cur})`}><Input type="number" inputMode="decimal" step="0.01" min={0} value={v} onChange={e => setV(e.target.value)} /></Field>
        <Field label={`Una unidad (${cur})`}>
          <Input type="number" inputMode="decimal" step="0.01" min={0} value={u} onChange={e => setU(e.target.value)}
            placeholder={autoUnit ? money(autoUnit, cur).replace(` ${cur}`, '') : ''} />
        </Field>
        <Button type="submit" variant="secondary" className="col-span-2 sm:col-span-1" disabled={busy}>Guardar</Button>
      </form>
      <p className="mt-3 text-xs text-zinc-500">
        La unidad es lo que sueles apostar. En <i>Mis apuestas</i> verás el beneficio en {cur} y, entre paréntesis, en unidades, como lo
        cuentan los tipsters. {autoUnit ? <>Si la dejas vacía vale el 1 % de la banca: {money(autoUnit, cur)}.</> : 'Si la dejas vacía vale el 1 % de la banca.'}
      </p>
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

// Lo que dice la prueba de avisos, en palabras del usuario: quién lo ha aceptado o rechazado y qué tocar. Si el servicio de push lo
// acepta y no sale, ya no es Sharpex sino el móvil (permiso, entrega programada o un modo Concentración)
const PUSH_SERVICE: [RegExp, string][] = [[/push\.apple\.com$/, 'Apple'], [/googleapis\.com$/, 'Google'], [/mozilla\.com$/, 'Mozilla'], [/notify\.windows\.com$/, 'Windows']];
const isIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
function pushTestText(r: Awaited<ReturnType<typeof testPush>>): { ok: boolean; text: string } {
  if (!r) return { ok: false, text: 'Este dispositivo no está apuntado: activa «Con la app cerrada».' };
  const who = PUSH_SERVICE.find(([re]) => re.test(r.host))?.[1] ?? 'El servicio de avisos';
  const fixed = r.repaired ? ' La suscripción de este dispositivo no valía y la he rehecho.' : '';
  if (r.ok) {
    return {
      ok: true,
      text: `${who} lo ha aceptado: tiene que salirte «Prueba de Sharpex».${fixed} Si no sale, lo frena el móvil: ${isIphone()
        ? 'en Ajustes → Notificaciones → Sharpex, activa Permitir notificaciones, Bloqueo, Centro y Banners, con Entrega inmediata (no Resumen programado), y mira que ningún modo Concentración la silencie.'
        : 'mira los ajustes de notificaciones del sistema y del navegador.'}`
    };
  }
  // Sin código, no hubo respuesta del servicio: falló antes, en el servidor o en la red
  const why = r.missing ? 'el servidor no tiene apuntado este dispositivo'
    : r.status ? `${who} no lo acepta (${[r.status, r.reason].filter(Boolean).join(' ')})` : `no se ha podido mandar a ${who} (${r.reason || 'sin respuesta'})`;
  return { ok: false, text: `No ha llegado: ${why}.${fixed} Desactiva y vuelve a activar «Con la app cerrada»${isIphone() ? '; si sigue igual, borra Sharpex de la pantalla de inicio y vuelve a añadirla desde Safari' : ''}.` };
}

// Avisos de cuotas: los detecta el servidor (server/services/bets/alerts.js) y salen en la campana. Qué tipos, en el servidor (valen en
// todos tus dispositivos); recibirlos con la app cerrada, en cada navegador o móvil (src/lib/push.ts)
function OddsAlertsCard() {
  const qc = useQueryClient();
  const { toast } = useApp();
  const prefs = useQuery({ queryKey: ['alerts', 'prefs'], queryFn: () => window.api.alerts.prefs() });
  const alerts = useAlerts();
  const [push, setPush] = useState<PushState>('off');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | 'running' | null>(null);
  useEffect(() => { pushState().then(setPush); }, []);
  async function runTest() {
    const key = alerts.data?.push.key;
    if (!key || test === 'running') return;
    setTest('running');
    try { setTest(pushTestText(await testPush(key))); }
    catch (e) { setTest({ ok: false, text: (e as Error).message }); }
    finally { setPush(await pushState()); qc.invalidateQueries({ queryKey: ['alerts'] }); }
  }
  const ITEMS: [OddsAlertKind, string, string][] = [
    ['drop', 'Caídas de cuota', 'Cuando una cuota de tus apuestas pendientes, de tu cupón o del partido de un favorito baja un 10 % o más de una lectura a otra: suele ser dinero entrando o una noticia.'],
    ['rise', 'Subidas de cuota', 'Lo mismo cuando sube: si tienes apostado, el mercado se va en contra.'],
    ['value', 'Nuevas con valor', 'Cuando sale una recomendación con valor en tenis, fútbol o MMA, y las más fuertes de baloncesto. Como mucho cinco de golpe.'],
    ['sure', 'Surebets', 'Al momento, cuando Winamax y Betway juntas pagan más de lo apostado salga lo que salga (baloncesto, tenis, fútbol y el resto). Se buscan tras cada lectura de cuotas y cada 15 minutos; el mismo mercado no se repite en 6 h.'],
    ['news', 'Noticias de bajas', 'En cuanto sale una noticia de que un jugador de tus apuestas pendientes o de tus favoritos no juega, está en duda, lesionado, sancionado o vuelve (fútbol y baloncesto). También si tu equipo favorito pierde a alguien.']
  ];
  async function flip(k: OddsAlertKind, on: boolean) {
    const n: OddsAlertPrefs = { ...(prefs.data ?? { drop: true, rise: true, value: true, news: true, sure: true }), [k]: on };
    qc.setQueryData(['alerts', 'prefs'], n);
    try { qc.setQueryData(['alerts', 'prefs'], await window.api.alerts.setPrefs(n)); } catch (e) { toast((e as Error).message); prefs.refetch(); }
  }
  async function togglePush(on: boolean) {
    setBusy(true);
    try {
      if (on) {
        const key = alerts.data?.push.key;
        if (!key) throw new Error('El servidor no tiene preparadas las notificaciones');
        await enablePush(key);
        toast('Listo: te llegarán aunque tengas Sharpex cerrada');
      } else await disablePush();
    } catch (e) { toast((e as Error).message); }
    finally { setPush(await pushState()); setBusy(false); qc.invalidateQueries({ queryKey: ['alerts'] }); }
  }
  const pushNote = push === 'unsupported'
    ? (typeof window !== 'undefined' && !window.isSecureContext ? 'Aquí no se puede: hace falta entrar por https (pasa en el móvil entrando por la IP de casa).' : 'Este navegador no deja recibir avisos con la app cerrada.')
    : push === 'denied' ? 'Has bloqueado los avisos de esta web: actívalos en el candado de la barra de direcciones.'
      : isIosBrowser() ? 'En el iPhone sólo funciona con Sharpex en la pantalla de inicio: Compartir → Añadir a pantalla de inicio, y actívalo desde ahí.'
        : push === 'on' ? 'Este dispositivo los recibe aunque Sharpex esté cerrada. Actívalo también en el móvil para llevarlos encima.'
          : 'Sin esto, los ves en la campana al abrir la app.';
  return (
    <Card title="Avisos de cuotas" action={<span className="text-[11px] text-zinc-500">en la campana</span>}>
      <div className="flex flex-col divide-y divide-zinc-800/60">
        {ITEMS.map(([k, label, hint]) => (
          <div key={k} className="flex items-start justify-between gap-4 py-2.5 first:pt-0">
            <div className="min-w-0"><div className="text-sm font-medium">{label}</div><div className="text-xs text-zinc-500">{hint}</div></div>
            <Toggle on={prefs.data?.[k] ?? true} onChange={v => flip(k, v)} label="" />
          </div>
        ))}
        <div className="flex items-start justify-between gap-4 pt-2.5">
          <div className="min-w-0">
            <div className="text-sm font-medium">Con la app cerrada</div>
            <div className="text-xs text-zinc-500">{pushNote}</div>
          </div>
          {push === 'on' || push === 'off' ? <Toggle on={push === 'on'} onChange={v => !busy && togglePush(v)} label="" /> : null}
        </div>
        {push === 'on' && (
          <div className="flex flex-col gap-1.5 pt-2.5">
            <div className="flex items-center justify-between gap-4">
              <div className="text-xs text-zinc-500">
                {test === 'running' ? 'En unos segundos llega un aviso de prueba: sal a la pantalla de inicio o bloquea el móvil para verlo como los demás.' : '¿No te llegan? Manda uno de prueba a este dispositivo.'}
              </div>
              <Button size="sm" variant="secondary" disabled={test === 'running'} onClick={runTest}>{test === 'running' ? 'Probando…' : 'Probar'}</Button>
            </div>
            {test && test !== 'running' && <p role="status" className={cn('text-xs leading-relaxed', test.ok ? 'text-emerald-400' : 'text-rose-300')}>{test.text}</p>}
          </div>
        )}
      </div>
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
    ? 'Este navegador no permite avisos del sistema en esta web: te avisaremos dentro de Sharpex mientras la tengas abierta.'
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
