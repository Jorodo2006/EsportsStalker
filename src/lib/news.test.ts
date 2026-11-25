import { describe, expect, it } from 'vitest';
import { keyNews, withNews, NEWS_PENALTY } from './news';
import type { NewsItem } from './types';
import type { Reliability } from './value';

const now = Date.parse('2026-11-25T12:00:00Z');
const item = (title: string, teams: string[], tags: string[], hoursAgo: number, players: string[] = [], outs: NewsItem['outs'] = []): NewsItem => ({
  id: title, source: 'ESPN', url: `https://x/${title.length}`, title, summary: '', published: new Date(now - hoursAgo * 3600e3).toISOString(),
  seen_at: '', teams, players, tags, outs
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
    expect(r.warnings[0]).toMatch(/^Según la noticia, baja, duda: Lewandowski/);
  });
  it('no la toca si es del equipo sin nombrarlo, o si el jugador vuelve', () => {
    expect(withNews(rel, keyNews([item('Barça: Koundé, duda', ['83'], ['duda'], 3)], ['83'], 'Robert Lewandowski', now))).toBe(rel);
    expect(withNews(rel, keyNews([item('Lewandowski vuelve a entrenar', ['83'], ['vuelve'], 3)], ['83'], 'Robert Lewandowski', now))).toBe(rel);
    expect(withNews(rel, null)).toBe(rel);
    // «to begin rehab assignment… to return from injury»: baja y vuelve a la vez
    expect(withNews(rel, keyNews([item('Jalen Duren to return from injury', ['nba:8'], ['baja', 'vuelve'], 3, ['Jalen Duren'])], ['nba:8'], 'Jalen Duren', now))).toBe(rel);
  });
});

describe('lo que dice la noticia del jugador (outs)', () => {
  it('encuentra al jugador de la casa con la inicial y le baja la fiabilidad', () => {
    const n = item('Barça: Lewandowski se pierde el partido', ['83'], ['baja'], 2, [], [{ name: 'Robert Lewandowski', team: '83', status: 'out' }]);
    const k = keyNews([item('Barça: Koundé, duda', ['83'], ['duda'], 1), n], ['83'], 'R. Lewandowski', now)!;
    expect([k.player, k.status, k.name, k.top.title]).toEqual([true, 'out', 'Robert Lewandowski', 'Barça: Lewandowski se pierde el partido']);
    expect(withNews(rel, k).warnings[0]).toMatch(/^Según la noticia, no juega/);
  });
  it('si vuelve, no la toca', () => {
    const n = item('Duren returns', ['nba:8'], ['vuelve'], 2, [], [{ name: 'Jalen Duren', team: 'nba:8', status: 'back' }]);
    expect(withNews(rel, keyNews([n], ['nba:8'], 'Jalen Duren', now))).toBe(rel);
  });
});
