// Estadísticas del partido de fútbol, una barra por dato.





import type { FootballDetail } from '@/lib/types';
import { themeOf } from '@/components/football';
import { Empty } from '@/components/ui';
import { Panel, TvRow } from '@/components/viz';




// Estadísticas del partido, una barra por dato hacia quien va por delante
const STATS: { key: string; label: string; fmt?: (v: number) => string; better?: 'low'; spread: number }[] = [
  { key: 'possessionPct', label: 'Posesión', fmt: v => `${Math.round(v)} %`, spread: 30 },
  { key: 'totalShots', label: 'Tiros', spread: 10 },
  { key: 'shotsOnTarget', label: 'Tiros a puerta', spread: 5 },
  { key: 'wonCorners', label: 'Córners', spread: 6 },
  { key: 'saves', label: 'Paradas', spread: 4 },
  { key: 'totalPasses', label: 'Pases', spread: 250 },
  { key: 'passPct', label: 'Acierto en el pase', fmt: v => `${Math.round(v * 100)} %`, spread: 0.15 },
  { key: 'totalCrosses', label: 'Centros', spread: 10 },
  { key: 'offsides', label: 'Fueras de juego', better: 'low', spread: 4 },
  { key: 'foulsCommitted', label: 'Faltas', better: 'low', spread: 8 },
  { key: 'yellowCards', label: 'Amarillas', better: 'low', spread: 3 },
  { key: 'redCards', label: 'Rojas', better: 'low', spread: 1 },
  { key: 'interceptions', label: 'Intercepciones', spread: 8 },
  { key: 'totalTackles', label: 'Entradas', spread: 10 }
];

export function Stats({ d }: { d: FootballDetail }) {
  const { match: m } = d;
  const a = d.stats[m.home.id], b = d.stats[m.away.id];
  if (!a || !b || !Object.keys(a).length) return <Empty>{m.state === 'pre' ? 'Las estadísticas salen cuando empieza el partido.' : 'ESPN no tiene estadísticas de este partido.'}</Empty>;
  const marks = { aMark: themeOf(m.home)?.mark, bMark: themeOf(m.away)?.mark };
  return (
    <Panel title={<span className="flex items-center justify-between gap-3"><span className="truncate">{m.home.name}</span><span className="truncate text-right">{m.away.name}</span></span>}>
      <div className="pb-1.5">
        {STATS.filter(s => a[s.key] != null && b[s.key] != null).map(s => (
          <TvRow key={s.key} label={s.label} a={a[s.key]!} b={b[s.key]!} aText={s.fmt ? s.fmt(a[s.key]!) : String(a[s.key])} bText={s.fmt ? s.fmt(b[s.key]!) : String(b[s.key])}
            better={s.better} spread={s.spread} {...marks} />
        ))}
      </div>
    </Panel>
  );
}
