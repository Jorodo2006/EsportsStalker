// Noticias de los equipos (server/shared/news.js): lo que se enseña en la ficha del partido y junto a las recomendaciones.
// keyNews tiene que dar lo mismo que la de server/shared/news.js
import type { NewsItem } from './types';
import type { Reliability } from './value';

export const NEWS_TAG: Record<string, { label: string; tone: 'danger' | 'warning' | 'success' | 'info' | 'neutral' }> = {
  baja: { label: 'Baja', tone: 'danger' }, duda: { label: 'Duda', tone: 'warning' }, sancion: { label: 'Sanción', tone: 'danger' },
  vuelve: { label: 'Vuelve', tone: 'success' }, rotacion: { label: 'Rotación', tone: 'warning' }, alineacion: { label: 'Alineación', tone: 'info' },
  entrenador: { label: 'Entrenador', tone: 'info' }
};
// Las que pueden cambiar quién juega
export const KEY_TAGS = ['baja', 'duda', 'sancion', 'vuelve', 'rotacion', 'alineacion'];
// Las que hacen dudar de una recomendación: alguien puede no jugar
export const RISK_TAGS = ['baja', 'duda', 'sancion', 'rotacion'];

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface KeyNews {
  n: number; player: boolean;
  top: { title: string; source: string; url: string; published: string; tags: string[] };
}
// Las noticias que pueden cambiar quién juega (KEY_TAGS) de las últimas 48 h de esos equipos; si nombran al jugador de la
// recomendación, primero. null si no hay
export function keyNews(list: NewsItem[], keys: string[], player = '', now = Date.now()): KeyNews | null {
  const p = plain(player), last = p.split(' ').filter(w => w.length >= 4).at(-1);
  const names = (n: NewsItem) => ` ${plain(`${n.title} ${n.summary} ${n.players.join(' ')}`)} `;
  const hits = list.filter(n => n.teams.some(t => keys.includes(t)) && n.tags.some(t => KEY_TAGS.includes(t)) && now - +new Date(n.published) < 48 * 3600e3);
  if (!hits.length) return null;
  const mentions = (n: NewsItem) => !!p && (names(n).includes(` ${p} `) || (!!last && names(n).includes(` ${last} `)));
  const own = hits.filter(mentions);
  const top = own[0] ?? hits[0];
  return { n: hits.length, player: own.length > 0, top: { title: top.title, source: top.source, url: top.url, published: top.published, tags: top.tags.filter(t => KEY_TAGS.includes(t)) } };
}

// Una noticia de baja, duda, sanción o rotación que nombra al jugador de la recomendación le baja la fiabilidad del cálculo:
// el modelo da por hecho que juega. Es una decisión, no una medida (no hay histórico de noticias para medirlo todavía); las del
// equipo sin nombrarlo sólo se enseñan, que la prensa habla de dudas de casi todos los partidos
export const NEWS_PENALTY = 20;
export function withNews(rel: Reliability, k: KeyNews | null): Reliability {
  // «Vuelve de su lesión» lleva baja y vuelve: no se sabe hacia dónde va, sólo se enseña
  const risky = k?.player && !k.top.tags.includes('vuelve') ? k.top.tags.filter(t => RISK_TAGS.includes(t)) : [];
  if (!k || !risky.length) return rel;
  const score = Math.max(0, rel.score - NEWS_PENALTY);
  const label: Reliability['label'] = score >= 70 ? 'Alta' : score >= 50 ? 'Media' : 'Baja';
  return { ...rel, score, label, warnings: [...rel.warnings, `Noticia del jugador (${risky.map(t => NEWS_TAG[t].label.toLowerCase()).join(', ')}): ${k.top.title}`] };
}
