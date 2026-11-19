// Estado global: ajustes, navegación, formulario de apuesta y avisos
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BetDraft, MatchEvent, Settings, SlipLeg, Sport } from './types';
import { wallet } from './format';
import { listenOdds } from './odds-live';
import { askLogin, useMember, useUser } from '@/components/AuthGate';
import { backTo, currentRoute, navigate, startHistory } from './history';
import { listDay, localDay, parseRoute, titleOf, type Route, type View } from './route';
import { busiestSport } from './live';

// La pantalla sale de la dirección (src/lib/route.ts): atrás y adelante del navegador, recargar y los enlaces funcionan
export { LEGAL_PATHS, type LegalPage, type View } from './route';
// Cinco apps en una: LoL, baloncesto, tenis, fútbol y MMA, cada una con sus partidos, sus jugadores y sus apuestas
export type AppId = Sport;

// El deporte de la última visita; null si es la primera (o el navegador no guarda nada)
const savedApp = (): AppId | null => { try { const a = localStorage.getItem('app'); return a === 'lol' || a === 'basket' || a === 'tennis' || a === 'football' || a === 'mma' ? a : null; } catch { return null; } };
const dayOfEvent = (m: MatchEvent) => localDay(new Date(m.startTime));

interface Ctx {
  settings: Settings | undefined;
  saveSettings(p: Partial<Settings>): Promise<void>;
  // La pantalla entera (deporte, sección, partido abierto y día), tal como está en la dirección
  route: Route;
  // Primera visita a la portada: se está mirando qué deporte tiene más partidos para abrir en él (App enseña «Cargando»)
  starting: boolean;
  app: AppId;
  switchApp(a: AppId): void;
  view: View;
  go(v: View, param?: string): void;
  viewParam: string | undefined; // p. ej. el equipo a abrir en "Jugadores"
  openMatch: MatchEvent | null; // partido de LoL abierto (los demás deportes lo leen con useRouteMatch)
  setOpenMatch(m: MatchEvent | null): void;
  // Abre un partido (de baloncesto, tenis, fútbol o MMA; los de LoL, con setOpenMatch). day: el de su lista; app: otro deporte
  openGame(id: string, day?: string, app?: AppId): void;
  // La lista de partidos de un deporte (el que se ve, si no se dice), en un día
  openList(app?: AppId, day?: string): void;
  // «Volver a partidos»: un atrás si se vino de la lista; si no, la lista sustituye al partido
  closeMatch(): void;
  betDraft: BetDraft | null;
  openBet(d?: BetDraft): void;
  closeBet(): void;
  // Boleto de combinada: selecciones que se van juntando antes de crear la apuesta
  slip: SlipLeg[];
  addToSlip(l: SlipLeg): void;
  removeFromSlip(i: number): void;
  keepInSlip(keep: (l: SlipLeg) => boolean): void; // deja en el cupón sólo las que cumplan
  updateSlip(f: (l: SlipLeg) => SlipLeg): void; // cambia las selecciones (cuotas actualizadas)
  clearSlip(): void;
  toast(msg: string): void;
  toastMsg: string | null;
  // Competiciones de la lista de partidos que se está viendo, para el menú lateral
  sections: Section[];
  setSections(s: Section[]): void;
}

