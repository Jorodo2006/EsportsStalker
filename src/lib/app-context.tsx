// Estado global: ajustes, navegación, formulario de apuesta y avisos
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BetDraft, MatchEvent, Settings, SlipLeg, Sport } from './types';
import { wallet } from './format';
import { listenOdds } from './odds-live';

// today: la portada común a los cuatro deportes (src/views/TodayView.tsx)
// settings: los ajustes de la app, sólo del administrador; account: la cuenta de cada uno (contraseña, cartera, avisos)
export type View = 'today' | 'matches' | 'players' | 'bets' | 'settings' | 'account';
// Cuatro apps en una: LoL, baloncesto, tenis y fútbol, cada una con sus partidos, sus jugadores y sus apuestas
export type AppId = Sport;

interface Ctx {
  settings: Settings | undefined;
  saveSettings(p: Partial<Settings>): Promise<void>;
  app: AppId;
  switchApp(a: AppId): void;
  view: View;
  go(v: View, param?: string): void;
  viewParam: string | undefined; // p. ej. el equipo a abrir en "Jugadores"
  openMatch: MatchEvent | null; // partido abierto: se mantiene al cambiar de sección
  setOpenMatch(m: MatchEvent | null): void;
  betDraft: BetDraft | null;
  openBet(d?: BetDraft): void;
  closeBet(): void;
  // Boleto de combinada: selecciones que se van juntando antes de crear la apuesta
  slip: SlipLeg[];
  addToSlip(l: SlipLeg): void;
  removeFromSlip(i: number): void;
  keepInSlip(keep: (l: SlipLeg) => boolean): void; // deja en el cupón sólo las que cumplan
  clearSlip(): void;
  toast(msg: string): void;
  toastMsg: string | null;
  // Competiciones de la lista de partidos que se está viendo, para el menú lateral
  sections: Section[];
  setSections(s: Section[]): void;
  // Partido de baloncesto, tenis o fútbol que hay que abrir (p. ej. desde la lista de directo); la vista lo recoge y lo borra
  focusId: string | null;
  setFocusId(id: string | null): void;
  // Día (AAAA-MM-DD, en España) al que tiene que ir la lista antes de abrir el partido: desde el buscador llegan de otros días
  focusDay: string | null;
  setFocusDay(d: string | null): void;
}

