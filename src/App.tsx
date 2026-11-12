import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, CircleUser, Dribbble, Search, ServerCrash, Settings as Cog, Sun, Swords, Users, Wallet } from 'lucide-react';
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
import FootballMatches from '@/views/FootballMatches';
import FootballStandings from '@/views/FootballStandings';
import { FootballIcon } from '@/components/football';
import BetsView from '@/views/BetsView';
import TodayView from '@/views/TodayView';
import SettingsView from '@/views/SettingsView';
import AccountView from '@/views/AccountView';
import { useUser } from '@/components/AuthGate';
import { Notifier } from '@/components/Notifier';
import { SearchDialog, useSearchShortcut } from '@/components/Search';

// Estructura de la app (diseño de Stitch, tres columnas):
//   - desde lg: menú lateral a la izquierda (deportes, navegación, competiciones del día y cartera) y el contenido;
//   - desde 1400 px: además, a la derecha, el cupón fijo y los partidos en directo;
//   - por debajo de lg: cabecera arriba, barra de navegación abajo y el cupón flotante.

const NAV: { view: View; label: string; icon: typeof Users }[] = [
  { view: 'today', label: 'Hoy', icon: Sun },
  { view: 'matches', label: 'Partidos', icon: CalendarDays },
  { view: 'players', label: 'Jugadores', icon: Users },
  { view: 'bets', label: 'Apuestas', icon: Wallet }
];
// En fútbol la segunda sección son las clasificaciones de las ligas
const navLabel = (app: AppId, v: View, label: string) => (v === 'players' && app === 'football' ? 'Clasificación' : label);

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
  { id: 'lol', label: 'LoL', long: 'League of Legends', color: '#3aa894', icon: Swords },
  { id: 'basket', label: 'Baloncesto', long: 'Baloncesto', color: '#dc7d41', icon: Dribbble },
  { id: 'tennis', label: 'Tenis', long: 'Tenis', color: '#67ad53', icon: TennisBall },
  { id: 'football', label: 'Fútbol', long: 'Fútbol', color: '#5f84cc', icon: FootballIcon }
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
  const [searching, setSearching] = useState(false);
  const openSearch = useCallback(() => setSearching(true), []);
  useSearchShortcut(openSearch);
  // Partidos en juego de cada app: aviso rojo del selector y lista "En directo" de la derecha
  const { data: lolLive } = useQuery({ queryKey: ['live'], queryFn: () => window.api.esports.live(), refetchInterval: 60_000 });
  const { data: basketLive } = useQuery({ queryKey: ['basket', 'live'], queryFn: () => window.api.basket.live(), refetchInterval: 60_000, enabled: !!window.api.basket });
  const { data: tennisLive } = useQuery({ queryKey: ['tennis', 'live'], queryFn: () => window.api.tennis.live(), refetchInterval: 60_000, enabled: !!window.api.tennis });
  const { data: footballLive } = useQuery({ queryKey: ['football', 'live'], queryFn: () => window.api.football.live(), refetchInterval: 60_000, enabled: !!window.api.football });
  const live: Record<AppId, number> = { lol: lolLive?.length ?? 0, basket: basketLive?.length ?? 0, tennis: tennisLive?.length ?? 0, football: footballLive?.length ?? 0 };
  // Cada sección empieza arriba (si no, se hereda el desplazamiento de la anterior)
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [app, view]);

  // Los de baloncesto, tenis y fútbol los abre su vista al recibir el id; los de LoL van directos al partido abierto
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
      : app === 'tennis'
        ? (tennisLive ?? []).map(t => ({
          id: t.id, a: surname(t.a.name), b: surname(t.b.name), sa: t.a.setWins.filter(Boolean).length, sb: t.b.setWins.filter(Boolean).length,
          info: [t.tournament, t.status].filter(Boolean).join(' · '), open: () => focus(t.id)
        }))
        : (footballLive ?? []).map(g => ({
          id: g.id, a: g.home.short || g.home.name, b: g.away.short || g.away.name, sa: g.home.score ?? 0, sb: g.away.score ?? 0,
          info: [g.leagueName, g.status].filter(Boolean).join(' · '), open: () => focus(g.id)
        }));

  // Selector de app del móvil: control segmentado; la elegida en gris claro y cada una con el punto de su color
  const appTabs = (
    <div className="grid grid-cols-4 gap-0.5 rounded-lg bg-zinc-900 p-0.5 ring-1 ring-inset ring-zinc-800" role="tablist" aria-label="App">
      {APPS.map(({ id, label, color }) => (
        <button key={id} role="tab" aria-selected={app === id} onClick={() => switchApp(id)} data-app={id}
          className={cn('flex h-8 min-w-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-md px-1 text-xs font-medium transition sm:gap-1.5 sm:px-2 sm:text-[13px]',
            app === id ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-100')}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate">{label}</span>
          {!!live[id] && <span className="text-[11px] font-semibold text-rose-300 tnum">{live[id]}</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div data-app={app} className="flex h-full">
      <Sidebar live={live} onSearch={openSearch} />
      <SearchDialog open={searching} onClose={() => setSearching(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-3 lg:hidden">
          <div className="flex h-14 items-center gap-3">
            <Logo />
            <WalletChip onClick={() => go('bets')} />
            <button onClick={openSearch} title="Buscar" aria-label="Buscar"
              className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md text-zinc-400 ring-1 ring-inset ring-zinc-800 transition hover:bg-zinc-900 hover:text-zinc-100">
              <Search size={16} />
            </button>
            <button onClick={() => go('account')} title="Tu cuenta" aria-label="Tu cuenta" aria-current={view === 'account' || view === 'settings'}
              className={cn('grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md transition',
                view === 'account' || view === 'settings' ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 ring-1 ring-inset ring-zinc-800 hover:bg-zinc-900 hover:text-zinc-100')}>
              <CircleUser size={16} />
            </button>
          </div>
          <div className="pb-2.5">{appTabs}</div>
        </header>

        <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[1680px] items-start gap-5 px-3 py-4 lg:px-5 lg:py-5">
            <div className="min-w-0 flex-1">
              <BackendBanner />
              {view === 'today' && <TodayView />}
              {view === 'matches' && (app === 'lol' ? <MatchesView /> : app === 'basket' ? <BasketMatches /> : app === 'tennis' ? <TennisMatches /> : <FootballMatches />)}
              {view === 'players' && (app === 'lol' ? <PlayersView /> : app === 'basket' ? <BasketPlayers /> : app === 'tennis' ? <TennisPlayers /> : <FootballStandings />)}
              {view === 'bets' && <BetsView key={app} />}
              {view === 'settings' && <SettingsView />}
              {view === 'account' && <AccountView />}
            </div>
            {wide && (
              <aside className="sticky top-5 flex max-h-[calc(100dvh-2.5rem)] w-[340px] shrink-0 flex-col gap-4 overflow-y-auto no-scrollbar">
                <Coupon docked />
                <LiveNow items={liveItems} onAll={() => go('matches')} />
              </aside>
            )}
          </div>
        </main>

        <nav className="grid shrink-0 grid-cols-4 border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)] lg:hidden">
          {NAV.map(({ view: v, label, icon: Icon }) => (
            <button key={v} onClick={() => go(v)} aria-current={view === v}
              className={cn('flex cursor-pointer flex-col items-center gap-1 py-2 text-[11px] font-medium', view === v ? 'text-zinc-50' : 'text-zinc-500')}>
              <span className={cn('grid h-7 place-items-center transition', view === v ? 'text-amber-400' : '')}><Icon size={19} /></span>
              {navLabel(app, v, label)}
            </button>
          ))}
        </nav>
      </div>

      <BetFormDialog />
      {!wide && <Coupon />}
      <Notifier />
      {toastMsg && (
        <div className="fixed bottom-20 left-1/2 z-[60] w-max max-w-[90vw] -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm shadow-lg shadow-black/40 lg:bottom-5">{toastMsg}</div>
      )}
    </div>
  );
}

function Logo({ big }: { big?: boolean }) {
  return (
    <div className={cn('shrink-0 font-semibold tracking-tight text-zinc-50', big ? 'text-[17px]' : 'text-base')}>Sharpex</div>
  );
}

// Menú lateral de escritorio: deportes, navegación, competiciones de la lista de partidos y la cartera abajo
function Sidebar({ live, onSearch }: { live: Record<AppId, number>; onSearch: () => void }) {
  // Los ajustes de la app sólo los ve el administrador; «Tu cuenta», todos
  const isAdmin = !!useUser().data?.isAdmin;
  const { app, switchApp, view, go, sections } = useApp();
  const label = (t: string) => <div className="mb-1 px-3 text-xs font-medium text-zinc-500">{t}</div>;
  const navRow = (on: boolean) => cn('flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm transition',
    on ? 'bg-zinc-800 font-medium text-zinc-50' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100');
  const jump = (id: string) => { go('matches'); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); };
  return (
    <aside className="hidden w-[232px] shrink-0 flex-col overflow-hidden border-r border-zinc-800 bg-surface lg:flex">
      <div className="px-5 pb-3 pt-5"><Logo big /></div>
      <div className="px-2.5 pb-4">
        <button onClick={onSearch} title="Buscar equipos, jugadores y competiciones (Ctrl+K)"
          className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-left text-sm text-zinc-500 transition hover:border-zinc-500 hover:text-zinc-300">
          <Search size={15} className="shrink-0" /><span className="min-w-0 flex-1 truncate">Buscar</span><span className="shrink-0 text-xs text-zinc-600">Ctrl K</span>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2.5 pb-3 no-scrollbar">
        <div>
          {label('Deportes')}
          <div className="flex flex-col gap-1">
            {APPS.map(({ id, long, color, icon: Icon }) => (
              <button key={id} onClick={() => switchApp(id)} aria-pressed={app === id} data-app={id}
                className={cn('flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-left text-sm transition',
                  app === id ? 'bg-zinc-800 font-medium text-zinc-50' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100')}>
                <span className="grid w-4 place-items-center" style={{ color }}><Icon size={16} /></span>
                <span className="min-w-0 flex-1 truncate">{long}</span>
                {!!live[id] && <span className="shrink-0 text-xs text-rose-300 tnum" title="Partidos en juego">{live[id]} en juego</span>}
              </button>
            ))}
          </div>
        </div>

        <div>
          <nav className="flex flex-col gap-1">
            {NAV.map(({ view: v, label: l, icon: Icon }) => (
              <button key={v} onClick={() => go(v)} aria-current={view === v} className={navRow(view === v)}>
                <Icon size={16} className={view === v ? 'text-zinc-50' : ''} />{v === 'bets' ? 'Mis apuestas' : navLabel(app, v, l)}
              </button>
            ))}
            <button onClick={() => go('account')} aria-current={view === 'account'} className={navRow(view === 'account')}>
              <CircleUser size={16} className={view === 'account' ? 'text-zinc-50' : ''} />Tu cuenta
            </button>
            {isAdmin && (
              <button onClick={() => go('settings')} aria-current={view === 'settings'} className={navRow(view === 'settings')} title="De la app entera: valen para todos">
                <Cog size={16} className={view === 'settings' ? 'text-zinc-50' : ''} />Ajustes
              </button>
            )}
          </nav>
        </div>

        {view === 'matches' && !!sections.length && (
          <div>
            {label('Competiciones')}
            <div className="flex flex-col gap-0.5">
              {sections.map(s => (
                <button key={s.id} onClick={() => jump(s.id)}
                  className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-left text-[13px] text-zinc-400 transition hover:bg-zinc-800/50 hover:text-zinc-100">
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {!!s.live && <LiveDot />}
                  <span className="text-xs text-zinc-600 tnum">{s.count}</span>
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
    <button onClick={onClick} className="cursor-pointer border-t border-zinc-800 px-5 py-4 text-left transition hover:bg-zinc-800/40">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>Cartera</span>
        <span className={cn('font-medium tnum', tone(w.profit))}>{money(w.profit, cur, true)}</span>
      </div>
      <div className="mt-1 text-xl font-semibold text-zinc-50 tnum">{money(w.balance, cur)}</div>
      <div className="mt-1 flex justify-between text-xs text-zinc-500">
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
      className="ml-auto flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 ring-1 ring-inset ring-zinc-800 transition hover:bg-zinc-900">
      <Wallet size={15} className="text-zinc-400" />
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[11px] text-zinc-500">Saldo</span>
        <span className="whitespace-nowrap text-[13px] font-semibold text-zinc-50 tnum">{money(w.balance, cur)}</span>
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
        <span className="ml-auto text-xs text-zinc-500 tnum">{items.length}</span>
      </div>
      {!items.length ? <p className="text-xs text-zinc-500">Ahora mismo no hay partidos en juego.</p> : (
        <div className="flex flex-col gap-1.5">
          {items.slice(0, MAX).map(it => (
            <button key={it.id} onClick={it.open}
              className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-zinc-800/60">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-zinc-100">{it.a} <span className="text-zinc-500">vs</span> {it.b}</span>
                <span className="block truncate text-[11px] text-zinc-500">{it.info}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-zinc-50 tnum">{it.sa}–{it.sb}</span>
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
