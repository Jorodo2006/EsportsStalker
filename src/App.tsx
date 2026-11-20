import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, CircleUser, Dribbble, Target, Search, ServerCrash, Settings as Cog, Shield, Swords, UserPlus, Users, Wallet } from 'lucide-react';
import { useApp, useCurrency, useWallet, type AppId, type View } from '@/lib/app-context';
import { madridDay } from '@/lib/route';
import { useLive } from '@/lib/live';
import { cn, money, tone } from '@/lib/format';
import type { BackendStatus } from '@/lib/types';
import { BetFormDialog } from '@/components/BetForm';
import { Welcome } from '@/components/Welcome';
import { Coupon } from '@/components/Coupon';
import { LEAGUE_NAME } from '@/components/BasketAnalyzer';
import { LiveDot } from '@/components/sport';
import { panelCls } from '@/components/ui';
import { FooterJuego } from '@/components/FooterJuego';
import { surname } from '@/components/viz';
import { AdSlot } from '@/components/AdSlot';
import { useMedia } from '@/lib/use-media';
import MatchesView from '@/views/MatchesView';
import PlayersView from '@/views/PlayersView';
import BasketMatches from '@/views/BasketMatches';
import BasketPlayers from '@/views/BasketPlayers';
import TennisMatches from '@/views/TennisMatches';
import TennisPlayers from '@/views/TennisPlayers';
import FootballMatches from '@/views/FootballMatches';
import FootballStandings from '@/views/FootballStandings';
import { FootballIcon } from '@/components/football';
import MmaFights from '@/views/MmaFights';
import MmaFighters from '@/views/MmaFighters';
import { MmaIcon } from '@/components/mma';
import BetsView from '@/views/BetsView';
import SettingsView from '@/views/SettingsView';
import AdminView from '@/views/AdminView';
import PlanView from '@/views/PlanView';
import AccountView from '@/views/AccountView';
import LegalView from '@/views/LegalView';
import { askLogin, useMember, useUser } from '@/components/AuthGate';
import { JoinPrompt } from '@/components/MemberOnly';
import { Button, Loading, PageHeader } from '@/components/ui';
import { ScreenGuard } from '@/components/ScreenGuard';
import { Notifier } from '@/components/Notifier';
import { SearchDialog, useSearchShortcut } from '@/components/Search';
import FriendsView, { FriendsBadge } from './views/FriendsView';
import { AlertsBell, WatchSync } from './components/Alerts';

// Estructura de la app (diseño de Stitch, tres columnas):
//   - desde lg: menú lateral a la izquierda (deportes, navegación, competiciones del día y cartera) y el contenido;
//   - desde 1400 px: además, a la derecha (300 px, el ancho de los anuncios), el cupón fijo, un anuncio, los partidos en directo
//     y otro anuncio;
//   - por debajo de lg: cabecera arriba, barra de navegación abajo y el cupón flotante.

const NAV: { view: View; label: string; icon: typeof Users }[] = [
  { view: 'matches', label: 'Partidos', icon: CalendarDays },
  { view: 'players', label: 'Jugadores', icon: Users },
  { view: 'bets', label: 'Apuestas', icon: Wallet },
  { view: 'plan', label: 'Plan', icon: Target },
  { view: 'friends', label: 'Amigos', icon: UserPlus }
];
// En fútbol la segunda sección son las clasificaciones de las ligas; en MMA, los luchadores, y sus partidos son combates
const navLabel = (app: AppId, v: View, label: string) => (v === 'players' && app === 'football' ? 'Clasificación' : v === 'players' && app === 'mma' ? 'Luchadores' : v === 'matches' && app === 'mma' ? 'Combates' : label);

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
  { id: 'basket', label: 'Basket', long: 'Baloncesto', color: '#dc7d41', icon: Dribbble },
  { id: 'tennis', label: 'Tenis', long: 'Tenis', color: '#67ad53', icon: TennisBall },
  { id: 'football', label: 'Fútbol', long: 'Fútbol', color: '#5f84cc', icon: FootballIcon },
  { id: 'mma', label: 'MMA', long: 'MMA', color: '#bf5a5a', icon: MmaIcon }
];

// Un partido en juego para la lista de la columna derecha
interface LiveItem { id: string; a: string; b: string; sa: ReactNode; sb: ReactNode; info: string; open: () => void }

