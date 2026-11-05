import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { CalendarDays, Dribbble, ServerCrash, Settings as Cog, Swords, Users, Wallet } from 'lucide-react';
import { useApp, useCurrency, useWallet, type AppId, type View } from '@/lib/app-context';
import { cn, money, tone } from '@/lib/format';
import { BetFormDialog } from '@/components/BetForm';
import { Coupon } from '@/components/Coupon';
import type { BackendStatus } from '@/lib/types';
import MatchesView from '@/views/MatchesView';
import PlayersView from '@/views/PlayersView';
import BasketMatches from '@/views/BasketMatches';
import BasketPlayers from '@/views/BasketPlayers';
import TennisMatches from '@/views/TennisMatches';
import TennisPlayers from '@/views/TennisPlayers';
import BetsView from '@/views/BetsView';
import SettingsView from '@/views/SettingsView';

const NAV: { view: View; label: string; icon: typeof Users }[] = [
  { view: 'matches', label: 'Partidos', icon: CalendarDays },
  { view: 'players', label: 'Jugadores', icon: Users },
  { view: 'bets', label: 'Apuestas', icon: Wallet }
];

// Pelota de tenis (lucide no tiene): círculo con las dos curvas de la costura
function TennisBall({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="M5.2 4.7a10 10 0 0 1 0 14.6" /><path d="M18.8 4.7a10 10 0 0 0 0 14.6" />
    </svg>
  );
}

const APPS: { id: AppId; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: 'lol', label: 'LoL', icon: Swords },
  { id: 'basket', label: 'Baloncesto', icon: Dribbble },
  { id: 'tennis', label: 'Tenis', icon: TennisBall }
];

export default function App() {
  const { app, switchApp, view, go, toastMsg } = useApp();
  // Partidos en juego de cada app, para el aviso rojo del selector
  const { data: lolLive } = useQuery({ queryKey: ['live'], queryFn: () => window.api.esports.live(), refetchInterval: 60_000 });
  const { data: basketLive } = useQuery({ queryKey: ['basket', 'live'], queryFn: () => window.api.basket.live(), refetchInterval: 60_000, enabled: !!window.api.basket });
  const { data: tennisLive } = useQuery({ queryKey: ['tennis', 'live'], queryFn: () => window.api.tennis.live(), refetchInterval: 60_000, enabled: !!window.api.tennis });
  const live: Record<AppId, number> = { lol: lolLive?.length ?? 0, basket: basketLive?.length ?? 0, tennis: tennisLive?.length ?? 0 };
  // Cada sección empieza arriba (si no, se hereda el desplazamiento de la anterior)
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [app, view]);

  const appTabs = (
    <div className="flex rounded-2xl border border-zinc-800 bg-zinc-900/70 p-1" role="tablist" aria-label="App">
      {APPS.map(({ id, label, icon: Icon }) => (
        <button key={id} role="tab" aria-selected={app === id} onClick={() => switchApp(id)} data-app={id}
          className={cn('flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl px-2 py-1.5 text-sm font-semibold transition lg:flex-none lg:px-3.5',
            app === id ? 'bg-amber-500 text-zinc-950 shadow-lg shadow-black/30' : 'text-zinc-400 hover:text-zinc-100')}>
          <Icon size={16} />{label}
          {!!live[id] && <span className={cn('flex items-center gap-1 rounded-full px-1.5 text-[11px] font-bold', app === id ? 'bg-zinc-950/20 text-zinc-950' : 'bg-rose-500/15 text-rose-300')}>
            <span className={cn('h-1.5 w-1.5 animate-pulse rounded-full', app === id ? 'bg-zinc-950' : 'bg-rose-400')} />{live[id]}
          </span>}
        </button>
      ))}
    </div>
  );

  return (
    <div data-app={app} className="flex h-full flex-col">
      <header className="shrink-0 border-b border-zinc-800/70 bg-zinc-950/80 px-3 backdrop-blur lg:px-6">
        <div className="flex h-14 items-center gap-3 lg:h-16 lg:gap-4">
          <div className="font-score text-xl font-bold tracking-tight">Esports<span className="text-amber-400">Stalker</span></div>
          <div className="hidden lg:block">{appTabs}</div>
          <nav className="hidden gap-1 lg:flex">
            {NAV.map(({ view: v, label, icon: Icon }) => (
              <button key={v} onClick={() => go(v)} aria-current={view === v}
                className={cn('flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition',
                  view === v ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-200')}>
                <Icon size={16} className={view === v ? 'text-amber-400' : ''} />{label}
              </button>
            ))}
          </nav>
          <WalletChip onClick={() => go('bets')} />
          <button onClick={() => go('settings')} title="Ajustes" aria-label="Ajustes" aria-current={view === 'settings'}
            className={cn('grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg transition', view === 'settings' ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100')}>
            <Cog size={17} />
          </button>
        </div>
        <div className="pb-2 lg:hidden">{appTabs}</div>
      </header>

      <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1500px] px-3 py-4 lg:px-6 lg:py-6">
          <BackendBanner />
          {view === 'matches' && (app === 'lol' ? <MatchesView /> : app === 'basket' ? <BasketMatches /> : <TennisMatches />)}
          {view === 'players' && (app === 'lol' ? <PlayersView /> : app === 'basket' ? <BasketPlayers /> : <TennisPlayers />)}
          {view === 'bets' && <BetsView key={app} />}
          {view === 'settings' && <SettingsView />}
        </div>
      </main>

      <nav className="grid shrink-0 grid-cols-3 border-t border-zinc-800/70 bg-zinc-950 pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.map(({ view: v, label, icon: Icon }) => (
          <button key={v} onClick={() => go(v)} aria-current={view === v}
            className={cn('flex cursor-pointer flex-col items-center gap-0.5 py-2 text-[11px] font-medium', view === v ? 'text-zinc-50' : 'text-zinc-500')}>
            <Icon size={20} className={view === v ? 'text-amber-400' : ''} />{label}
          </button>
        ))}
      </nav>

      <BetFormDialog />
      <Coupon />
      {toastMsg && (
        <div className="fixed bottom-20 left-1/2 z-[60] w-max max-w-[90vw] -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm shadow-xl lg:bottom-5">{toastMsg}</div>
      )}
    </div>
  );
}

