// Ficha de un tenista: cabecera con lo esencial y dos pestañas, estadísticas de juego y últimos resultados (ESPN)
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { pct } from '@/lib/format';
import type { TennisResult, Tour } from '@/lib/types';
import { TennisStatsPanel } from './TennisStats';
import { Empty, ErrorBox, Loading, th } from './ui';
import { FormChips, TvFrame, TvHeader, TvStat, TvTabs, tdc } from './viz';

const esDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
// ESPN da los premios en dólares
const prize = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.', ',')} M$` : v >= 1e3 ? `${Math.round(v / 1e3)} mil $` : `${v} $`);

function streakOf(list: TennisResult[]) {
  let n = 0;
  for (const m of list) { if (m.win !== list[0].win) break; n++; }
  return n;
}

export function TennisPlayerSheet({ tour, id, onBack, onPlayer, backLabel = 'Rankings' }: {
  tour: Tour; id: string; onBack: () => void; onPlayer: (id: string) => void; backLabel?: string;
}) {
  const { data: p, error, isLoading } = useQuery({
    queryKey: ['tennis', 'profile', tour, id], queryFn: () => window.api.tennis.profile(tour, id), staleTime: 30 * 60e3, retry: false
  });
  const [tab, setTab] = useState<'stats' | 'results'>('stats');
  const streak = useMemo(() => (p?.matches.length ? streakOf(p.matches) : 0), [p]);
  const back = <button onClick={onBack} className="flex w-fit cursor-pointer items-center gap-1.5 text-[13px] text-zinc-400 transition hover:text-zinc-100"><ArrowLeft size={15} />{backLabel}</button>;
  if (isLoading) return <div className="mx-auto flex max-w-6xl flex-col gap-3">{back}<Loading label="Cargando la ficha…" /></div>;
  if (error || !p) return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">{back}
      {/No handler registered|is not a function/.test(String(error))
        ? <ErrorBox error="La app tiene que reiniciarse para ver las fichas">Para <code>npm run dev</code> (Ctrl+C) y vuelve a lanzarlo.</ErrorBox>
        : <ErrorBox error={error ?? 'Sin datos de este jugador'} />}
    </div>
  );
  const diff = p.previous && p.rank ? p.previous - p.rank : 0;
  const season = p.season && p.season.won + p.season.lost ? p.season : p.lastSeason;
  const seasonYear = season === p.season ? p.year : p.year - 1;
  const rate = (r: { won: number; lost: number }) => (r.won + r.lost ? pct(r.won / (r.won + r.lost)) : '');
  const meta = [p.tour.toUpperCase(), p.country, p.age ? `${p.age} años` : '', p.height, p.weight, p.hand, p.birthPlace, p.debut ? `Pro desde ${p.debut}` : '', !p.active ? 'Retirado' : ''].filter(Boolean);
  const last = p.matches.slice(0, 10);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-2.5">
      {back}
      <TvFrame>
        <TvHeader
          media={<><img src={p.photo || undefined} alt="" className="h-12 w-12 shrink-0 rounded-full bg-black/30 object-cover object-top md:hidden" onError={e => { e.currentTarget.style.display = 'none'; }} />{p.flag && <img src={p.flag} alt="" className="h-5 w-8 shrink-0 object-cover" />}</>}
          title={p.name} sub={<span title={meta.join(' · ')}>{meta.join(' · ')}</span>}>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <TvStat label="Ranking" value={p.rank ? `#${p.rank}` : '–'} sub={<>{p.points ? `${p.points.toLocaleString('es-ES')} pts` : ''}{!!diff && <span className="ml-1">{diff > 0 ? `▲${diff}` : `▼${-diff}`}</span>}</>} />
            {season && <TvStat label={`Temporada ${seasonYear}`} value={`${season.won}-${season.lost}`} sub={rate(season)} title="Balance según ESPN" />}
            {season && <TvStat label={`Títulos ${seasonYear}`} value={season.titles} sub={season.prize ? prize(season.prize) : ''} />}
            {p.career && <TvStat label="Carrera" value={`${p.career.won}-${p.career.lost}`} sub={rate(p.career)} title="Balance según ESPN" />}
            {p.career && <TvStat label="Títulos" value={p.career.titles} sub={p.career.prize ? prize(p.career.prize) : ''} />}
          </div>
        </TvHeader>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
          <TvTabs value={tab} onChange={setTab} items={[{ value: 'stats', label: 'Estadísticas' }, { value: 'results', label: `Resultados (${p.matches.length})` }]} />
          {!!last.length && (
            <div className="flex items-center gap-2" title="Últimos 10 partidos, del más reciente al más antiguo">
              <span className="font-score text-[12px] font-semibold uppercase tracking-wider text-zinc-300">Racha: {streak} {p.matches[0].win ? (streak === 1 ? 'ganado' : 'ganados') : (streak === 1 ? 'perdido' : 'perdidos')}</span>
              <FormChips list={last.map(m => ({ win: m.win, title: `${m.win ? 'Ganó a' : 'Perdió con'} ${m.opponent.name}: ${m.score}` }))} />
            </div>
          )}
        </div>

      {tab === 'stats' ? <TennisStatsPanel tour={tour} id={id} name={p.name} photo={p.photo} credit={p.photoFrom} /> : !p.matches.length ? <div className="p-3"><Empty>Sin partidos individuales recientes en ESPN.</Empty></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-zinc-900/60"><tr><th className={th + ' w-9'} /><th className={th}>Fecha</th><th className={th}>Torneo</th><th className={th}>Ronda</th><th className={th}>Rival</th><th className={th + ' text-right'}>Resultado</th></tr></thead>
            <tbody className="divide-y divide-zinc-800/50">
              {p.matches.map(m => (
                <tr key={m.id} className="hover:bg-zinc-800/30">
                  <td className={tdc}><FormChips list={[{ win: m.win }]} /></td>
                  <td className={tdc + ' whitespace-nowrap text-zinc-500 tnum'}>{esDate(m.date)}</td>
                  <td className={tdc + ' max-w-64 truncate'} title={m.tournament}>{m.tournament}</td>
                  <td className={tdc + ' whitespace-nowrap text-zinc-500'}>{m.round}</td>
                  <td className={tdc}>
                    <button onClick={() => onPlayer(m.opponent.id)} title="Ver su ficha" className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-left font-medium hover:text-amber-400">
                      {m.opponent.flag && <img src={m.opponent.flag} alt="" className="h-3 w-4 rounded-[2px] object-cover" />}{m.opponent.name}
                      {m.opponent.rank && <span className="text-[11px] font-normal text-zinc-500">#{m.opponent.rank}</span>}
                    </button>
                  </td>
                  <td className={tdc + ' whitespace-nowrap text-right tnum'}>{m.score}{m.note && <span className="ml-1.5 text-[11px] text-zinc-500">{m.note}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </TvFrame>
    </div>
  );
}