// Una competición del día: id del bloque en la página (para desplazarse hasta él), nombre, partidos y en juego
export interface Section { id: string; label: string; count: number; live: number }

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.api.settings.get() });
  const [app, setApp] = useState<AppId>(() => { try { const a = localStorage.getItem('app'); return a === 'basket' || a === 'tennis' || a === 'football' ? a : 'lol'; } catch { return 'lol'; } });
  const [view, setView] = useState<View>('today'); // se abre en Hoy
  const [viewParam, setViewParam] = useState<string>();
  const [openMatch, setOpenMatch] = useState<MatchEvent | null>(null);
  const [betDraft, setBetDraft] = useState<BetDraft | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState<string | null>(null);
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

  // El servidor ha resuelto apuestas solas: se recargan. El aviso llega a todos los conectados (no dice de quién son, para
  // no repartir datos de nadie), así que no se saca mensaje: cada uno ve en su lista lo suyo
  useEffect(() => window.api.onBetsSettled(() => { qc.invalidateQueries({ queryKey: ['bets'] }); }), [qc]);
  // Vuelta de vincular Google (/?google=vinculada o /?login_error=…, google.js): se avisa y se limpia la barra de direcciones
  useEffect(() => {
    try {
      const u = new URL(location.href), done = u.searchParams.get('google'), err = u.searchParams.get('login_error'), gone = u.searchParams.get('borrada');
      if (!done && !err) return;
      for (const k of ['google', 'login_error', 'borrada']) u.searchParams.delete(k);
      history.replaceState(null, '', u.pathname + (u.search === '?' ? '' : u.search) + u.hash);
      // El resultado se queda en «Tu cuenta» hasta cerrarlo (AccountView): un aviso de tres segundos, tras volver de Google, no se ve
      const notice = done
        ? { ok: true, text: `Cuenta de Google vinculada: ya puedes entrar con ella.${gone ? ` La cuenta vacía «${gone}», que se había creado al entrar con Google, se ha borrado.` : ''}` }
        : { ok: false, text: String(err) };
      try { sessionStorage.setItem('account-notice', JSON.stringify(notice)); } catch { toast(notice.text); }
      if (done) qc.invalidateQueries({ queryKey: ['me'] });
      setView('account');
    } catch { /* sin URL */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // El administrador ha cambiado los ajustes de la app: valen para todos, así que se recargan aquí también (moneda, casas…)
  useEffect(() => window.api.onSettingsChanged(() => {
    qc.invalidateQueries({ queryKey: ['settings'] });
    qc.invalidateQueries({ queryKey: ['odds'] });
  }), [qc]);
  // Cuotas nuevas: se recargan las consultas de ese partido que haya en pantalla (src/lib/odds-live.ts)
  useEffect(() => listenOdds(qc), [qc]);

  const value: Ctx = {
    settings,
    async saveSettings(p) {
      const s = await window.api.settings.set(p);
      qc.setQueryData(['settings'], s);
      qc.invalidateQueries({ queryKey: ['odds'] });
      qc.invalidateQueries({ queryKey: ['board'] });
    },
    app,
    switchApp(a) {
      setApp(a); setView(v => (v === 'settings' || v === 'account' ? 'matches' : v)); setViewParam(undefined); setOpenMatch(null);
      try { localStorage.setItem('app', a); } catch { /* sin almacenamiento */ }
    },
    view,
    go(v, param) {
      // Los ajustes de la app son sólo del administrador (el servidor tampoco deja guardarlos a los demás)
      if (v === 'settings' && !qc.getQueryData<{ isAdmin?: boolean } | null>(['me'])?.isAdmin) return;
      // Pulsar "Partidos" estando ya en un partido vuelve a la lista; el resto de secciones lo conservan
      if (v === 'matches' && view === 'matches') setOpenMatch(null);
      setView(v); setViewParam(param);
    },
    viewParam,
    openMatch,
    setOpenMatch,
    betDraft,
    openBet: d => setBetDraft({ sport: app, ...(app === 'basket' ? { league: 'NBA' } : {}), ...d }),
    closeBet: () => setBetDraft(null),
    slip,
    // Cupón: pulsar una cuota la añade; pulsarla otra vez la quita (como en las casas)
    addToSlip(l) {
      const same = (x: SlipLeg) => x.event === l.event && x.market === l.market && x.selection === l.selection;
      if (slip.some(same)) { setSlip(s => s.filter(x => !same(x))); toast('Quitada del cupón'); return; }
      setSlip(s => [...s, { sport: app, ...l }]);
      toast(`Añadida al cupón (${slip.length + 1})`);
    },
    removeFromSlip: i => setSlip(s => s.filter((_, j) => j !== i)),
    keepInSlip: keep => setSlip(s => s.filter(keep)),
    clearSlip: () => setSlip(() => []),
    toast,
    toastMsg,
    sections,
    setSections,
    focusId,
    setFocusId,
    focusDay,
    setFocusDay
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

// Abre en la vista el partido pedido desde fuera (lista de directo, buscador) en cuanto la vista lo tiene cargado. Si viene
// con día, primero lleva la lista a ese día (setDate)
export function useFocus(open: (id: string) => void, has: (id: string) => boolean, setDate?: (d: string) => void) {
  const { focusId, setFocusId, focusDay, setFocusDay } = useApp();
  useEffect(() => {
    if (focusDay && setDate) { setDate(focusDay); setFocusDay(null); }
  }, [focusDay, setDate, setFocusDay]);
  useEffect(() => {
    if (focusId && has(focusId)) { open(focusId); setFocusId(null); }
  }, [focusId, has, open, setFocusId]);
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fuera de AppProvider');
  return c;
}

export const useCurrency = () => useApp().settings?.currency || '€';

// Saldo de la cartera común a las tres apps
export function useWallet() {
  const { settings } = useApp();
  const { data: bets = [] } = useQuery({ queryKey: ['bets'], queryFn: () => window.api.bets.list() });
  return wallet(bets, settings?.initialBankroll || 0);
}
export const useRefreshMs = () => Math.max(10, useApp().settings?.refreshSeconds || 30) * 1000;
