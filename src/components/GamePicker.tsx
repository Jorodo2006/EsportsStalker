// Formulario de apuesta, deportes que no son LoL: el partido se elige de los del día de ese deporte (los mismos que su pantalla
// de Partidos), con el nombre tal como lo lee la resolución (gameOf de server/services/bets/ticket.js), para que se enlace sola
// y salga en «Tus apuestas». Se puede seguir escribiendo a mano. Además, los jugadores del partido elegido para la selección y
// el aviso de mercado que la app no entiende, con la opción de enseñárselo (marketAliases)
import { useEffect, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, fmtTime } from '@/lib/format';
import type { BasketGame, FootballMatch, MmaFight, Settings, Sport, TennisMatch } from '@/lib/types';
import { Badge, Button, Select, inputCls } from './ui';

type AnyGame = BasketGame | FootballMatch | TennisMatch | MmaFight;
export interface PickedGame { id: string; event: string; league: string; date: string; live: boolean; sides: [string, string] }

// Mismas claves de caché que las pantallas de Partidos de cada deporte
function gamesQuery(sport: Sport, day: string): { queryKey: string[]; queryFn: () => Promise<AnyGame[]> } {
  if (sport === 'basket') return { queryKey: ['basket', 'games', day], queryFn: () => window.api.basket.games(day) };
  if (sport === 'football') return { queryKey: ['football', 'games', day], queryFn: () => window.api.football.games(day) };
  if (sport === 'tennis') return { queryKey: ['tennis', 'games', day], queryFn: () => window.api.tennis.games(day) };
  return { queryKey: ['mma', 'games', day], queryFn: () => window.api.mma.games(day) };
}
// El partido con el nombre que entiende la resolución: baloncesto «AWY @ HOM», fútbol «Local - Visitante», tenis «A - B», MMA «A vs B»
function pickedOf(sport: Sport, g: AnyGame): PickedGame | null {
  const live = g.state === 'in';
  if (sport === 'basket') { const b = g as BasketGame; return { id: b.id, event: `${b.away.abbr} @ ${b.home.abbr}`, league: b.league.toUpperCase().replace('EUROLEAGUE', 'Euroliga').replace('EUROCUP', 'EuroCup'), date: b.date, live, sides: [b.away.name, b.home.name] }; }
  if (sport === 'football') { const f = g as FootballMatch; return { id: f.id, event: `${f.home.name} - ${f.away.name}`, league: f.leagueName, date: f.date, live, sides: [f.home.name, f.away.name] }; }
  if (sport === 'tennis') { const t = g as TennisMatch; return t.a?.name && t.b?.name ? { id: t.id, event: `${t.a.name} - ${t.b.name}`, league: t.tournament, date: t.date, live, sides: [t.a.name, t.b.name] } : null; }
  const m = g as MmaFight;
  return m.cancelled ? null : { id: m.id, event: `${m.a.name} vs ${m.b.name}`, league: m.orgName, date: m.date, live, sides: [m.a.name, m.b.name] };
}
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Los partidos del día de un deporte, ya con su nombre
export function useDayGames(sport: Sport, day: string) {
  const q = useQuery({ ...gamesQuery(sport, day), enabled: sport !== 'lol' && !!day, staleTime: 60_000 });
  const list = ((q.data ?? []) as AnyGame[]).map(g => pickedOf(sport, g)).filter((g): g is PickedGame => !!g)
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  return { list, raw: (q.data ?? []) as AnyGame[], loading: q.isLoading };
}

export function GamePicker({ sport, day, value, onChange, onPick, placeholder, required }: {
  sport: Sport; day: string; value: string; onChange: (v: string) => void; onPick: (g: PickedGame) => void; placeholder?: string; required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const { list, loading } = useDayGames(sport, day);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const words = norm(value).split(' ').filter(w => w && w !== 'vs');
  // Si ya es el nombre de un partido de la lista, se enseñan todos (para poder cambiarlo)
  const exact = list.some(g => g.event === value);
  const items = (exact ? list : list.filter(g => words.every(w => norm(`${g.event} ${g.sides.join(' ')} ${g.league}`).includes(w)))).slice(0, 40);
  useEffect(() => setHi(0), [value]);
  const choose = (g: PickedGame) => { onPick(g); setOpen(false); };

  return (
    <div ref={box} className="relative">
      <input value={value} placeholder={placeholder} required={required} className={inputCls}
        onChange={e => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (!open && e.key === 'ArrowDown') { setOpen(true); return; }
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && items[hi]) { e.preventDefault(); choose(items[hi]); }
          else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
          else if (e.key === 'Tab') setOpen(false);
        }} />
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 max-h-80 w-full min-w-[18rem] overflow-y-auto rounded-xl border border-zinc-700/70 bg-zinc-950 p-1.5 shadow-2xl shadow-black/60 sm:w-[26rem]">
          <div className="px-3 pb-1 pt-2 text-xs font-semibold text-zinc-600">Partidos del día de la apuesta</div>
          {loading && <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500"><Loader2 size={13} className="animate-spin" />Cargando partidos…</div>}
          {items.map((g, i) => (
            <button key={g.id} type="button" onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); choose(g); }}
              className={cn('flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left', i === hi ? 'bg-zinc-800/80' : 'hover:bg-zinc-900')}>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.event}</span>
              {g.live && <Badge tone="live">Directo</Badge>}
              <span className="max-w-[45%] shrink-0 truncate text-xs text-zinc-500">{g.league} · {fmtTime(g.date)}</span>
            </button>
          ))}
          {!loading && !items.length && (
            <div className="px-3 py-2 text-sm text-zinc-500">{list.length ? 'Ningún partido de ese día coincide. Puedes dejarlo escrito así.' : 'No hay partidos ese día. Cambia la fecha o escríbelo a mano.'}</div>
          )}
        </div>
      )}
    </div>
  );
}

