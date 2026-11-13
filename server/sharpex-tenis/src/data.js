// Carga de resultados históricos y normalización a un formato común.
//
// Formato interno de un partido:
//   { date: 'YYYY-MM-DD', tourney, level, surface, round,
//     winnerId, winnerName, loserId, loserName, score, completed }
//
// Fuentes soportadas:
//   - Ficheros de Jeff Sackmann (tennis_atp): atp_matches_qual_chall_YYYY.csv
//     ¡Licencia CC BY-NC-SA 4.0: NO se puede usar en un producto comercial!
//   - Formato propio de Sharpex (ver README): date,tourney,level,surface,round,winner,loser,score

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv.js';
import { playerKey } from './names.js';

export const SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet'];

// Niveles de Sackmann que entran en los ratings. Se apuesta y se puntúa sólo en Challengers ('C'), pero los partidos
// de ATP (G, M, A, F, O), previas de torneos ATP e ITF ('S' hasta 2020; '15' y '25' desde 2021) dan más historial a
// los mismos jugadores. Medido en los mismos 20.696 Challengers de 2024-2026 (ajuste con 2023): log-loss 0,643 → 0,630,
// acierto 63,0 → 64,5 % y sin el exceso de confianza en los favoritos claros (decía 82 % y ganaban el 77 %).
// Copa Davis ('D') no: se juega en condiciones raras (local, sin ranking).
export const HISTORY_LEVELS = ['C', 'G', 'M', 'A', 'F', 'O', 'S', '15', '25'];
export const BET_LEVELS = ['C'];

// De dónde sale el histórico: copia de los CSV de Jeff Sackmann (CC BY-NC-SA 4.0, no comercial)
export const ARCHIVE = 'https://raw.githubusercontent.com/roblotlot/tennis-sackmann-archive/main/atp';
export const ARCHIVE_FILES = (year) => [
  `atp_matches_qual_chall_${year}.csv`, // Challengers y previas de torneos ATP
  `atp_matches_${year}.csv`, // cuadro final de ATP
  `atp_matches_futures_${year}.csv`, // ITF
];

// Lo que falta en el archivo (acaba el 1-6-2026) sale de TennisMyLife, que se actualiza cada semana: Challengers (sólo el
// cuadro final, sin previas) y ATP; ITF no. Sus condiciones: uso personal y no comercial, sin redistribuir los CSV.
export const TML = 'https://stats.tennismylife.org/data';
export const TML_FROM = 2026; // primer año que el archivo no tiene entero
export const TML_FILES = (year) => [`${year}_challenger.csv`, `${year}.csv`];
// TennisMyLife separa los ATP 250 y 500; en Sackmann son los dos 'A'
const TML_LEVELS = { 250: 'A', 500: 'A' };

