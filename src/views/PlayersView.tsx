import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { cn, fmtDate, pct, utc } from '@/lib/format';
import type { PlayerGame, TeamGame } from '@/lib/types';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Stat, td, th } from '@/components/ui';
import { SearchBox } from '@/components/SearchBox';

// Equipo: "nombre|siglas" cuando viene de lolesports (hay que buscar su nombre en Leaguepedia); exact si ya es el de Leaguepedia
type Sel = { kind: 'player' | 'team'; name: string; exact?: boolean } | null;
const parseParam = (p: string): Sel => ({ kind: 'team', name: p, exact: !p.includes('|') });

export default function PlayersView() {
  const { viewParam } = useApp();
  const [sel, setSel] = useState<Sel>(viewParam ? parseParam(viewParam) : null);
  useEffect(() => { if (viewParam) setSel(parseParam(viewParam)); }, [viewParam]);

  return (
    <>
      <PageHeader title="Jugadores y equipos" subtitle="Estadísticas de partidas profesionales (Leaguepedia)">
        <SearchBox onPick={p => setSel({ kind: p.kind, name: p.name, exact: p.exact ?? !p.name.includes('|') })} />
      </PageHeader>

      {!sel ? <Empty icon={<Search size={28} />}>Escribe el nombre de un jugador o equipo y elige una de las sugerencias</Empty>
        : sel.kind === 'player' ? <PlayerPanel page={sel.name} onTeam={t => setSel({ kind: 'team', name: t, exact: true })} />
          : <TeamLoader sel={sel} onPlayer={p => setSel({ kind: 'player', name: p })} onTeam={t => setSel({ kind: 'team', name: t, exact: true })} />}
    </>
  );
}

// Traduce el nombre de lolesports ("Gen.G Esports") al de Leaguepedia ("Gen.G") antes de pedir sus partidas
function TeamLoader({ sel, onPlayer, onTeam }: { sel: NonNullable<Sel>; onPlayer: (p: string) => void; onTeam: (t: string) => void }) {
  const [name, code] = sel.name.split('|');
  const res = useQuery({ queryKey: ['resolveTeam', name, code], queryFn: () => (window.api.stats.resolveTeam ? window.api.stats.resolveTeam(name, code) : Promise.resolve(name)), enabled: !sel.exact, staleTime: 24 * 3600e3 });
  if (sel.exact) return <TeamPanel team={name} onPlayer={onPlayer} onTeam={onTeam} />;
  if (res.isLoading) return <Loading label={`Buscando ${name} en Leaguepedia…`} />;
  if (res.error) return <ErrorBox error={res.error} />;
  return <TeamPanel team={res.data || name} onPlayer={onPlayer} onTeam={onTeam} />;
}