// Los jugadores del partido escrito (si es uno de la lista del día), para sugerirlos en la selección: fútbol, la alineación
// (sale una hora antes); baloncesto, las plantillas; tenis y MMA, los dos
function useGamePlayers(sport: Sport, day: string, event: string): string[] {
  const { list, raw } = useDayGames(sport, day);
  const g = list.find(x => x.event === event);
  const bg = sport === 'basket' && g ? (raw as BasketGame[]).find(x => x.id === g.id) : undefined;
  const foot = useQuery({
    queryKey: ['football', 'match', g?.id], queryFn: () => window.api.football.match(g!.id), enabled: sport === 'football' && !!g, staleTime: 5 * 60e3
  });
  const rosters = useQueries({
    queries: (bg ? [bg.away, bg.home] : []).map(t => ({
      queryKey: ['basket', 'roster', bg!.league, t.id], queryFn: () => window.api.basket.roster(bg!.league, t.id), staleTime: 30 * 60e3
    }))
  });
  if (!g) return [];
  if (sport === 'tennis' || sport === 'mma') return g.sides;
  if (sport === 'football') return [...new Set((foot.data?.lineups ?? []).flatMap(l => l.players.map(p => p.name)))];
  return [...new Set(rosters.flatMap(r => (r.data ?? []).map(p => p.name)))];
}

// Como lista de sugerencias de un campo (list={id})
export function PlayersList({ id, sport, day, event }: { id: string; sport: Sport; day: string; event: string }) {
  const names = useGamePlayers(sport, day, event);
  return <datalist id={id}>{names.map(n => <option key={n} value={n} />)}</datalist>;
}

// Mercados a los que se puede enseñar uno que no se entiende. n: el número que lleva lo escrito («Chuta 2 veces» → 2)
function teachable(sport: Sport, text: string): string[] {
  const n = Number(/(\d+)/.exec(text)?.[1] ?? 1) || 1;
  if (sport === 'football') return ['Resultado', 'Total de goles', 'Ambos marcan', 'Total de tarjetas', 'Total de córners', 'Goleador',
    `Marca ${n} goles o más`, `Realiza ${n} o más remates`, `Realiza ${n} o más remates a puerta`, `Realiza ${n} o más paradas`,
    `Comete ${n} o más faltas`, `Recibe ${n} o más faltas`, 'El jugador recibe una o más tarjetas'];
  if (sport === 'tennis') return ['Ganador', 'Total de juegos', 'Hándicap de juegos'];
  if (sport === 'mma') return ['Ganador'];
  return [];
}

// Bajo el mercado: si la app no lo entiende, lo dice (no se seguirá ni se resolverá sola) y deja enseñarle qué es; se guarda
// para las siguientes apuestas del usuario. Si lo entiende con otro nombre, cuál
export function MarketHint({ sport, event, market, selection }: { sport: Sport; event: string; market: string; selection: string }) {
  const { settings } = useApp();
  const qc = useQueryClient();
  const [q, setQ] = useState({ event, market, selection });
  const [as, setAs] = useState('');
  const [saving, setSaving] = useState(false);
  // Se pregunta al dejar de escribir
  useEffect(() => { const t = setTimeout(() => setQ({ event, market, selection }), 600); return () => clearTimeout(t); }, [event, market, selection]);
  const on = sport === 'football' || sport === 'tennis' || sport === 'mma';
  const r = useQuery({
    queryKey: ['bets', 'understand', sport, q, settings?.marketAliases], queryFn: () => window.api.bets.understand({ sport, ...q }),
    enabled: on && !!q.event.trim() && !!q.market.trim(), staleTime: Infinity
  });
  const opts = teachable(sport, q.market);
  useEffect(() => setAs(''), [q.market]);
  if (!on || !r.data) return null;
  if (r.data.known) return r.data.market && norm(r.data.market) !== norm(q.market)
    ? <div className="col-span-6 -mt-1 text-xs text-zinc-500">Se sigue como «{r.data.market}»</div> : null;

  async function teach() {
    if (!as) return;
    setSaving(true);
    try {
      const key = ['settings', true];
      const next = { ...(settings?.marketAliases ?? {}), [q.market]: as };
      qc.setQueryData(key, await window.api.settings.set({ marketAliases: next } as Partial<Settings>));
    } finally { setSaving(false); }
  }
  return (
    <div className="col-span-6 -mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
      <span className="min-w-0 flex-1 basis-56">La app no entiende «{q.market}»: no se podrá seguir en directo ni resolver sola. ¿Qué es? Se recordará para la próxima.</span>
      <Select className="h-8 w-auto min-w-0 flex-1 basis-40 text-xs" value={as} onChange={e => setAs(e.target.value)}>
        <option value="">Elige el mercado…</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </Select>
      <Button type="button" size="sm" variant="secondary" disabled={!as || saving} onClick={teach}>Recordar</Button>
    </div>
  );
}
