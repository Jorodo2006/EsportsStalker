// Noticias de los dos equipos en la ficha del partido (fútbol y baloncesto; server/shared/news.js), lo más nuevo primero. Las
// que hablan de bajas, dudas o sanciones salen marcadas y se pueden dejar solas: son las que pueden mover el partido antes de
// que lo haga la cuota. useTeamNews es la misma consulta que usan las recomendaciones (NewsHint)
import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ExternalLink, Newspaper } from 'lucide-react';
import { cn } from '@/lib/format';
import { KEY_TAGS, NEWS_PENALTY, NEWS_TAG, PLAYER_STATUS, newsRisk, type KeyNews } from '@/lib/news';
import { ageOf } from '@/lib/slip-live';
import type { NewsBasis, NewsItem, PlayerNewsStatus } from '@/lib/types';
import { Badge, Empty, ErrorBox, Loading, TeamLogo, chip } from './ui';
import { Panel } from './viz';

export type NewsSport = 'football' | 'basket';
export interface NewsTeam { key: string; name: string; logo?: string }

const SOURCES: Record<NewsSport, string> = {
  football: 'ESPN, Mundo Deportivo, BBC Sport y The Guardian',
  basket: 'ESPN, Mundo Deportivo, The Guardian y Gigantes del Basket'
};

// Las de unos equipos (los de un partido o los de un día). Se renuevan cada 5 min, como se leen en el servidor. El servidor
// admite 40 equipos por petición: los de un sábado de fútbol van en varias
export function useTeamNews(sport: NewsSport, keys: string[], enabled = true) {
  const sorted = [...new Set(keys)].sort();
  const chunks: string[][] = [];
  for (let i = 0; i < sorted.length; i += 40) chunks.push(sorted.slice(i, i + 40));
  return useQueries({
    queries: chunks.map(c => ({
      queryKey: ['news', sport, ...c], enabled, staleTime: 2 * 60e3, refetchInterval: 5 * 60e3,
      queryFn: () => (sport === 'football' ? window.api.football.news(c) : window.api.basket.news(c))
    })),
    combine: rs => ({
      data: rs.length && rs.every(r => r.data) ? rs.flatMap(r => r.data!) : rs.some(r => r.data) ? rs.flatMap(r => r.data ?? []) : undefined,
      isLoading: rs.some(r => r.isLoading), error: rs.find(r => r.error)?.error ?? null
    })
  });
}

