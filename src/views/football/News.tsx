// Noticias de los dos equipos en la ficha del partido de fútbol (server/services/football/news.js): ESPN, Mundo Deportivo,
// BBC Sport y The Guardian, lo más nuevo primero. Las que hablan de bajas, dudas o sanciones salen marcadas y se pueden
// dejar solas: son las que pueden mover el partido antes de que lo haga la cuota.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/format';
import { ageOf } from '@/lib/slip-live';
import type { FootballMatch, FootballNews } from '@/lib/types';
import { Badge, Empty, ErrorBox, Loading, TeamLogo, chip } from '@/components/ui';
import { Panel } from '@/components/viz';

const TAG: Record<string, { label: string; tone: 'danger' | 'warning' | 'success' | 'info' | 'neutral' }> = {
  baja: { label: 'Baja', tone: 'danger' }, duda: { label: 'Duda', tone: 'warning' }, sancion: { label: 'Sanción', tone: 'danger' },
  vuelve: { label: 'Vuelve', tone: 'success' }, rotacion: { label: 'Rotación', tone: 'warning' }, alineacion: { label: 'Alineación', tone: 'info' },
  entrenador: { label: 'Entrenador', tone: 'info' }
};
// Las que pueden cambiar quién juega
const KEY = new Set(['baja', 'duda', 'sancion', 'vuelve', 'rotacion', 'alineacion']);

function NewsRow({ n, m }: { n: FootballNews; m: FootballMatch }) {
  const teams = [m.home, m.away].filter(t => n.teams.includes(String(t.id)));
  const fresh = Date.now() - +new Date(n.published) < 3 * 3600e3;
  return (
    <a href={n.url} target="_blank" rel="noopener noreferrer nofollow"
      className="group flex gap-3 border-b border-zinc-800/70 px-4 py-3 last:border-0 hover:bg-zinc-900/60">
      <div className="flex shrink-0 flex-col gap-1 pt-0.5">
        {teams.map(t => <TeamLogo key={t.id} src={t.logo} name={t.name} size={20} />)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {fresh && <Badge tone="live">Nueva</Badge>}
          {n.tags.map(t => TAG[t] && <Badge key={t} tone={TAG[t].tone}>{TAG[t].label}</Badge>)}
        </div>
        <div className="text-[14px] font-medium leading-snug text-zinc-100 group-hover:underline">{n.title}</div>
        {n.summary && <div className="line-clamp-2 text-[13px] text-zinc-400">{n.summary}</div>}
        {!!n.players.length && <div className="text-xs text-zinc-500">{n.players.join(', ')}</div>}
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span>{n.source}</span><span>·</span><span title={new Date(n.published).toLocaleString('es-ES')}>{ageOf(+new Date(n.published))}</span>
          <ExternalLink size={12} className="ml-0.5 opacity-60" />
        </div>
      </div>
    </a>
  );
}

export function MatchNews({ m }: { m: FootballMatch }) {
  const teams = [m.home.id, m.away.id].map(String);
  const [only, setOnly] = useState(false);
  const q = useQuery({ queryKey: ['football', 'news', ...teams], queryFn: () => window.api.football.news(teams), staleTime: 2 * 60e3, refetchInterval: 5 * 60e3 });
  if (q.isLoading) return <Loading label="Buscando noticias…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const all = q.data ?? [];
  const key = all.filter(n => n.tags.some(t => KEY.has(t)));
  const list = only ? key : all;
  return (
    <Panel title="Noticias de los dos equipos" aside={
      <button type="button" onClick={() => setOnly(!only)} className={cn(chip(only), 'text-xs')} aria-pressed={only}>
        Bajas y alineaciones{key.length ? ` (${key.length})` : ''}
      </button>
    }>
      {!list.length
        ? <Empty>{only ? 'Ninguna noticia de bajas, dudas ni alineaciones.' : 'Todavía no hay noticias de estos equipos.'} Se leen cada pocos minutos de ESPN, Mundo Deportivo, BBC Sport y The Guardian.</Empty>
        : list.map(n => <NewsRow key={n.id} n={n} m={m} />)}
      <div className="border-t border-zinc-800/70 px-4 py-2 text-[11px] text-zinc-600">
        Las etiquetas salen de las palabras del titular: léela antes de apostar. Sharpex no escribe estas noticias; el enlace lleva a su fuente.
      </div>
    </Panel>
  );
}
