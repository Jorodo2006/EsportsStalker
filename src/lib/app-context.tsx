// Estado global: ajustes, navegación, formulario de apuesta y avisos
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BetDraft, MatchEvent, Settings, SlipLeg, Sport } from './types';

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
  clearSlip(): void;
  toast(msg: string): void;
  toastMsg: string | null;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.api.settings.get() });
  const [app, setApp] = useState<AppId>(() => { try { return localStorage.getItem('app') === 'basket' ? 'basket' : 'lol'; } catch { return 'lol'; } });
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
    addToSlip(l) {
      const same = (x: SlipLeg) => x.event === l.event && x.market === l.market && x.selection === l.selection;
      if (slip.some(same)) { toast('Esa selección ya está en la combinada'); return; }
      // Otra selección del mismo mercado y partido la sustituye (no se pueden combinar)
      const rep = slip.some(x => x.event === l.event && x.market === l.market);
      setSlip(s => [...s.filter(x => !(x.event === l.event && x.market === l.market)), l]);
      toast(rep ? 'Selección cambiada en la combinada' : `Añadida a la combinada (${slip.length + 1})`);
    },
    removeFromSlip: i => setSlip(s => s.filter((_, j) => j !== i)),
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
export const useRefreshMs = () => Math.max(10, useApp().settings?.refreshSeconds || 30) * 1000;