// ---------- Superficie de un torneo por su ciudad ----------
// LiveScore y Winamax no dicen la superficie, y los nombres no coinciden entre fuentes ("Lima, Peru" en LiveScore,
// "Lima 2 CH" en Sackmann, "Kia Open Cali" en TennisMyLife). Lo que se repite es la ciudad, y una ciudad suele mantener
// la superficie de su Challenger de un año para otro.
const VENUE_NOISE = /\b(ch|challenger|atp|open|tour|cup|trophy|international|men'?s|pro|the|de|del|la|el|di|du|an|grand prix)\b/g;
export function venueKey(name) {
  return String(name ?? '')
    .split(',')[0] // "Lima, Peru" → "Lima"
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(19|20)\d\d\b/g, ' ').replace(/\b\d+\b/g, ' ') // años y "Brisbane 3"
    .replace(VENUE_NOISE, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** De los Challengers del histórico: ciudad → { surface, date } del último que se jugó allí. */
export function venueSurfaces(matches) {
  const out = {};
  for (const m of matches) {
    if (m.level !== 'C') continue;
    const k = venueKey(m.tourney);
    if (k && (!out[k] || out[k].date <= m.date)) out[k] = { surface: m.surface, date: m.date };
  }
  return out;
}

/**
 * Superficie del torneo `name` según venueSurfaces: primero la ciudad exacta y si no, un torneo cuyo nombre la contenga
 * entera ("Kia Open Cali" para "Cali"), el más reciente. Devuelve { surface, known } (si no se sabe, pista dura).
 */
export function surfaceOf(venues, name) {
  const k = venueKey(name);
  if (k && venues?.[k]) return { surface: venues[k].surface, known: true };
  if (k) {
    const re = new RegExp(`(^| )${k}( |$)`);
    const hit = Object.entries(venues ?? {}).filter(([v]) => re.test(v)).sort((x, y) => y[1].date.localeCompare(x[1].date))[0];
    if (hit) return { surface: hit[1].surface, known: true };
  }
  return { surface: 'Hard', known: false };
}

export function normalizeSurface(s) {
  const v = String(s ?? '').trim().toLowerCase();
  if (v.startsWith('hard') || v === 'dura' || v === 'pista dura' || v === 'h') return 'Hard';
  if (v.startsWith('clay') || v === 'tierra' || v === 'tierra batida' || v === 'arcilla' || v === 'c') return 'Clay';
  if (v.startsWith('grass') || v === 'hierba' || v === 'cesped' || v === 'césped' || v === 'g') return 'Grass';
  if (v.startsWith('carpet') || v === 'moqueta') return 'Carpet';
  return 'Hard'; // Por defecto: la mayoría de Challengers indoor/outdoor son pista dura.
}

function isCompleted(score) {
  const s = String(score ?? '').toUpperCase();
  if (!s) return false;
  if (s.includes('W/O') || s.includes('WALKOVER') || s.includes('DEF')) return false;
  return true; // Las retiradas (RET) cuentan: se jugó parte del partido.
}

function sackmannDate(d) {
  const s = String(d);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * Guarda cada texto una sola vez, copiado. Cada partido repite nombres, torneos, rondas y fechas, y en V8 un trozo
 * cortado de un CSV mantiene vivo el fichero entero: con los 324.000 partidos del histórico, entrenar pasaba de 700 MB.
 */
export function interner() {
  const pool = new Map();
  return (s) => {
    if (typeof s !== 'string') return s;
    let v = pool.get(s);
    if (v === undefined) {
      v = JSON.parse(JSON.stringify(s)); // copia propia, sin el fichero detrás
      pool.set(v, v);
    }
    return v;
  };
}
const same = (s) => s;

/**
 * Convierte una fila de Sackmann (o de TennisMyLife, mismo formato: source 'tml') al formato interno.
 * Devuelve null si no sirve. El marcador no se guarda: sólo sirve para saber si el partido se jugó.
 */
export function fromSackmann(r, { levels = ['C'], source = 'sk', intern = same } = {}) {
  const level = TML_LEVELS[r.tourney_level] ?? r.tourney_level;
  if (levels && !levels.includes(level)) return null;
  if (!r.winner_name || !r.loser_name || !r.tourney_date) return null;
  const s = intern;
  return {
    date: s(sackmannDate(r.tourney_date)),
    tourney: s(r.tourney_name),
    level: s(level),
    surface: normalizeSurface(r.surface),
    round: s(r.round),
    order: Number(r.match_num) || 0,
    source,
    tourneyId: s(r.tourney_id ?? ''),
    winnerId: s(r.winner_id ? `${source}:${r.winner_id}` : playerKey(r.winner_name)),
    winnerName: s(r.winner_name),
    winnerIoc: s(r.winner_ioc ?? ''),
    loserId: s(r.loser_id ? `${source}:${r.loser_id}` : playerKey(r.loser_name)),
    loserName: s(r.loser_name),
    loserIoc: s(r.loser_ioc ?? ''),
    completed: isCompleted(r.score),
  };
}

const DAY = 86400000;
const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };

/**
 * Junta Sackmann y TennisMyLife. TennisMyLife usa los identificadores de la ATP y Sackmann los suyos, así que cada
 * jugador de TennisMyLife se empareja con el de Sackmann:
 *  1. Por los partidos que están en las dos (enero a junio de 2026): mismo torneo y ronda, y uno de los dos con el mismo
 *     nombre. Nadie juega dos partidos en una ronda, así que el rival también es el mismo, aunque su nombre esté escrito
 *     distinto ("Sanhui Shin" / "San Hui Shin").
 *  2. Si no, por nombre y país (o sólo nombre). Sackmann tiene a veces dos identificadores para el mismo nombre: vale el
 *     que ha jugado más tarde, salvo que el otro también juegue (entonces son dos personas y no se sabe cuál es).
 *  3. Si no, entra como jugador nuevo, que es lo seguro.
 * Los partidos que están en las dos se cuentan una vez (el de Sackmann). Las fechas del torneo no coinciden siempre
 * (hasta 13 días en el mismo partido de un Masters), así que es el mismo si coinciden ronda y jugadores, y además el
 * torneo o la fecha con 14 días de margen. Devuelve los partidos y cuántos jugadores se han emparejado.
 */
export function mergeSources(matches) {
  const tml = matches.filter((m) => m.source === 'tml');
  if (!tml.length) return { matches, linked: 0, unlinked: 0 };
  const sk = matches.filter((m) => m.source === 'sk');
  const sides = (m) => [[m.winnerId, m.winnerName, m.winnerIoc], [m.loserId, m.loserName, m.loserIoc]];

  // 1. Partidos compartidos
  const byEvent = new Map();
  for (const m of sk) if (m.tourneyId) push(byEvent, `${m.tourneyId}|${m.round}`, m);
  const votes = new Map(); // id de TennisMyLife → { id de Sackmann: votos }
  const vote = (from, to) => { const v = votes.get(from) ?? {}; v[to] = (v[to] ?? 0) + 1; votes.set(from, v); };
  for (const m of tml) {
    if (m.round === 'RR') continue; // en un round robin se juega más de un partido por ronda
    const same = (byEvent.get(`${m.tourneyId}|${m.round}`) ?? []).find((s) =>
      playerKey(s.winnerName) === playerKey(m.winnerName) || playerKey(s.loserName) === playerKey(m.loserName));
    if (same) { vote(m.winnerId, same.winnerId); vote(m.loserId, same.loserId); }
  }
  const byMatches = (id) => {
    const v = Object.entries(votes.get(id) ?? {}).sort((a, b) => b[1] - a[1]);
    return v.length ? v[0][0] : null;
  };

  // 2. Nombre (y país): de cada id de Sackmann, su último partido
  const known = new Map();
  for (const m of sk) {
    for (const [id, name, ioc] of sides(m)) {
      for (const k of [`${playerKey(name)}|${ioc}`, playerKey(name)]) {
        if (!known.has(k)) known.set(k, new Map());
        const c = known.get(k);
        if ((c.get(id) ?? '') < m.date) c.set(id, m.date);
      }
    }
  }
  const byName = (k) => {
    const [a, b] = [...(known.get(k) ?? [])].sort((x, y) => y[1].localeCompare(x[1]));
    if (!a) return null;
    return b && Date.parse(a[1]) - Date.parse(b[1]) < 365 * DAY ? null : a[0];
  };

  const map = new Map();
  const resolve = (id, name, ioc) => {
    if (!map.has(id)) map.set(id, byMatches(id) ?? byName(`${playerKey(name)}|${ioc}`) ?? byName(playerKey(name)) ?? id);
    return map.get(id);
  };
  for (const m of tml) {
    m.winnerId = resolve(m.winnerId, m.winnerName, m.winnerIoc);
    m.loserId = resolve(m.loserId, m.loserName, m.loserIoc);
  }

  // 3. Duplicados: sólo se buscan para los de TennisMyLife; en Sackmann dos partidos iguales son dos partidos
  const counted = new Map();
  const keyOf = (m) => `${m.round}|${[m.winnerId, m.loserId].sort().join('|')}`;
  for (const m of sk) push(counted, keyOf(m), m);
  const out = matches.filter((m) => m.source !== 'tml');
  for (const m of tml) {
    const k = keyOf(m);
    const dup = (counted.get(k) ?? []).some((x) =>
      (m.tourneyId && x.tourneyId === m.tourneyId) || Math.abs(Date.parse(x.date) - Date.parse(m.date)) <= 14 * DAY);
    if (dup) continue;
    push(counted, k, m);
    out.push(m);
  }
  const linked = [...map].filter(([a, b]) => a !== b).length;
  return { matches: out, linked, unlinked: map.size - linked };
}

/** Convierte una fila del formato propio de Sharpex. */
export function fromSharpex(r) {
  if (!r.winner || !r.loser || !r.date) return null;
  return {
    date: r.date,
    tourney: r.tourney ?? '',
    level: r.level || 'C',
    surface: normalizeSurface(r.surface),
    round: r.round ?? '',
    order: Number(r.order) || 0,
    winnerId: playerKey(r.winner),
    winnerName: r.winner,
    loserId: playerKey(r.loser),
    loserName: r.loser,
    score: r.score ?? '',
    completed: isCompleted(r.score || 'x'),
  };
}

const ROUND_ORDER = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, R128: 5, R64: 6, R32: 7, R16: 8, QF: 9, SF: 10, F: 11, RR: 6, BR: 10 };

/** Ordena cronológicamente: fecha del torneo y, dentro del torneo, por ronda. */
export function sortMatches(matches) {
  return matches.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.tourney.localeCompare(b.tourney) ||
    (ROUND_ORDER[a.round] ?? 0) - (ROUND_ORDER[b.round] ?? 0) ||
    a.order - b.order);
}

/** Lee un fichero o una carpeta de CSV y detecta el formato por las cabeceras. */
export function loadMatches(path, { levels = ['C'] } = {}) {
  const files = statSync(path).isDirectory()
    ? readdirSync(path).filter((f) => f.endsWith('.csv')).sort().map((f) => join(path, f))
    : [path];
  const out = [];
  const intern = interner();
  for (const f of files) {
    const rows = parseCsv(readFileSync(f, 'utf8'));
    if (!rows.length) continue;
    const isSackmann = 'tourney_level' in rows[0];
    const source = 'indoor' in rows[0] ? 'tml' : 'sk'; // TennisMyLife añade la columna indoor
    for (const r of rows) {
      const m = isSackmann ? fromSackmann(r, { levels, source, intern }) : fromSharpex(r);
      if (m && m.completed) out.push(m);
    }
  }
  return sortMatches(mergeSources(out).matches);
}
