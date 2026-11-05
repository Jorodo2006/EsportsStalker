import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, Dribbble, ServerCrash, Settings as Cog, SquareTerminal, Swords, Users, Wallet } from 'lucide-react';
import { useApp, useCurrency, useWallet, type AppId, type View } from '@/lib/app-context';
import { cn, money, tone } from '@/lib/format';
import type { BackendStatus } from '@/lib/types';
import { BetFormDialog } from '@/components/BetForm';
import { Coupon } from '@/components/Coupon';
import { LEAGUE_NAME } from '@/components/BasketAnalyzer';
import { LiveDot } from '@/components/sport';
import { panelCls } from '@/components/ui';
import { surname } from '@/components/viz';
import MatchesView from '@/views/MatchesView';
import PlayersView from '@/views/PlayersView';
import BasketMatches from '@/views/BasketMatches';
import BasketPlayers from '@/views/BasketPlayers';
import TennisMatches from '@/views/TennisMatches';
import TennisPlayers from '@/views/TennisPlayers';
import BetsView from '@/views/BetsView';
import SettingsView from '@/views/SettingsView';

// Estructura de la app (diseño de Stitch, tres columnas):
//   - desde lg: menú lateral a la izquierda (deportes, navegación, competiciones del día y cartera) y el contenido;
//   - desde 1400 px: además, a la derecha, el cupón fijo y los partidos en directo;
//   - por debajo de lg: cabecera arriba, barra de navegación abajo y el cupón flotante.

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

// color: el acento de cada app (el mismo que --acc-500 en index.css), para el punto del selector aunque no esté elegida
const APPS: { id: AppId; label: string; long: string; color: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: 'lol', label: 'LoL', long: 'League of Legends', color: '#46efcf', icon: Swords },
  { id: 'basket', label: 'Baloncesto', long: 'Baloncesto', color: '#ff8a3d', icon: Dribbble },
  { id: 'tennis', label: 'Tenis', long: 'Tenis', color: '#55f28c', icon: TennisBall }
];

// Si la pantalla cumple una media query (para montar el cupón fijo o el flotante, no los dos)
function useMedia(query: string) {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const h = () => setOn(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [query]);
  return on;
}

// Un partido en juego para la lista de la columna derecha
interface LiveItem { id: string; a: string; b: string; sa: ReactNode; sb: ReactNode; info: string; open: () => void }

