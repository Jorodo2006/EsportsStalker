// Noticias de los equipos (server/shared/news.js): lo que se enseña en la ficha del partido y junto a las recomendaciones.
// keyNews sigue la misma regla que la de server/shared/news.js; además mira cómo está el jugador según la noticia (outs)
import type { NewsItem, PlayerNewsStatus } from './types';
import type { Reliability } from './value';

export const NEWS_TAG: Record<string, { label: string; tone: 'danger' | 'warning' | 'success' | 'info' | 'neutral' }> = {
  baja: { label: 'Baja', tone: 'danger' }, duda: { label: 'Duda', tone: 'warning' }, sancion: { label: 'Sanción', tone: 'danger' },
  vuelve: { label: 'Vuelve', tone: 'success' }, rotacion: { label: 'Rotación', tone: 'warning' }, alineacion: { label: 'Alineación', tone: 'info' },
  entrenador: { label: 'Entrenador', tone: 'info' }
};
// Cómo está un jugador según la noticia (playerStatuses del servidor)
export const PLAYER_STATUS: Record<PlayerNewsStatus, { label: string; tone: 'danger' | 'warning' | 'success' }> = {
  out: { label: 'no juega', tone: 'danger' }, suspended: { label: 'sancionado', tone: 'danger' }, doubt: { label: 'en duda', tone: 'warning' },
  injured: { label: 'lesionado', tone: 'warning' }, back: { label: 'vuelve', tone: 'success' }
};
// Las que pueden cambiar quién juega
export const KEY_TAGS = ['baja', 'duda', 'sancion', 'vuelve', 'rotacion', 'alineacion'];
// Las que hacen dudar de una recomendación: alguien puede no jugar
export const RISK_TAGS = ['baja', 'duda', 'sancion', 'rotacion'];

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// El mismo jugador con el nombre de la plantilla («Robert Lewandowski») y el de la casa («R. Lewandowski»): mismo apellido y, si
// los dos la traen, la misma inicial (samePlayer de server/services/football/picks.js)
export function samePlayer(a: string, b: string) {
  const x = plain(a).replace(/[0-9]/g, '').split(' ').filter(Boolean), y = plain(b).replace(/[0-9]/g, '').split(' ').filter(Boolean);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  if (x.at(-1) !== y.at(-1) || x.at(-1)!.length < 4) return false;
  return x.length === 1 || y.length === 1 || x[0][0] === y[0][0];
}

export interface KeyNews {
  n: number; player: boolean; status?: PlayerNewsStatus; name?: string;
  top: { title: string; source: string; url: string; published: string; tags: string[] };
}
// Las noticias que pueden cambiar quién juega de las últimas 48 h de esos equipos. Primero la que dice cómo está el jugador de la
// recomendación (outs), luego la que lo nombra, y si no, la más nueva del equipo. null si no hay
export function keyNews(list: NewsItem[], keys: string[], player = '', now = Date.now()): KeyNews | null {
  const recent = list.filter(n => n.teams.some(t => keys.includes(t)) && now - +new Date(n.published) < 48 * 3600e3);
  const told = player ? recent.find(n => (n.outs ?? []).some(o => samePlayer(o.name, player))) : undefined;
  const hits = recent.filter(n => n.tags.some(t => KEY_TAGS.includes(t)) || (n.outs ?? []).length);
  if (!told && !hits.length) return null;
  const p = plain(player), last = p.split(' ').filter(w => w.length >= 4).at(-1);
  const names = (n: NewsItem) => ` ${plain(`${n.title} ${n.summary} ${n.players.join(' ')}`)} `;
  const mentions = (n: NewsItem) => !!p && (names(n).includes(` ${p} `) || (!!last && names(n).includes(` ${last} `)));
  const top = told ?? hits.find(mentions) ?? hits[0];
  const o = told ? told.outs.find(x => samePlayer(x.name, player)) : undefined;
  return {
    n: Math.max(hits.length, 1), player: !!told || mentions(top), status: o?.status, name: o?.name,
    top: { title: top.title, source: top.source, url: top.url, published: top.published, tags: top.tags.filter(t => KEY_TAGS.includes(t)) }
  };
}

// La noticia que dice que el jugador de la recomendación no juega, duda, está lesionado o sancionado le baja la fiabilidad del
// cálculo (el modelo da por hecho que juega). Sin estado detectado, una noticia de baja o duda que lo nombra, igual. Es una
// decisión, no una medida (no hay histórico de noticias para medirlo todavía); las del equipo sin nombrarlo sólo se enseñan, que
// la prensa habla de dudas de casi todos los partidos. Si vuelve, nada
export const NEWS_PENALTY = 20;
export const newsRisk = (k: KeyNews | null) => !!k?.player && (k.status
  ? k.status !== 'back'
  : !k.top.tags.includes('vuelve') && k.top.tags.some(t => RISK_TAGS.includes(t)));
export function withNews(rel: Reliability, k: KeyNews | null): Reliability {
  if (!k || !newsRisk(k)) return rel;
  const score = Math.max(0, rel.score - NEWS_PENALTY);
  const label: Reliability['label'] = score >= 70 ? 'Alta' : score >= 50 ? 'Media' : 'Baja';
  const what = k.status ? PLAYER_STATUS[k.status].label : k.top.tags.filter(t => RISK_TAGS.includes(t)).map(t => NEWS_TAG[t].label.toLowerCase()).join(', ');
  return { ...rel, score, label, warnings: [...rel.warnings, `Según la noticia, ${what}: ${k.top.title}`] };
}