// Una competición del día: id del bloque en la página (para desplazarse hasta él), nombre, partidos y en juego
export interface Section { id: string; label: string; count: number; live: number }

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // Sin cuenta, los comunes sin credenciales (al entrar o salir se vacía la caché y se vuelven a pedir: AuthGate)
  const member = useMember();
  const me = useUser().data;
  const { data: settings } = useQuery({ queryKey: ['settings', member], queryFn: () => (member ? window.api.settings.get() : window.api.settings.public()) });
  // La dirección con la que se entró: la vuelta de Google trae sus avisos en ella, y startHistory la deja limpia enseguida
  const [boot] = useState(() => { try { return new URL(location.href).searchParams; } catch { return new URLSearchParams(); } });
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname, location.search, savedApp() ?? 'football'));
  const [starting, setStarting] = useState(() => !savedApp() && location.pathname === '/' && !boot.get('google') && !boot.get('login_error'));
  // Partidos de LoL abiertos en esta visita: la dirección sólo lleva el id, y la ficha necesita el partido entero
  const lolEvents = useRef(new Map<string, MatchEvent>());
  const [betDraft, setBetDraft] = useState<BetDraft | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [slip, setSlipState] = useState<SlipLeg[]>(() => {
    try { return JSON.parse(localStorage.getItem('slip') || '[]'); } catch { return []; }
  });
  const setSlip = (f: (s: SlipLeg[]) => SlipLeg[]) => setSlipState(p => {
    const n = f(p);
    try { localStorage.setItem('slip', JSON.stringify(n)); } catch { /* sin almacenamiento */ }
    return n;
  });

  const toastTimer = useRef<number>(undefined);
  const toast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  // Atrás, adelante y los cambios de pantalla pasan por src/lib/history.ts, que avisa aquí de la pantalla nueva
  useEffect(() => startHistory(route, setRoute), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Primera visita: se abre en el deporte con más partidos (src/lib/live.ts). Como mucho 2,5 s: si las fuentes tardan, se
  // queda en el fútbol. Si mientras tanto se ha elegido otra cosa, no se toca
  useEffect(() => {
    if (!starting) return;
    let done = false;
    const first = route;
    const finish = (best: AppId | null) => {
      if (done) return;
      done = true;
      const now = currentRoute();
      if (best && now && now.app === first.app && now.view === 'matches' && !now.match && !now.day) navigate(() => ({ app: best, view: 'matches' }), { replace: true });
      setStarting(false);
    };
    const t = window.setTimeout(() => finish(null), 2500);
    busiestSport(localDay()).then(finish, () => finish(null));
    return () => window.clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // El deporte que se ve se recuerda para la próxima visita y para las pantallas que no lo llevan en la dirección
  useEffect(() => { try { localStorage.setItem('app', route.app); } catch { /* sin almacenamiento */ } }, [route.app]);
  useEffect(() => { document.title = titleOf(route); }, [route]);
  // Los ajustes de la app son sólo del administrador: quien escriba /ajustes sin serlo vuelve a los partidos
  useEffect(() => { if ((route.view === 'settings' || route.view === 'admin') && !me?.isAdmin) navigate(r => ({ app: r.app, view: 'matches' }), { replace: true }); }, [route.view, me]);

  // El servidor ha resuelto apuestas solas: se recargan. El aviso llega a todos los conectados (no dice de quién son, para
  // no repartir datos de nadie), así que no se saca mensaje: cada uno ve en su lista lo suyo
  useEffect(() => window.api.onBetsSettled(() => { qc.invalidateQueries({ queryKey: ['bets'] }); }), [qc]);
  // Vuelta de vincular Google (/?google=vinculada o /?login_error=…, google.js): se avisa y se va a «Tu cuenta», sustituyendo
  // la entrada para que atrás no vuelva a la dirección con el aviso
  useEffect(() => {
    const done = boot.get('google'), err = boot.get('login_error'), gone = boot.get('borrada');
    if (!done && !err) return;
    // El resultado se queda en «Tu cuenta» hasta cerrarlo (AccountView): un aviso de tres segundos, tras volver de Google, no se ve
    const notice = done
      ? { ok: true, text: `Cuenta de Google vinculada: ya puedes entrar con ella.${gone ? ` La cuenta vacía «${gone}», que se había creado al entrar con Google, se ha borrado.` : ''}` }
      : { ok: false, text: String(err) };
    try { sessionStorage.setItem('account-notice', JSON.stringify(notice)); } catch { toast(notice.text); }
    if (done) qc.invalidateQueries({ queryKey: ['me'] });
    navigate(r => ({ app: r.app, view: 'account' }), { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // El administrador ha cambiado los ajustes de la app: valen para todos, así que se recargan aquí también (moneda, casas…)
  useEffect(() => window.api.onSettingsChanged(() => {
    qc.invalidateQueries({ queryKey: ['settings'] });
    qc.invalidateQueries({ queryKey: ['odds'] });
  }), [qc]);
  // Cuotas nuevas: se recargan las consultas de ese partido que haya en pantalla (src/lib/odds-live.ts)
  useEffect(() => listenOdds(qc), [qc]);

  const lolOpen = route.app === 'lol' && route.view === 'matches' && route.match ? lolEvents.current.get(route.match) ?? null : null;
  const closeMatch = () => {
    const r = currentRoute();
    if (r) backTo({ app: r.app, view: 'matches', ...(listDay(r.day) ? { day: r.day } : {}) });
  };

  const value: Ctx = {
    settings,
    async saveSettings(p) {
      const s = await window.api.settings.set(p);
      qc.setQueryData(['settings', true], s);
      qc.invalidateQueries({ queryKey: ['odds'] });
      qc.invalidateQueries({ queryKey: ['board'] });
    },
    route,
    starting,
    app: route.app,
    // Cambiar de deporte conserva la sección (salvo ajustes y cuenta, que no son de un deporte) y cierra el partido
    switchApp(a) {
      navigate(r => ({ app: a, view: r.view === 'settings' || r.view === 'admin' || r.view === 'account' ? 'matches' : r.view, ...(r.view === 'legal' ? { param: r.param } : {}) }));
    },
    view: route.view,
    go(v, param) {
      // Los ajustes de la app son sólo del administrador (el servidor tampoco deja guardarlos a los demás)
      if ((v === 'settings' || v === 'admin') && !qc.getQueryData<{ isAdmin?: boolean } | null>(['me'])?.isAdmin) return;
      // Pulsar "Partidos" estando en un partido es lo mismo que «Volver a partidos»; en la lista no cambia nada, y desde otra
      // sección se va a la de hoy
      const now = currentRoute();
      if (v === 'matches' && now?.view === 'matches' && now.match) { closeMatch(); return; }
      navigate(r => ({ app: r.app, view: v, ...(param ? { param } : {}), ...(v === 'matches' && r.view === 'matches' && listDay(r.day) ? { day: r.day } : {}) }));
    },
    viewParam: route.param,
    openMatch: lolOpen,
    setOpenMatch(m) {
      if (!m) { closeMatch(); return; }
      lolEvents.current.set(m.id, m);
      navigate(() => ({ app: 'lol', view: 'matches', match: m.id, day: dayOfEvent(m) }));
    },
    // El partido lleva siempre su día en la dirección: al entrar por un enlace, la vista abre la lista de ese día y lo busca
    openGame(id, day, app) {
      navigate(r => ({ app: app ?? r.app, view: 'matches', match: id, day: day ?? (app && app !== r.app ? undefined : r.day) ?? localDay() }));
    },
    openList(app, day) {
      navigate(r => ({ app: app ?? r.app, view: 'matches', ...(listDay(day) ? { day } : {}) }));
    },
    closeMatch,
    betDraft,
    // Apuntar una apuesta es de cada usuario: sin cuenta, primero entrar
    openBet: d => {
      if (!qc.getQueryData(['me'])) { askLogin({ mode: 'register', why: 'Para apuntar tus apuestas y llevar tu cartera hace falta una cuenta.' }); return; }
      setBetDraft({ sport: route.app, ...(route.app === 'basket' ? { league: 'NBA' } : {}), ...d });
    },
    closeBet: () => setBetDraft(null),
    slip,
    // Cupón: pulsar una cuota la añade; pulsarla otra vez la quita (como en las casas)
    addToSlip(l) {
      const same = (x: SlipLeg) => x.event === l.event && x.market === l.market && x.selection === l.selection;
      if (slip.some(same)) { setSlip(s => s.filter(x => !same(x))); toast('Quitada del cupón'); return; }
      // La hora a la que se vio la cuota, para decir en el cupón de cuándo es
      setSlip(s => [...s, { sport: route.app, ...l, ...(l.live ? { live: { ...l.live, at: l.live.at ?? Date.now() } } : {}) }]);
      toast(`Añadida al cupón (${slip.length + 1})`);
    },
    removeFromSlip: i => setSlip(s => s.filter((_, j) => j !== i)),
    keepInSlip: keep => setSlip(s => s.filter(keep)),
    updateSlip: f => setSlip(s => s.map(f)),
    clearSlip: () => setSlip(() => []),
    toast,
    toastMsg,
    sections,
    setSections
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// La vista de partidos publica sus competiciones para el menú lateral; al salir (o al abrir un partido) se vacía
export function useSections(list: Section[]) {
  const { setSections } = useApp();
  const key = list.map(s => `${s.id}:${s.count}:${s.live}`).join('|');
  useEffect(() => {
    setSections(list);
    return () => setSections([]);
  }, [key, setSections]); // key resume el contenido de list, que cambia de identidad en cada render
}

// El id del bloque de una competición en la página
export const sectionId = (name: string) => 'comp-' + name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-');

// El día de la lista de partidos, que va en la dirección (?dia=): así al volver de un partido, al recargar o desde un enlace
// se ve el mismo día. Cambiarlo no apila entradas en el historial (la tira de días se toca mucho)
export function useRouteDay(): [string, (d: string) => void] {
  const { route } = useApp();
  const set = useCallback((d: string) => navigate(r => ({ ...r, day: r.match ? d : listDay(d) }), { replace: true }), []);
  return [route.day ?? localDay(), set];
}

// El partido abierto de un deporte (id de la dirección), o null en su lista
export function useRouteMatch(app: AppId): string | null {
  const { route } = useApp();
  return route.app === app && route.view === 'matches' ? route.match ?? null : null;
}

// Un partido de la dirección que no está en la lista de su día ya cargada (enlace viejo, partido aplazado): de vuelta a la lista
export function useLostMatch(lost: boolean) {
  const { closeMatch } = useApp();
  const ref = useRef(closeMatch);
  useEffect(() => { ref.current = closeMatch; });
  useEffect(() => { if (lost) ref.current(); }, [lost]);
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fuera de AppProvider');
  return c;
}

export const useCurrency = () => useApp().settings?.currency || '€';

// Lo que vale una unidad para este usuario: la que puso en Tu cuenta o, si no, el 1 % de la banca inicial (la costumbre de los
// tipsters: una banca de 100 unidades). Sin ninguna de las dos, 0, y no se enseñan unidades
export function useUnit() {
  const { settings } = useApp();
  return settings?.unitSize || (settings?.initialBankroll || 0) / 100;
}

// Saldo de la cartera común a las tres apps
export function useWallet() {
  const { settings } = useApp();
  const { data: bets = [] } = useBets();
  return wallet(bets, settings?.initialBankroll || 0);
}
// Las apuestas del usuario (sin cuenta, ninguna: ni se piden)
export function useBets() {
  return useQuery({ queryKey: ['bets'], queryFn: () => window.api.bets.list(), enabled: useMember() });
}
export const useRefreshMs = () => Math.max(10, useApp().settings?.refreshSeconds || 30) * 1000;