function PlayerPanel({ page, onTeam }: { page: string; onTeam: (t: string) => void }) {
  const { data: games, error, isLoading } = useQuery({ queryKey: ['player', page], queryFn: () => window.api.stats.playerGames(page), staleTime: 10 * 60e3 });
  const s = useMemo(() => games?.length ? stats(games) : null, [games]);
  if (isLoading) return <Loading label={`Cargando partidas de ${page}…`} />;
  if (error) return <ErrorBox error={error} />;
  if (!games?.length || !s) return <Empty>No hay partidas profesionales registradas para {page}</Empty>;
  const last = games[0];

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3">
        <h2 className="text-xl font-bold">{page}</h2>
        <span className="text-sm text-zinc-400">{last.role} · <button className="cursor-pointer text-amber-400 hover:underline" onClick={() => onTeam(last.team)}>{last.team}</button></span>
        <span className="ml-auto text-xs text-zinc-500">Últimas {games.length} partidas</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <Stat label="Victorias" value={pct(s.wr)} sub={`${s.wins}V - ${games.length - s.wins}D`} valueClass={s.wr >= .5 ? 'text-emerald-400' : 'text-rose-400'} />
        <Stat label="KDA" value={s.kda.toFixed(2)} />
        <Stat label="K / D / A" value={<span className="text-xl">{s.k.toFixed(1)} / {s.d.toFixed(1)} / {s.a.toFixed(1)}</span>} />
        <Stat label="CS medio" value={s.cs.toFixed(0)} />
        <Stat label="Oro medio" value={`${(s.gold / 1000).toFixed(1)}k`} />
        <Stat label="Daño medio" value={`${(s.dmg / 1000).toFixed(1)}k`} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[2fr_3fr]">
        <Card title="Campeones">
          <div className="space-y-2.5">
            {s.champs.map(c => (
              <div key={c.name} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 text-sm">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-amber-500/70" style={{ width: `${(c.n / s.champs[0].n) * 100}%` }} /></div>
                </div>
                <span className="tabular-nums text-zinc-400">{c.n}p</span>
                <span className={cn('w-12 text-right tabular-nums', c.w / c.n >= .5 ? 'text-emerald-400' : 'text-rose-400')}>{pct(c.w / c.n)}</span>
                <span className="w-12 text-right tabular-nums text-zinc-300">{((c.k + c.a) / Math.max(1, c.d)).toFixed(1)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Partidas" className="overflow-hidden">
          <div className="-m-5 max-h-[480px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-zinc-900"><tr>
                <th className={th}>Fecha</th><th className={th}>Torneo</th><th className={th}>Campeón</th><th className={th + ' text-right'}>K/D/A</th><th className={th + ' text-right'}>CS</th><th className={th}></th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-800/70">
                {games.map((g, i) => (
                  <tr key={i} className="hover:bg-zinc-900/40">
                    <td className={td + ' text-zinc-400'}>{fmtDate(utc(g.date))}</td><td className={td + ' max-w-48 truncate'} title={g.tournament}>{g.tournament}</td>
                    <td className={td}>{g.champion}</td><td className={td + ' text-right tabular-nums'}>{g.kills}/{g.deaths}/{g.assists}</td>
                    <td className={td + ' text-right tabular-nums'}>{g.cs}</td>
                    <td className={td}><Badge tone={g.win ? 'success' : 'danger'}>{g.win ? 'V' : 'D'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function stats(games: PlayerGame[]) {
  const n = games.length;
  const sum = (f: (g: PlayerGame) => number) => games.reduce((s, g) => s + f(g), 0);
  const wins = games.filter(g => g.win).length;
  const champs = new Map<string, { name: string; n: number; w: number; k: number; d: number; a: number }>();
  for (const g of games) {
    const c = champs.get(g.champion) ?? { name: g.champion, n: 0, w: 0, k: 0, d: 0, a: 0 };
    c.n++; c.w += +g.win; c.k += g.kills; c.d += g.deaths; c.a += g.assists;
    champs.set(g.champion, c);
  }
  return {
    wins, wr: wins / n,
    kda: (sum(g => g.kills) + sum(g => g.assists)) / Math.max(1, sum(g => g.deaths)),
    k: sum(g => g.kills) / n, d: sum(g => g.deaths) / n, a: sum(g => g.assists) / n,
    cs: sum(g => g.cs) / n, gold: sum(g => g.gold) / n, dmg: sum(g => g.damage) / n,
    champs: [...champs.values()].sort((x, y) => y.n - x.n)
  };
}

const ROLES = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];

function TeamPanel({ team, onPlayer, onTeam }: { team: string; onPlayer: (p: string) => void; onTeam: (t: string) => void }) {
  const games = useQuery({ queryKey: ['teamGames', team], queryFn: () => window.api.stats.teamGames(team), staleTime: 10 * 60e3 });
  const roster = useQuery({ queryKey: ['roster', team], queryFn: () => window.api.stats.teamRoster(team), staleTime: 10 * 60e3 });
  if (games.isLoading || roster.isLoading) return <Loading label={`Cargando ${team}…`} />;
  if (games.error || roster.error) return <ErrorBox error={games.error || roster.error} />;
  const list = games.data ?? [], players = roster.data ?? [];
  if (!list.length && !players.length) return <Empty>No encuentro "{team}" en Leaguepedia. Prueba a escribirlo en el buscador y elige una de las sugerencias.</Empty>;

  const won = (g: TeamGame) => (g.winner === '1' && g.team1 === team) || (g.winner === '2' && g.team2 === team);
  const wins = list.filter(won).length;
  let streak = 0;
  for (const g of list) { if (won(g) !== won(list[0])) break; streak++; }
  const form = list.slice(0, 10);
  const rank = (r: string) => { const i = ROLES.indexOf(r); return i < 0 ? 99 : i; };

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold">{team}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Victorias (mapas)" value={pct(wins / (list.length || 1))} sub={`${wins}V - ${list.length - wins}D`} valueClass={wins / (list.length || 1) >= .5 ? 'text-emerald-400' : 'text-rose-400'} />
        <Stat label="Racha actual" value={list.length ? `${streak}${won(list[0]) ? 'V' : 'D'}` : '–'} valueClass={list.length && won(list[0]) ? 'text-emerald-400' : 'text-rose-400'} />
        <div className="col-span-2 rounded-xl border border-zinc-800 bg-surface p-4">
          <div className="text-xs font-medium text-zinc-400">Forma (últimos 10 mapas)</div>
          <div className="mt-2.5 flex gap-1.5">
            {form.map((g, i) => <div key={i} title={`${g.team1} vs ${g.team2}`} className={cn('grid h-7 w-7 place-items-center rounded-md text-xs font-bold', won(g) ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300')}>{won(g) ? 'V' : 'D'}</div>)}
          </div>
        </div>
      </div>
      {!!players.length && (
        <Card title="Plantilla">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[...players].sort((a, b) => rank(a.role) - rank(b.role)).map(p => (
              <button key={p.page || p.id} onClick={() => onPlayer(p.page || p.id)}
                className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left transition hover:border-amber-500/50">
                <div className="text-[11px] text-zinc-500">{p.role || '—'}</div>
                <div className="font-semibold">{p.id}</div>
              </button>
            ))}
          </div>
        </Card>
      )}
      <Card title="Resultados recientes (por mapa)" className="overflow-hidden">
        <div className="-m-5">
          <table className="w-full">
            <thead className="bg-zinc-900/60"><tr>
              <th className={th}>Fecha</th><th className={th}>Torneo</th><th className={th}>Rival</th><th className={th + ' text-right'}>Kills</th><th className={th + ' text-right'}>Duración</th><th className={th}></th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-800/70">
              {list.map((g, i) => {
                const home = g.team1 === team, rival = home ? g.team2 : g.team1;
                return (
                  <tr key={i} className="hover:bg-zinc-900/40">
                    <td className={td + ' text-zinc-400'}>{fmtDate(utc(g.date))}</td>
                    <td className={td + ' max-w-64 truncate'} title={g.tournament}>{g.tournament}</td>
                    <td className={td}><button className="cursor-pointer font-medium hover:text-amber-400" onClick={() => onTeam(rival)}>{rival}</button></td>
                    <td className={td + ' text-right tabular-nums'}>{home ? g.k1 : g.k2} - {home ? g.k2 : g.k1}</td>
                    <td className={td + ' text-right tabular-nums text-zinc-400'}>{g.length}</td>
                    <td className={td}><Badge tone={won(g) ? 'success' : 'danger'}>{won(g) ? 'V' : 'D'}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
