import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, Dribbble, Layers, ServerCrash, Settings as Cog, Swords, Users, Wallet, X } from 'lucide-react';
import { useApp, type AppId, type View } from '@/lib/app-context';
import { cn, odd } from '@/lib/format';
import { BetFormDialog, comboOdds } from '@/components/BetForm';
import { Button } from '@/components/ui';
import type { BackendStatus } from '@/lib/types';
import MatchesView from '@/views/MatchesView';
import PlayersView from '@/views/PlayersView';
import BasketMatches from '@/views/BasketMatches';
import BasketPlayers from '@/views/BasketPlayers';
import BetsView from '@/views/BetsView';
import SettingsView from '@/views/SettingsView';

const NAV: { view: View; label: string; icon: typeof Users }[] = [
  { view: 'matches', label: 'Partidos', icon: CalendarDays },
  { view: 'players', label: 'Jugadores', icon: Users },
  { view: 'bets', label: 'Apuestas', icon: Wallet }
];

const APPS: { id: AppId; label: string; icon: typeof Users }[] = [
  { id: 'lol', label: 'League of Legends', icon: Swords },
  { id: 'basket', label: 'Baloncesto', icon: Dribbble }
];

export default function App() {
  const { app, switchApp, view, go, toastMsg } = useApp();
  // Partidos en juego de cada app, para el aviso rojo del selector
  const { data: lolLive } = useQuery({ queryKey: ['live'], queryFn: () => window.api.esports.live(), refetchInterval: 60_000 });
  const { data: basketLive } = useQuery({ queryKey: ['basket', 'live'], queryFn: () => window.api.basket.live(), refetchInterval: 60_000, enabled: !!window.api.basket });
  const live: Record<AppId, number> = { lol: lolLive?.length ?? 0, basket: basketLive?.length ?? 0 };
  // Cada sección empieza arriba (si no, se hereda el desplazamiento de la anterior)
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [app, view]);

  return (
    <div data-app={app} className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-6 border-b border-zinc-800/70 bg-zinc-950/80 px-6 backdrop-blur">
        <div className="font-score text-xl font-bold tracking-tight">Esports<span className="text-amber-400">Stalker</span></div>
        <div className="flex rounded-2xl border border-zinc-800 bg-zinc-900/70 p-1" role="tablist" aria-label="App">
          {APPS.map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" aria-selected={app === id} onClick={() => switchApp(id)} data-app={id}
              className={cn('flex cursor-pointer items-center gap-2 rounded-xl px-4 py-1.5 text-sm font-semibold transition',
                app === id ? 'bg-amber-500 text-zinc-950 shadow-lg shadow-black/30' : 'text-zinc-400 hover:text-zinc-100')}>
              <Icon size={16} />{label}
              {!!live[id] && <span className={cn('flex items-center gap-1 rounded-full px-1.5 text-[11px] font-bold', app === id ? 'bg-zinc-950/20 text-zinc-950' : 'bg-rose-500/15 text-rose-300')}>
                <span className={cn('h-1.5 w-1.5 animate-pulse rounded-full', app === id ? 'bg-zinc-950' : 'bg-rose-400')} />{live[id]}
              </span>}
            </button>
          ))}
        </div>
        <nav className="flex gap-1">
          {NAV.map(({ view: v, label, icon: Icon }) => (
            <button key={v} onClick={() => go(v)} aria-current={view === v}
              className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                view === v ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon size={16} className={view === v ? 'text-amber-400' : ''} />{label}
            </button>
          ))}
        </nav>
        <button onClick={() => go('settings')} title="Ajustes" aria-current={view === 'settings'}
          className={cn('ml-auto grid h-9 w-9 cursor-pointer place-items-center rounded-lg transition', view === 'settings' ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100')}>
          <Cog size={17} />
        </button>
      </header>

      <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1500px] px-6 py-6">
          <BackendBanner />
          {view === 'matches' && (app === 'lol' ? <MatchesView /> : <BasketMatches />)}
          {view === 'players' && (app === 'lol' ? <PlayersView /> : <BasketPlayers />)}
          {view === 'bets' && <BetsView key={app} />}
          {view === 'settings' && <SettingsView />}
        </div>
      </main>

      <BetFormDialog />
      <SlipWidget />
      {toastMsg && (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm shadow-xl">{toastMsg}</div>
      )}
    </div>
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

// Boleto flotante: las selecciones añadidas a la combinada, listas para crear la apuesta
function SlipWidget() {
  const { slip, removeFromSlip, clearSlip, openBet, betDraft } = useApp();
  const [open, setOpen] = useState(true);
  if (!slip.length || betDraft) return null;
  const books = [...new Set(slip.map(l => l.bookmaker).filter(Boolean))];
  return (
    <div className="fixed bottom-5 right-5 z-40 w-80 overflow-hidden rounded-xl border border-amber-500/30 bg-zinc-950 shadow-2xl shadow-black/60">
      <button onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-center gap-2 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold">
        <Layers size={15} className="text-amber-400" />Combinada
        <span className="rounded-full bg-amber-500/20 px-1.5 text-xs text-amber-300">{slip.length}</span>
        <span className="ml-auto tabular-nums text-amber-300">{odd(comboOdds(slip))}</span>
        <ChevronDown size={15} className={cn('text-zinc-500 transition', !open && 'rotate-180')} />
      </button>
      {open && <>
        <div className="max-h-72 divide-y divide-zinc-800/70 overflow-y-auto">
          {slip.map((l, i) => (
            <div key={i} className="group flex items-start gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{l.selection}</div>
                <div className="truncate text-xs text-zinc-500">{l.market}</div>
                <div className="truncate text-xs text-zinc-600">{l.event}{l.bookmaker && ` · ${l.bookmaker}`}</div>
              </div>
              <span className="pt-0.5 text-sm font-semibold tabular-nums">{odd(l.odds)}</span>
              <button title="Quitar" onClick={() => removeFromSlip(i)} className="cursor-pointer pt-0.5 text-zinc-600 hover:text-rose-400"><X size={14} /></button>
            </div>
          ))}
        </div>
        {books.length > 1 && <div className="border-t border-zinc-800 px-4 py-2 text-xs text-amber-300/80">Ojo: las cuotas son de casas distintas ({books.join(', ')})</div>}
        <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-3">
          {slip.length < 2
            ? <span className="flex-1 text-xs text-zinc-500">Añade otra selección (clic derecho en una cuota)</span>
            : <Button size="sm" className="flex-1" onClick={() => openBet({ legs: slip.map(({ bookmaker: _, ...l }) => l), bookmaker: books.length === 1 ? books[0] : '', league: slip[0].league, fromSlip: true })}>Crear combinada</Button>}
          <Button size="sm" variant="ghost" onClick={clearSlip}>Vaciar</Button>
        </div>
      </>}
    </div>
  );
}
