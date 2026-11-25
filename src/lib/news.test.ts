import { describe, expect, it } from 'vitest';
import { keyNews, withNews, NEWS_PENALTY } from './news';
import type { NewsItem } from './types';
import type { Reliability } from './value';

const now = Date.parse('2026-11-25T12:00:00Z');
const item = (title: string, teams: string[], tags: string[], hoursAgo: number, players: string[] = []): NewsItem => ({
  id: title, source: 'ESPN', url: `https://x/${title.length}`, title, summary: '', published: new Date(now - hoursAgo * 3600e3).toISOString(),
  seen_at: '', teams, players, tags
});
const rel: Reliability = { score: 75, label: 'Alta', factors: [], warnings: [] };

describe('keyNews', () => {
  const list = [
    item('Pistons: Cade Cunningham, duda', ['nba:8'], ['duda'], 2),
    item('Jalen Duren, baja una semana', ['nba:8'], ['baja'], 5, ['Jalen Duren']),
    item('Old injury news', ['nba:8'], ['baja'], 60),
    item('Pistons sign partnership', ['nba:8'], [], 1)
  ];
  it('las de bajas y dudas de las últimas 48 h, primero la del jugador', () => {
    const k = keyNews(list, ['nba:8'], 'Jalen Duren', now)!;
    expect([k.n, k.player, k.top.title]).toEqual([2, true, 'Jalen Duren, baja una semana']);
  });
  it('sin jugador, la más nueva; de otro equipo, nada', () => {
    expect(keyNews(list, ['nba:8'], '', now)!.top.title).toBe('Pistons: Cade Cunningham, duda');
    expect(keyNews(list, ['nba:9'], '', now)).toBeNull();
  });
  it('encuentra al jugador por el apellido', () => {
    expect(keyNews([item('Cunningham will miss Friday game', ['nba:8'], ['baja'], 1)], ['nba:8'], 'Cade Cunningham', now)!.player).toBe(true);
  });
});

describe('withNews', () => {
  it('baja la fiabilidad si la noticia de baja o duda nombra al jugador', () => {
    const k = keyNews([item('Lewandowski, duda por lesión', ['83'], ['baja', 'duda'], 3)], ['83'], 'Robert Lewandowski', now);
    const r = withNews(rel, k);
    expect(r.score).toBe(75 - NEWS_PENALTY);
    expect(r.label).toBe('Media');
    expect(r.warnings[0]).toMatch(/^Noticia del jugador \(baja, duda\): Lewandowski/);
  });
  it('no la toca si es del equipo sin nombrarlo, o si el jugador vuelve', () => {
    expect(withNews(rel, keyNews([item('Barça: Koundé, duda', ['83'], ['duda'], 3)], ['83'], 'Robert Lewandowski', now))).toBe(rel);
    expect(withNews(rel, keyNews([item('Lewandowski vuelve a entrenar', ['83'], ['vuelve'], 3)], ['83'], 'Robert Lewandowski', now))).toBe(rel);
    expect(withNews(rel, null)).toBe(rel);
    // «to begin rehab assignment… to return from injury»: baja y vuelve a la vez
    expect(withNews(rel, keyNews([item('Jalen Duren to return from injury', ['nba:8'], ['baja', 'vuelve'], 3, ['Jalen Duren'])], ['nba:8'], 'Jalen Duren', now))).toBe(rel);
  });
});