// Cartera común a las tres apps: saldo disponible (banca + beneficio − en juego)
function WalletChip({ onClick }: { onClick: () => void }) {
  const w = useWallet();
  const cur = useCurrency();
  return (
    <button onClick={onClick} title={`Beneficio total ${money(w.profit, cur, true)} · en juego ${money(w.inPlay, cur)}`}
      className="ml-auto flex cursor-pointer items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 transition hover:border-zinc-700">
      <Wallet size={16} className="text-zinc-400" />
      <div className="text-right leading-tight">
        <div className="whitespace-nowrap font-score text-lg font-semibold tnum">{money(w.balance, cur)}</div>
        <div className="whitespace-nowrap text-[11px] text-zinc-500">{w.inPlay ? `${money(w.inPlay, cur)} en juego` : <span className={tone(w.profit)}>{money(w.profit, cur, true)}</span>}</div>
      </div>
    </button>
  );
}

// Aviso si el backend (Docker) no responde. Cuando vuelve, se recargan todos los datos.
function BackendBanner() {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ['backend'],
    // null: no responde; false: el preload es anterior (recarga en caliente) y no se puede saber
    queryFn: async (): Promise<BackendStatus | null | false> => {
      if (!window.api.backend) return false;
      try { return await window.api.backend.status(); } catch { return null; }
    },
    refetchInterval: 15_000,
    retry: false
  });
  useEffect(() => window.api.onBackendStatus?.(up => { refetch(); if (up) qc.invalidateQueries(); }), [qc, refetch]);
  const down = data === null || (!!data && Object.values(data).some(v => !v));
  const failing = data ? Object.entries(data).filter(([, v]) => !v).map(([k]) => k) : [];
  if (!down) return null;
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm">
      <ServerCrash size={18} className="mt-0.5 shrink-0 text-rose-400" />
      <div>
        <div className="font-semibold text-rose-200">{failing.length ? `No responde: ${failing.join(', ')}` : 'El servidor de la app no responde'}</div>
        <div className="text-zinc-400">Abre Docker Desktop y, en la carpeta del proyecto, ejecuta <code className="text-zinc-200">npm run backend</code>. Los datos vuelven solos en cuanto arranque.</div>
      </div>
    </div>
  );
}
