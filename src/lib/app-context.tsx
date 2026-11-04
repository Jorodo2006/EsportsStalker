// Estado global: ajustes, navegación, formulario de apuesta y avisos
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BetDraft, MatchEvent, Settings, SlipLeg, Sport } from './types';
import { wallet } from './format';

export type View = 'matches' | 'players' | 'bets' | 'settings';
// Dos apps en una: LoL y baloncesto, cada una con sus partidos, sus jugadores y sus apuestas
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
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.api.settings.get() });
  const [app, setApp] = useState<AppId>(() => { try { const a = localStorage.getItem('app'); return a === 'basket' || a === 'tennis' ? a : 'lol'; } catch { return 'lol'; } });
  const [view, setView] = useState<View>('matches');
  const [viewParam, setViewParam] = useState<string>();
  const [openMatch, setOpenMatch] = useState<MatchEvent | null>(null);
  const [betDraft, setBetDraft] = useState<BetDraft | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
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
      setApp(a); setView(v => (v === 'settings' ? 'matches' : v)); setViewParam(undefined); setOpenMatch(null);
      try { localStorage.setItem('app', a); } catch { /* sin almacenamiento */ }
    },
    view,
    go(v, param) {
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
    toastMsg
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
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
