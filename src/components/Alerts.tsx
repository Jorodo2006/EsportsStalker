// Avisos de cuotas: la campana con su lista (caídas y subidas fuertes en lo tuyo y recomendaciones nuevas con valor, que detecta
// el servidor en server/services/bets/alerts.js) y lo que el servidor tiene que saber del cupón para vigilarlo (WatchSync).
// Un aviso nuevo llega en vivo (alerts:new) y, con la app cerrada, como notificación del sistema (src/lib/push.ts).
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, TrendingDown, TrendingUp, Sparkles } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn } from '@/lib/format';
import { resyncPush } from '@/lib/push';
import type { OddsAlert, OddsWatch, Sport } from '@/lib/types';
import { useMember } from './AuthGate';
import { Button, Dialog, Empty } from './ui';

const SPORT_NAME: Record<string, string> = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA' };
const madridDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const when = (iso: string) => {
  const d = new Date(iso), m = Math.floor((Date.now() - +d) / 60e3);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  if (m < 24 * 60) return `hace ${Math.floor(m / 60)} h`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });
};

export function useAlerts() {
  const member = useMember();
  const qc = useQueryClient();
  useEffect(() => window.api.onAlert(() => qc.invalidateQueries({ queryKey: ['alerts'] })), [qc]);
  return useQuery({ queryKey: ['alerts'], queryFn: () => window.api.alerts.list(), enabled: member, staleTime: 60e3, refetchInterval: 5 * 60e3 });
}

const ICON = { drop: TrendingDown, rise: TrendingUp, value: Sparkles } as const;
const TONE = { drop: 'text-rose-300', rise: 'text-emerald-400', value: 'text-amber-400' } as const;

export function AlertsBell({ className }: { className?: string }) {
  const member = useMember();
  const qc = useQueryClient();
  const q = useAlerts();
  const { switchApp, go, setFocusDay, setFocusId } = useApp();
  const [open, setOpen] = useState(false);
  const unread = q.data?.unread ?? 0;

  // La notificación del sistema abre la app con ?aviso=<id>: se enseña la lista (en la primera campana que lo vea: hay dos, la del
  // móvil y la del menú lateral, y la otra ya no encuentra el parámetro)
  useEffect(() => {
    if (!member) return;
    const u = new URL(location.href);
    if (!u.searchParams.has('aviso')) return;
    u.searchParams.delete('aviso');
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    setOpen(true);
  }, [member]);

  // Abrir la lista es leerla
  useEffect(() => {
    if (!open || !unread) return;
    window.api.alerts.read().then(() => qc.invalidateQueries({ queryKey: ['alerts'] })).catch(() => {});
  }, [open, unread, qc]);

  function openMatch(a: OddsAlert) {
    setOpen(false);
    if (!a.open) return;
    switchApp(a.open.sport as Sport);
    if (a.open.sport !== 'lol' && a.open.date) setFocusDay(madridDay(a.open.date));
    if (a.open.sport !== 'lol' && a.open.id) setFocusId(a.open.id);
    go('matches');
  }

  if (!member) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Avisos de cuotas" aria-label={unread ? `Avisos de cuotas: ${unread} sin leer` : 'Avisos de cuotas'}
        className={cn('relative grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md text-zinc-400 ring-1 ring-inset ring-zinc-800 transition hover:bg-zinc-900 hover:text-zinc-100', className)}>
        <Bell size={16} />
        {unread > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded bg-amber-500 px-1 text-center text-[10px] font-semibold leading-4 text-zinc-950 tnum">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Avisos de cuotas">
        {!q.data?.list.length ? (
          <Empty icon={<Bell size={20} />}>
            Todavía no hay avisos. Te avisaremos cuando caiga o suba mucho una cuota de tus apuestas pendientes, de tu cupón o de los
            partidos de tus favoritos, y cuando salga una recomendación nueva con valor. Elige cuáles en <b>Tu cuenta</b>.
          </Empty>
        ) : (
          <ul className="-mx-4 -my-4 divide-y divide-zinc-800/60 sm:-mx-6 sm:-my-6">
            {q.data.list.map(a => {
              const Icon = ICON[a.kind];
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => openMatch(a)} disabled={!a.open}
                    className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition sm:px-6', a.open && 'cursor-pointer hover:bg-zinc-800/40', !a.read && 'bg-zinc-800/30')}>
                    <Icon size={16} className={cn('mt-0.5 shrink-0', TONE[a.kind])} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-zinc-50">{a.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-zinc-400">{a.body}</span>
                      <span className="mt-1 block text-[11px] text-zinc-500">{[a.sport && SPORT_NAME[a.sport], when(a.created)].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => { setOpen(false); go('account'); }}>Elegir qué avisos</Button>
        </div>
      </Dialog>
    </>
  );
}

// El servidor vigila también lo del cupón: se le manda (sólo lo que reconoce la selección) cada vez que cambia
export function WatchSync() {
  const member = useMember();
  const { slip } = useApp();
  const list = useMemo<OddsWatch[]>(() => slip.flatMap(l => (l.live ? [{
    sport: (l.live.match.sport ?? l.sport ?? 'lol') as Sport, a: l.live.match.a.name, b: l.live.match.b.name, key: l.live.key, out: l.live.out,
    ...(l.ref?.match ? { id: l.ref.match } : {}), ...(l.live.match.start ? { date: l.live.match.start } : {})
  }] : [])), [slip]);
  const sig = JSON.stringify(list);
  // Al entrar, la suscripción de este navegador a las notificaciones pasa a ser de este usuario
  useEffect(() => { if (member) resyncPush(); }, [member]);
  useEffect(() => {
    if (!member) return;
    const t = setTimeout(() => { window.api.alerts.watch(list).catch(() => {}); }, 1500);
    return () => clearTimeout(t);
    // sig resume la lista: no hace falta mandarla otra vez si no cambia
  }, [member, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