function NewsRow({ n, teams }: { n: NewsItem; teams: NewsTeam[] }) {
  const mine = teams.filter(t => n.teams.includes(t.key));
  const fresh = Date.now() - +new Date(n.published) < 3 * 3600e3;
  return (
    <a href={n.url} target="_blank" rel="noopener noreferrer nofollow"
      className="group flex gap-3 border-b border-zinc-800/70 px-4 py-3 last:border-0 hover:bg-zinc-900/60">
      <div className="flex shrink-0 flex-col gap-1 pt-0.5">
        {mine.map(t => <TeamLogo key={t.key} src={t.logo} name={t.name} size={20} />)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {fresh && <Badge tone="live">Nueva</Badge>}
          {n.tags.map(t => NEWS_TAG[t] && <Badge key={t} tone={NEWS_TAG[t].tone}>{NEWS_TAG[t].label}</Badge>)}
        </div>
        <div className="text-[14px] font-medium leading-snug text-zinc-100 group-hover:underline">{n.title}</div>
        {n.summary && <div className="line-clamp-2 text-[13px] text-zinc-400">{n.summary}</div>}
        {!!n.outs?.length && <div className="flex flex-wrap gap-1.5">{n.outs.map(o => <Badge key={o.name} tone={PLAYER_STATUS[o.status].tone}>{o.name}: {PLAYER_STATUS[o.status].label}</Badge>)}</div>}
        {!!n.players.length && !n.outs?.length && <div className="text-xs text-zinc-500">{n.players.join(', ')}</div>}
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span>{n.source}</span><span>·</span><span title={new Date(n.published).toLocaleString('es-ES')}>{ageOf(+new Date(n.published))}</span>
          <ExternalLink size={12} className="ml-0.5 opacity-60" />
        </div>
      </div>
    </a>
  );
}

export function MatchNews({ sport, teams }: { sport: NewsSport; teams: NewsTeam[] }) {
  const [only, setOnly] = useState(false);
  const q = useTeamNews(sport, teams.map(t => t.key));
  if (q.isLoading) return <Loading label="Buscando noticias…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const all = q.data ?? [];
  const key = all.filter(n => n.tags.some(t => KEY_TAGS.includes(t)));
  const list = only ? key : all;
  return (
    <Panel title="Noticias de los dos equipos" aside={
      <button type="button" onClick={() => setOnly(!only)} className={cn(chip(only), 'text-xs')} aria-pressed={only}>
        Bajas y alineaciones{key.length ? ` (${key.length})` : ''}
      </button>
    }>
      {!list.length
        ? <Empty>{only ? 'Ninguna noticia de bajas, dudas ni alineaciones.' : 'Todavía no hay noticias de estos equipos.'} Se leen cada pocos minutos de {SOURCES[sport]}.</Empty>
        : list.map(n => <NewsRow key={n.id} n={n} teams={teams} />)}
      <div className="border-t border-zinc-800/70 px-4 py-2 text-[11px] text-zinc-600">
        Las etiquetas salen de las palabras del titular: léela antes de apostar. Sharpex no escribe estas noticias; el enlace lleva a su fuente.
      </div>
    </Panel>
  );
}

// Bajo una recomendación: la noticia que puede cambiarla (la que dice cómo está su jugador, si la hay). «Basada en la noticia»
// cuando la ha cambiado (le ha bajado la fiabilidad, newsRisk); si no, es sólo para leer
export function NewsHint({ k, className }: { k: KeyNews | null; className?: string }) {
  if (!k) return null;
  const based = newsRisk(k);
  const what = k.status && k.name ? `${k.name}: ${PLAYER_STATUS[k.status].label}` : null;
  return (
    <a href={k.top.url} target="_blank" rel="noopener noreferrer nofollow" onClick={e => e.stopPropagation()}
      title={`${k.top.source} · ${new Date(k.top.published).toLocaleString('es-ES')}`}
      className={cn('flex min-w-0 items-start gap-1.5 text-xs hover:underline', based ? 'text-amber-300' : 'text-zinc-400', className)}>
      <Newspaper size={13} className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="font-medium">{based ? 'Basada en la noticia' : k.player ? 'Noticia del jugador' : 'Noticia del equipo'}</span>
        {what ? <> ({what})</> : k.top.tags.length > 0 && <> ({k.top.tags.map(t => NEWS_TAG[t]?.label.toLowerCase()).filter(Boolean).join(', ')})</>}: {k.top.title}
        <span className="text-zinc-500"> · {k.top.source}, {ageOf(+new Date(k.top.published))}{based ? ` · fiabilidad −${NEWS_PENALTY}` : ''}{k.n > 1 ? ` · ${k.n - 1} más en Noticias` : ''}</span>
      </span>
    </a>
  );
}

// Las noticias en las que se basan las recomendaciones de un partido o un día: quién no juega (y qué se ha hecho con eso) y quién
// está en duda. items: [{ name, status, did, news }]
export interface BasisItem { name: string; status: PlayerNewsStatus; did: string; news: NewsBasis }
export function NewsBasisList({ items, className }: { items: BasisItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <div className={cn('flex flex-col gap-1 border-t border-white/10 px-3 py-2', className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300"><Newspaper size={13} />Basadas en estas noticias</div>
      {items.map(b => (
        <a key={`${b.name}|${b.news.url}`} href={b.news.url} target="_blank" rel="noopener noreferrer nofollow"
          className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs hover:underline">
          <Badge tone={PLAYER_STATUS[b.status].tone}>{b.name}: {PLAYER_STATUS[b.status].label}</Badge>
          <span className="text-zinc-300">{b.did}</span>
          <span className="min-w-0 text-zinc-500">{b.news.title} · {b.news.source}, {ageOf(+new Date(b.news.published))}{seenFirst(b.news)}</span>
        </a>
      ))}
    </div>
  );
}
// Cuánto después de publicarse la vio Sharpex (si fue a los pocos minutos, se dice)
const seenFirst = (n: NewsBasis) => {
  const m = Math.round((+new Date(n.seen_at) - +new Date(n.published)) / 60e3);
  return n.seen_at && m >= 0 && m <= 10 ? ` · vista ${m <= 1 ? 'al momento' : `a los ${m} min`}` : '';
};