export default function App() {
  const { app, switchApp, view, go, toastMsg, setOpenMatch, setFocusId } = useApp();
  const wide = useMedia('(min-width: 1400px)');
  // Partidos en juego de cada app: aviso rojo del selector y lista "En directo" de la derecha
  const { data: lolLive } = useQuery({ queryKey: ['live'], queryFn: () => window.api.esports.live(), refetchInterval: 60_000 });
  const { data: basketLive } = useQuery({ queryKey: ['basket', 'live'], queryFn: () => window.api.basket.live(), refetchInterval: 60_000, enabled: !!window.api.basket });
  const { data: tennisLive } = useQuery({ queryKey: ['tennis', 'live'], queryFn: () => window.api.tennis.live(), refetchInterval: 60_000, enabled: !!window.api.tennis });
  const live: Record<AppId, number> = { lol: lolLive?.length ?? 0, basket: basketLive?.length ?? 0, tennis: tennisLive?.length ?? 0 };
  // Cada sección empieza arriba (si no, se hereda el desplazamiento de la anterior)
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [app, view]);

  // Los de baloncesto y tenis los abre su vista al recibir el id; los de LoL van directos al partido abierto
  const focus = (id: string) => { setFocusId(id); go('matches'); };
  const liveItems: LiveItem[] = app === 'lol'
    ? (lolLive ?? []).filter(m => m.teams.length === 2).map(m => ({
      id: m.id, a: m.teams[0].code || m.teams[0].name, b: m.teams[1].code || m.teams[1].name, sa: m.teams[0].wins ?? 0, sb: m.teams[1].wins ?? 0,
      info: [m.league, m.blockName].filter(Boolean).join(' · '), open: () => { go('matches'); setOpenMatch(m); }
    }))
    : app === 'basket'
      ? (basketLive ?? []).map(g => ({
        id: g.id, a: g.away.abbr, b: g.home.abbr, sa: g.away.score ?? 0, sb: g.home.score ?? 0,
        info: [LEAGUE_NAME[g.league], g.status].filter(Boolean).join(' · '), open: () => focus(g.id)
      }))
      : (tennisLive ?? []).map(t => ({
        id: t.id, a: surname(t.a.name), b: surname(t.b.name), sa: t.a.setWins.filter(Boolean).length, sb: t.b.setWins.filter(Boolean).length,
        info: [t.tournament, t.status].filter(Boolean).join(' · '), open: () => focus(t.id)
      }));

  // Selector de app del móvil: control segmentado; la elegida rellena con su color y el resto con el punto de su color
  const appTabs = (
    <div className="grid grid-cols-3 gap-0.5 rounded-full bg-zinc-900 p-1 ring-1 ring-inset ring-zinc-800" role="tablist" aria-label="App">
      {APPS.map(({ id, label, color, icon: Icon }) => (
        <button key={id} role="tab" aria-selected={app === id} onClick={() => switchApp(id)} data-app={id}
          className={cn('flex h-8 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[13px] font-medium transition',
            app === id ? 'bg-amber-500 font-semibold text-zinc-950 shadow-md shadow-amber-500/15' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100')}>
          {app === id ? <Icon size={14} /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />}
          {label}
          {!!live[id] && <span className={cn('flex items-center gap-1 rounded-full px-1.5 font-mono text-[10px] font-semibold', app === id ? 'bg-zinc-950/20 text-zinc-950' : 'bg-[#93000a] text-rose-200')}>
            <span className={cn('h-1 w-1 animate-pulse rounded-full', app === id ? 'bg-zinc-950' : 'bg-rose-300')} />{live[id]}
          </span>}
        </button>
      ))}
    </div>
  );

  return (
    <div data-app={app} className="flex h-full">
      <Sidebar live={live} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-3 lg:hidden">
          <div className="flex h-14 items-center gap-3">
            <Logo />
            <WalletChip onClick={() => go('bets')} />
            <button onClick={() => go('settings')} title="Ajustes" aria-label="Ajustes" aria-current={view === 'settings'}
              className={cn('grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full transition',
                view === 'settings' ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-900 text-zinc-400 ring-1 ring-inset ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-100')}>
              <Cog size={16} />
            </button>
          </div>
          <div className="pb-2.5">{appTabs}</div>
        </header>

        <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[1680px] items-start gap-5 px-3 py-4 lg:px-5 lg:py-5">
            <div className="min-w-0 flex-1">
              <BackendBanner />
              {view === 'matches' && (app === 'lol' ? <MatchesView /> : app === 'basket' ? <BasketMatches /> : <TennisMatches />)}
              {view === 'players' && (app === 'lol' ? <PlayersView /> : app === 'basket' ? <BasketPlayers /> : <TennisPlayers />)}
              {view === 'bets' && <BetsView key={app} />}
              {view === 'settings' && <SettingsView />}
            </div>
            {wide && (
              <aside className="sticky top-5 flex max-h-[calc(100dvh-2.5rem)] w-[340px] shrink-0 flex-col gap-4 overflow-y-auto no-scrollbar">
                <Coupon docked />
                <LiveNow items={liveItems} onAll={() => go('matches')} />
              </aside>
            )}
          </div>
        </main>

        <nav className="grid shrink-0 grid-cols-3 border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)] lg:hidden">
          {NAV.map(({ view: v, label, icon: Icon }) => (
            <button key={v} onClick={() => go(v)} aria-current={view === v}
              className={cn('flex cursor-pointer flex-col items-center gap-1 py-2 text-[11px] font-medium', view === v ? 'text-zinc-50' : 'text-zinc-500')}>
              <span className={cn('grid h-7 w-14 place-items-center rounded-full transition', view === v ? 'bg-amber-500/15 text-amber-400' : '')}><Icon size={19} /></span>
              {label}
            </button>
          ))}
        </nav>
      </div>

      <BetFormDialog />
      {!wide && <Coupon />}
      {toastMsg && (
        <div className="fixed bottom-20 left-1/2 z-[60] w-max max-w-[90vw] -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900 px-5 py-2.5 text-sm shadow-2xl shadow-black/60 lg:bottom-5">{toastMsg}</div>
      )}
    </div>
  );
}

function Logo({ big }: { big?: boolean }) {
  return (
    <div className={cn('flex shrink-0 items-center gap-2 font-bold tracking-tight', big ? 'text-[17px]' : 'text-base')}>
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-500/15 text-amber-400"><SquareTerminal size={17} /></span>
      <span>Esports<span className="text-amber-400">Stalker</span></span>
    </div>
  );
}

// Menú lateral de escritorio: deportes, navegación, competiciones de la lista de partidos y la cartera abajo
function Sidebar({ live }: { live: Record<AppId, number> }) {
  const { app, switchApp, view, go, sections } = useApp();
  const label = (t: string) => <div className="label-data mb-1.5 px-3 text-zinc-500">{t}</div>;
  const navRow = (on: boolean) => cn('flex h-10 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm transition',
    on ? 'bg-zinc-800 font-semibold text-zinc-50 ring-1 ring-inset ring-white/5' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100');
  const jump = (id: string) => { go('matches'); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); };
  return (
    <aside className="m-3 mr-0 hidden w-[248px] shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-surface lg:flex">
      <div className="px-4 pb-4 pt-5"><Logo big /></div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2.5 pb-3 no-scrollbar">
        <div>
          {label('Deportes')}
          <div className="flex flex-col gap-1">
            {APPS.map(({ id, long, color, icon: Icon }) => (
              <button key={id} onClick={() => switchApp(id)} aria-pressed={app === id} data-app={id}
                className={cn('flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-sm transition',
                  app === id ? 'bg-amber-500/15 font-semibold text-amber-300 ring-1 ring-inset ring-amber-500/30' : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-50')}>
                {app === id ? <Icon size={16} /> : <span className="grid w-4 place-items-center"><span className="h-2 w-2 rounded-full" style={{ background: color }} /></span>}
                <span className="min-w-0 flex-1 truncate">{long}</span>
                {!!live[id] && <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#93000a] px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-200">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-rose-300" />{live[id]} en vivo
                </span>}
              </button>
            ))}
          </div>
        </div>

        <div>
          {label('Navegación')}
          <nav className="flex flex-col gap-1">
            {NAV.map(({ view: v, label: l, icon: Icon }) => (
              <button key={v} onClick={() => go(v)} aria-current={view === v} className={navRow(view === v)}>
                <Icon size={16} className={view === v ? 'text-amber-400' : ''} />{v === 'bets' ? 'Mis apuestas' : l}
              </button>
            ))}
            <button onClick={() => go('settings')} aria-current={view === 'settings'} className={navRow(view === 'settings')}>
              <Cog size={16} className={view === 'settings' ? 'text-amber-400' : ''} />Ajustes
            </button>
          </nav>
        </div>

        {view === 'matches' && !!sections.length && (
          <div>
            {label('Competiciones')}
            <div className="flex flex-col gap-0.5">
              {sections.map(s => (
                <button key={s.id} onClick={() => jump(s.id)}
                  className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-left text-[13px] text-zinc-300 transition hover:bg-zinc-800/60 hover:text-zinc-50">
                  {s.live ? <LiveDot className="h-2 w-2" /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" />}
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-zinc-800 px-1.5 font-mono text-[10px] text-zinc-400 tnum">{s.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <SidebarWallet onClick={() => go('bets')} />
    </aside>
  );
}

// Cartera común a las tres apps en el menú lateral: saldo grande, beneficio y lo que hay en juego
function SidebarWallet({ onClick }: { onClick: () => void }) {
  const w = useWallet();
  const cur = useCurrency();
  return (
    <button onClick={onClick} className="m-2.5 mt-0 cursor-pointer rounded-xl bg-zinc-900 p-4 text-left ring-1 ring-inset ring-zinc-800 transition hover:bg-zinc-800/70">
      <div className="label-data flex items-center justify-between text-zinc-500">
        <span className="flex items-center gap-1.5"><Wallet size={12} />Cartera</span>
        <span className={cn('font-semibold normal-case tracking-normal', tone(w.profit))}>{money(w.profit, cur, true)}</span>
      </div>
      <div className="mt-1.5 font-mono text-xl font-semibold text-zinc-50 tnum">{money(w.balance, cur)}</div>
      <div className="mt-1.5 flex justify-between border-t border-zinc-800 pt-1.5 font-mono text-[11px] text-zinc-500">
        <span>En juego</span><span className="text-zinc-300 tnum">{money(w.inPlay, cur)}</span>
      </div>
    </button>
  );
}

// Cartera en la cabecera del móvil
function WalletChip({ onClick }: { onClick: () => void }) {
  const w = useWallet();
  const cur = useCurrency();
  return (
    <button onClick={onClick} title={`Beneficio total ${money(w.profit, cur, true)} · en juego ${money(w.inPlay, cur)}`}
      className="ml-auto flex h-10 cursor-pointer items-center gap-2.5 rounded-full bg-zinc-900 px-3.5 ring-1 ring-inset ring-zinc-800 transition hover:bg-zinc-800/70">
      <Wallet size={15} className="text-amber-400" />
      <span className="flex flex-col items-start leading-tight">
        <span className="label-data text-zinc-500">Saldo</span>
        <span className="whitespace-nowrap font-mono text-[12px] font-semibold text-zinc-50 tnum">{money(w.balance, cur)}</span>
      </span>
    </button>
  );
}

// Partidos en juego de la app elegida, en la columna derecha: marcador y, al pulsar, su ficha
function LiveNow({ items, onAll }: { items: LiveItem[]; onAll: () => void }) {
  const MAX = 6;
  return (
    <section className={cn(panelCls, 'p-4')}>
      <div className="mb-3 flex items-center gap-2">
        <LiveDot className="h-2 w-2" />
        <span className="text-sm font-semibold text-zinc-50">En directo</span>
        <span className="ml-auto grid h-6 min-w-6 place-items-center rounded-full bg-zinc-800 px-1.5 font-mono text-[11px] text-zinc-300 tnum">{items.length}</span>
      </div>
      {!items.length ? <p className="text-xs text-zinc-500">Ahora mismo no hay partidos en juego.</p> : (
        <div className="flex flex-col gap-1.5">
          {items.slice(0, MAX).map(it => (
            <button key={it.id} onClick={it.open}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-zinc-900/70 px-3 py-2.5 text-left ring-1 ring-inset ring-zinc-800 transition hover:bg-zinc-800">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-zinc-100">{it.a} <span className="text-zinc-500">vs</span> {it.b}</span>
                <span className="block truncate font-mono text-[10px] text-zinc-500">{it.info}</span>
              </span>
              <span className="shrink-0 rounded-lg bg-zinc-950 px-2 py-1 font-mono text-sm font-semibold text-amber-400 tnum">{it.sa}–{it.sb}</span>
            </button>
          ))}
          {items.length > MAX && <button onClick={onAll} className="mt-1 cursor-pointer text-xs text-zinc-400 hover:text-zinc-100">Ver los {items.length} partidos</button>}
        </div>
      )}
    </section>
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
    <div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/5 px-4 py-3 text-sm">
      <ServerCrash size={18} className="mt-0.5 shrink-0 text-rose-400" />
      <div>
        <div className="font-semibold text-rose-200">{failing.length ? `No responde: ${failing.join(', ')}` : 'El servidor de la app no responde'}</div>
        <div className="text-zinc-400">Abre Docker Desktop y, en la carpeta del proyecto, ejecuta <code className="text-zinc-200">npm run backend</code>. Los datos vuelven solos en cuanto arranque.</div>
      </div>
    </div>
  );
}