export default function App() {
  const { app, switchApp, view, go, toastMsg, setOpenMatch, openGame, slip, starting } = useApp();
  const member = useMember();
  // Ajustes y administración sólo se pintan a un administrador: con las direcciones, cualquiera puede escribir /admin, y la pantalla
  // pedía la lista de cuentas (el servidor responde 403) antes de que app-context le devolviera a los partidos
  const isAdmin = !!useUser().data?.isAdmin;
  const wide = useMedia('(min-width: 1400px)');
  // El cupón flotante (móvil y pantallas medianas) tapa el final de la pantalla: el pie deja hueco para que se lea entero
  const [searching, setSearching] = useState(false);
  const openSearch = useCallback(() => setSearching(true), []);
  useSearchShortcut(openSearch);
  // Partidos en juego de cada app: aviso rojo del selector y lista "En directo" de la derecha (src/lib/live.ts)
  const { lol: lolLive, basket: basketLive, tennis: tennisLive, football: footballLive, mma: mmaLive, counts: live } = useLive();
  // Cada sección empieza arriba (si no, se hereda el desplazamiento de la anterior)
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [app, view]);
  // Cabecera del móvil: se esconde al bajar y vuelve al subir, para que la lista use toda la pantalla.
  // Es sticky dentro del scroll y se mueve con transform: así no cambia el alto de nada y el scroll no tiembla
  const [hideHead, setHideHead] = useState(false);
  // Alto de la cabecera: los filtros fijos de cada lista (StateFilterBar) se colocan bajo ella, o arriba del todo si está escondida
  const headRef = useRef<HTMLElement>(null);
  const [headH, setHeadH] = useState(0);
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeadH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lastY = useRef(0);
  const onMainScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const y = e.currentTarget.scrollTop;
    const dy = y - lastY.current;
    if (y < 60) setHideHead(false);
    else if (dy > 10) setHideHead(true);
    else if (dy < -10) setHideHead(false);
    if (Math.abs(dy) > 10 || y < 60) lastY.current = y;
  }, []);
  useEffect(() => { setHideHead(false); lastY.current = 0; }, [app, view]);

  // Cada partido se abre en su dirección, con el día de España en el que lo lista su servicio; los de LoL, enteros
  const focus = (id: string, date: string) => openGame(id, madridDay(date));
  const liveItems: LiveItem[] = app === 'lol'
    ? (lolLive ?? []).filter(m => m.teams.length === 2).map(m => ({
      id: m.id, a: m.teams[0].code || m.teams[0].name, b: m.teams[1].code || m.teams[1].name, sa: m.teams[0].wins ?? 0, sb: m.teams[1].wins ?? 0,
      info: [m.league, m.blockName].filter(Boolean).join(' · '), open: () => setOpenMatch(m)
    }))
    : app === 'basket'
      ? (basketLive ?? []).map(g => ({
        id: g.id, a: g.away.abbr, b: g.home.abbr, sa: g.away.score ?? 0, sb: g.home.score ?? 0,
        info: [LEAGUE_NAME[g.league], g.status].filter(Boolean).join(' · '), open: () => focus(g.id, g.date)
      }))
      : app === 'tennis'
        ? (tennisLive ?? []).map(t => ({
          id: t.id, a: surname(t.a.name), b: surname(t.b.name), sa: t.a.setWins.filter(Boolean).length, sb: t.b.setWins.filter(Boolean).length,
          info: [t.tournament, t.status].filter(Boolean).join(' · '), open: () => focus(t.id, t.date)
        }))
        : app === 'football'
          ? (footballLive ?? []).map(g => ({
            id: g.id, a: g.home.short || g.home.name, b: g.away.short || g.away.name, sa: g.home.score ?? 0, sb: g.away.score ?? 0,
            info: [g.leagueName, g.status].filter(Boolean).join(' · '), open: () => focus(g.id, g.date)
          }))
          : (mmaLive ?? []).map(g => ({
            id: g.id, a: surname(g.a.name), b: surname(g.b.name), sa: '', sb: '',
            info: [g.orgName, g.status].filter(Boolean).join(' · '), open: () => focus(g.id, g.date)
          }));

  // Selector de app del móvil: control segmentado; la elegida en gris claro y cada una con el punto de su color
  const appTabs = (
    <div className="grid grid-cols-5 gap-0.5 rounded-lg bg-zinc-900 p-0.5 ring-1 ring-inset ring-zinc-800" role="tablist" aria-label="App">
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
      <WatchSync />

      <div className="flex min-w-0 flex-1 flex-col">
        <main ref={mainRef} onScroll={onMainScroll} style={{ '--head': hideHead ? '0px' : `${headH}px` } as React.CSSProperties} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <header ref={headRef} className={cn('sticky top-0 z-30 shrink-0 border-b border-zinc-800 bg-zinc-950 px-3 pt-[env(safe-area-inset-top)] transition-transform duration-200 lg:hidden', hideHead && '-translate-y-full')}>
          <div className="flex h-12 items-center gap-2">
            <Logo />
            {member ? <WalletChip onClick={() => go('bets')} /> : (
              <Button className="ml-auto" onClick={() => askLogin()}>Entrar</Button>
            )}
            <button onClick={openSearch} title="Buscar" aria-label="Buscar"
              className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md text-zinc-400 ring-1 ring-inset ring-zinc-800 transition hover:bg-zinc-900 hover:text-zinc-100">
              <Search size={16} />
            </button>
            <AlertsBell />
            <button onClick={() => go('account')} title="Tu cuenta" aria-label="Tu cuenta" aria-current={view === 'account' || view === 'settings' || view === 'admin'}
              className={cn('grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md transition',
                view === 'account' || view === 'settings' || view === 'admin' ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 ring-1 ring-inset ring-zinc-800 hover:bg-zinc-900 hover:text-zinc-100')}>
              <CircleUser size={16} />
            </button>
          </div>
          <div className="pb-2">{appTabs}</div>
        </header>

          <div className="mx-auto flex w-full max-w-[1680px] flex-1 items-start gap-5 px-3 py-4 lg:px-5 lg:py-5">
            <div className="min-w-0 flex-1">
              <BackendBanner />
              <ScreenGuard key={`${app}:${view}`}>
              {starting && <Loading label="Buscando los partidos de hoy…" />}
              {view === 'matches' && !starting && (app === 'lol' ? <MatchesView /> : app === 'basket' ? <BasketMatches /> : app === 'tennis' ? <TennisMatches /> : app === 'football' ? <FootballMatches /> : <MmaFights />)}
              {view === 'players' && (app === 'lol' ? <PlayersView /> : app === 'basket' ? <BasketPlayers /> : app === 'tennis' ? <TennisPlayers /> : app === 'football' ? <FootballStandings /> : <MmaFighters />)}
              {view === 'bets' && (member ? <BetsView key={app} /> : <GuestScreen title="Mis apuestas" what="tu registro de apuestas y tu cartera" />)}
              {view === 'plan' && (member ? <PlanView /> : <GuestScreen title="Plan" what="el plan de apuestas" />)}
              {view === 'friends' && (member ? <FriendsView /> : <GuestScreen title="Amigos" what="tus amigos y vuestro chat" />)}
              {view === 'settings' && isAdmin && <SettingsView />}
              {view === 'admin' && isAdmin && <AdminView />}
              {view === 'account' && (member ? <AccountView /> : <GuestScreen title="Tu cuenta" what="tu cuenta" />)}
              {view === 'legal' && <LegalView />}
              </ScreenGuard>
            </div>
            {wide && (
              <aside className="sticky top-5 flex max-h-[calc(100dvh-2.5rem)] w-[300px] shrink-0 flex-col gap-4 overflow-y-auto no-scrollbar">
                <Coupon docked />
                <AdSlot size="rect" />
                <LiveNow items={liveItems} onAll={() => go('matches')} />
                <AdSlot size="half" />
              </aside>
            )}
          </div>
          <FooterJuego className={cn('mt-6', !wide && slip.length > 0 && 'pb-16')} inner="max-w-[1680px] px-3 lg:px-5" />
        </main>

        <nav className="grid shrink-0 grid-cols-5 border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)] lg:hidden">
          {NAV.map(({ view: v, label, icon: Icon }) => (
            <button key={v} onClick={() => go(v)} aria-current={view === v}
              className={cn('flex cursor-pointer flex-col items-center gap-1 py-2 text-[11px] font-medium', view === v ? 'text-zinc-50' : 'text-zinc-500')}>
              <span className={cn('grid h-7 place-items-center transition', view === v ? 'text-amber-400' : '')}><Icon size={19} /></span>
              <span className="flex items-center gap-1">{navLabel(app, v, label)}{v === 'friends' && member && <FriendsBadge />}</span>
            </button>
          ))}
        </nav>
      </div>

      <BetFormDialog />
      <Welcome />
      {!wide && <Coupon />}
      <Notifier />
      {toastMsg && (
        <div className="fixed bottom-20 left-1/2 z-[60] w-max max-w-[90vw] -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm shadow-lg shadow-black/40 lg:bottom-5">{toastMsg}</div>
      )}
    </div>
  );
}

// El logo (public/logo.png, con fondo transparente): el icono y el nombre
function Logo({ big }: { big?: boolean }) {
  return <img src="/logo.png" alt="Sharpex" className={cn('block w-auto shrink-0', big ? 'h-7' : 'h-6')} />;
}

// Menú lateral de escritorio: deportes, navegación, competiciones de la lista de partidos y la cartera abajo
function Sidebar({ live, onSearch }: { live: Record<AppId, number>; onSearch: () => void }) {
  // Los ajustes de la app sólo los ve el administrador; «Tu cuenta», todos
  const me = useUser().data;
  const isAdmin = !!me?.isAdmin;
  const { app, switchApp, view, go, sections } = useApp();
  const label = (t: string) => <div className="mb-1 px-3 text-xs font-medium text-zinc-500">{t}</div>;
  const navRow = (on: boolean) => cn('flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm transition',
    on ? 'bg-zinc-800 font-medium text-zinc-50' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100');
  const jump = (id: string) => { go('matches'); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); };
  return (
    <aside className="hidden w-[232px] shrink-0 flex-col overflow-hidden border-r border-zinc-800 bg-surface lg:flex">
      <div className="flex items-center justify-between gap-2 pb-3 pl-5 pr-2.5 pt-5"><Logo big /><AlertsBell /></div>
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
                <Icon size={16} className={view === v ? 'text-zinc-50' : ''} />{v === 'bets' ? 'Mis apuestas' : navLabel(app, v, l)}{v === 'friends' && me && <FriendsBadge />}
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
            {isAdmin && (
              <button onClick={() => go('admin')} aria-current={view === 'admin'} className={navRow(view === 'admin')} title="Cuentas y registro de actividad">
                <Shield size={16} className={view === 'admin' ? 'text-zinc-50' : ''} />Administración
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
      {me ? <SidebarWallet onClick={() => go('bets')} /> : <SidebarJoin />}
    </aside>
  );
}

// Sin cuenta, en lugar de la cartera: qué se gana entrando
function SidebarJoin() {
  return (
    <div className="border-t border-zinc-800 px-4 py-4">
      <p className="text-xs leading-relaxed text-zinc-400">Crea tu cuenta gratis para ver las recomendaciones, apuntar tus apuestas y llevar tu cartera.</p>
      <div className="mt-3 flex flex-col gap-2">
        <Button size="sm" onClick={() => askLogin({ mode: 'register' })}>Crear cuenta</Button>
        <Button size="sm" variant="secondary" onClick={() => askLogin()}>Entrar</Button>
      </div>
    </div>
  );
}

// Las pantallas de cada usuario, a quien navega sin cuenta
function GuestScreen({ title, what }: { title: string; what: string }) {
  return <><PageHeader title={title} /><JoinPrompt what={what} /></>;
}

// Cartera común a las cinco apps en el menú lateral: el saldo en grande y, debajo, cada cifra con su nombre (antes el
// beneficio iba sin etiqueta junto a «Cartera»). Sin banca inicial el saldo no dice nada (sale en negativo con la primera
// apuesta): en su lugar se invita a ponerla
function SidebarWallet({ onClick }: { onClick: () => void }) {
  const { settings, go } = useApp();
  const w = useWallet();
  const cur = useCurrency();
  const noBank = !!settings && !settings.initialBankroll;
  const row = (label: string, value: ReactNode) => <div className="mt-1 flex justify-between text-xs text-zinc-500"><span>{label}</span>{value}</div>;
  return (
    <div className="border-t border-zinc-800">
      <button onClick={noBank ? () => go('account') : onClick} className="w-full cursor-pointer px-5 py-4 text-left transition hover:bg-zinc-800/40">
        <div className="text-xs text-zinc-500">{noBank ? 'Cartera' : 'Saldo'}</div>
        {noBank
          ? <div className="mt-1 text-sm font-medium text-amber-300">Pon tu banca inicial</div>
          : <div className="mt-0.5 text-xl font-semibold text-zinc-50 tnum">{money(w.balance, cur)}</div>}
        {row('Beneficio', <span className={cn('font-medium tnum', tone(w.profit) || 'text-zinc-300')}>{money(w.profit, cur, true)}</span>)}
        {row('En juego', <span className="text-zinc-300 tnum">{money(w.inPlay, cur)}</span>)}
      </button>
    </div>
  );
}

// Cartera en la cabecera del móvil. Sin banca inicial, en vez de un saldo negativo, «Pon tu banca» (lleva a Tu cuenta)
function WalletChip({ onClick }: { onClick: () => void }) {
  const { settings, go } = useApp();
  const w = useWallet();
  const cur = useCurrency();
  const noBank = !!settings && !settings.initialBankroll;
  return (
    <button onClick={noBank ? () => go('account') : onClick} title={`Beneficio total ${money(w.profit, cur, true)} · en juego ${money(w.inPlay, cur)}`}
      className="ml-auto flex h-9 min-w-0 shrink cursor-pointer items-center gap-2 rounded-md px-2.5 ring-1 ring-inset ring-zinc-800 transition hover:bg-zinc-900">
      <Wallet size={15} className="hidden shrink-0 text-zinc-400 min-[400px]:block" />
      <span className="flex min-w-0 flex-col items-start leading-tight">
        <span className="text-[11px] text-zinc-500">{noBank ? 'Cartera' : 'Saldo'}</span>
        {noBank
          ? <span className="max-w-full truncate text-[13px] font-medium text-amber-300">Pon tu banca</span>
          : <span className="max-w-full truncate text-[13px] font-semibold text-zinc-50 tnum">{money(w.balance, cur)}</span>}
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
