// Forma, cara a cara y clasificación en la ficha del partido de fútbol.

import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/format';
import type { FootballDetail, FootballMatch, FootballPastGame } from '@/lib/types';
import { useMatchOdds } from '@/components/BasketOdds';
import { TrendsTable, footballMarkets, footballTrendData } from '@/components/Trends';
import { StandingsTable } from '@/components/football';
import { Empty, ErrorBox, Loading, TeamLogo } from '@/components/ui';
import { Panel } from '@/components/viz';
import { targetOfFootball } from '../FootballMatches';




const RESULT_TONE: Record<string, string> = { G: 'bg-emerald-500/20 text-emerald-300', E: 'bg-zinc-700 text-zinc-200', P: 'bg-rose-500/20 text-rose-300' };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });

function PastRow({ g }: { g: FootballPastGame }) {
  return (
    <div className="flex h-9 items-center gap-3 px-4 text-[13px]">
      <span className="w-16 shrink-0 text-xs text-zinc-500 tnum">{shortDate(g.date)}</span>
      <span className="w-4 shrink-0 text-center text-xs text-zinc-500" title={g.home ? 'En casa' : 'Fuera'}>{g.home ? 'C' : 'F'}</span>
      <TeamLogo src={g.opponent.logo} name={g.opponent.name} size={18} />
      <span className="min-w-0 flex-1 truncate text-zinc-200" title={g.league}>{g.opponent.name}</span>
      <span className="text-zinc-300 tnum">{g.score}</span>
      <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] font-semibold', RESULT_TONE[g.result] || 'bg-zinc-800 text-zinc-400')}>{g.result || '–'}</span>
    </div>
  );
}

// Últimos partidos de cada uno (de cualquier competición) y los enfrentamientos entre ellos
export function Form({ d }: { d: FootballDetail }) {
  const { match: m } = d;
  const tally = (list: FootballPastGame[]) => ['G', 'E', 'P'].map(r => list.filter(g => g.result === r).length).join('-');
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-1 gap-2.5 2xl:grid-cols-2">
        {[m.home, m.away].map(t => {
          const list = d.form[t.id] ?? [];
          return (
            <Panel key={t.id} title={<span className="flex items-center gap-2"><TeamLogo src={t.logo} name={t.abbr} size={18} />{t.name}</span>}
              aside={list.length ? `${tally(list)} en sus últimos ${list.length}` : undefined}>
              {!list.length ? <p className="px-4 py-3 text-[13px] text-zinc-500">ESPN no da sus últimos partidos.</p>
                : <div className="divide-y divide-zinc-800/60">{list.map(g => <PastRow key={g.id || g.date} g={g} />)}</div>}
            </Panel>
          );
        })}
      </div>
      {!!d.h2h.length && (
        <Panel title="Enfrentamientos entre ellos" aside={`Resultados de ${d.h2h[0].team === m.away.id ? m.away.name : m.home.name}`}>
          <div className="divide-y divide-zinc-800/60">{d.h2h.map(g => <PastRow key={g.id || g.date} g={g} />)}</div>
        </Panel>
      )}
    </div>
  );
}

// H2H y "cuántas veces se cumple": los cara a cara de la ficha de ESPN y los últimos 10 de cada uno (todas las competiciones),
// contra las líneas que dan ahora las casas. A = local, B = visitante, como en la ficha
export function FootballTrends({ d }: { d: FootballDetail }) {
  const { match: m } = d;
  const qa = useQuery({ queryKey: ['football', 'teamGames', m.home.id], queryFn: () => window.api.football.teamGames(m.home.id), staleTime: 30 * 60e3, retry: false });
  const qb = useQuery({ queryKey: ['football', 'teamGames', m.away.id], queryFn: () => window.api.football.teamGames(m.away.id), staleTime: 30 * 60e3, retry: false });
  const odds = useMatchOdds(targetOfFootball(m));
  if (qa.isLoading || qb.isLoading) return <Loading label="Cargando los últimos partidos de los dos…" />;
  const { h2h, lastA, lastB } = footballTrendData(m, qa.data, qb.data, d.h2h);
  const date = (s: string) => new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return (
    <TrendsTable A={m.home.name} B={m.away.name} logoA={m.home.logo} logoB={m.away.logo} h2h={h2h} lastA={lastA} lastB={lastB}
      markets={footballMarkets(odds.data, m.home.name, m.away.name)}
      note={!odds.data?.markets.length ? 'Sin cuotas de este partido: la columna de la casa sale vacía.' : undefined}
      list={g => <>
        <span className="w-16 shrink-0 text-xs text-zinc-500 tnum">{date(g.date)}</span>
        <span className="min-w-0 flex-1 truncate font-medium tnum">
          <span className={g.a > g.b ? 'text-zinc-50' : 'text-zinc-400'}>{m.home.name} {g.a}</span> - <span className={g.b > g.a ? 'text-zinc-50' : 'text-zinc-400'}>{g.b} {m.away.name}</span>
        </span>
        <span className="hidden shrink-0 text-xs text-zinc-500 sm:block">{g.vs}</span>
      </>} />
  );
}

export function Table({ m }: { m: FootballMatch }) {
  const q = useQuery({ queryKey: ['football', 'standings', m.league], queryFn: () => window.api.football.standings(m.league), staleTime: 15 * 60e3 });
  if (q.isLoading) return <Loading label="Cargando la clasificación…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data?.length) return <Empty>Esta competición no tiene clasificación.</Empty>;
  return <StandingsTable groups={q.data} mark={[m.home.id, m.away.id]} />;
}
