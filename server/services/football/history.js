'use strict';
// Resultados pasados para el modelo de goles (model.js): el marcador de ESPN mes a mes de cada competición. Un mes que ya
// pasó no cambia, así que se guarda para siempre en football.cache (clave "hist:<liga>:<AAAAMM>", unos KB) y sólo se le pide
// a ESPN una vez; el mes en curso se vuelve a pedir cada media hora.
const { query } = require('../../shared/db');

// Tres grupos que no se mezclan: los equipos de uno casi nunca juegan contra los del otro. Las competiciones que no salen
// en la app (Mundial, clasificación) están sólo para tener más partidos de las selecciones
const POOLS = {
  men: ['esp.1', 'esp.2', 'eng.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'esp.copa_del_rey'],
  women: ['uefa.wchampions', 'esp.w.1', 'eng.w.1'],
  national: ['uefa.nations', 'fifa.friendly', 'fifa.world', 'fifa.worldq.uefa']
};
// Las copas y los amistosos enfrentan a equipos que no se conocen y pesan menos (en los amistosos, además, se rota mucho)
const CUPS = new Set(['esp.copa_del_rey']);
const FRIENDLY = new Set(['fifa.friendly']);
const poolOf = espn => Object.keys(POOLS).find(k => POOLS[k].includes(espn)) || null;

const url = (espn, ym) => `https://site.api.espn.com/apis/site/v2/sports/soccer/${espn}/scoreboard?dates=${ym}&limit=500`;
const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// Sólo lo que hace falta de cada partido acabado. En la prórroga ESPN da el marcador de los 120 minutos: a los 90 iban
// empatados, y se cuenta como el empate con los goles del que menos marcó (el mejor dato que hay sin el minuto a minuto)
function compact(j, espn) {
  return (j.events || []).flatMap(e => {
    const c = e.competitions?.[0] || {};
    const st = c.status?.type || e.status?.type || {};
    if (st.state !== 'post' || /POSTPONED|CANCEL|SUSPENDED|ABANDONED/.test(st.name || '')) return [];
    const home = (c.competitors || []).find(x => x.homeAway === 'home'), away = (c.competitors || []).find(x => x.homeAway === 'away');
    let hg = num(home?.score), ag = num(away?.score);
    if (!home || !away || hg == null || ag == null) return [];
    if (/AET|PEN|EXTRA/.test(st.name || '')) hg = ag = Math.min(hg, ag);
    return [{ id: String(e.id), date: e.date, lg: espn, h: String(home.team?.id), a: String(away.team?.id), hn: home.team?.displayName || '', an: away.team?.displayName || '', hg, ag, n: c.neutralSite ? 1 : 0 }];
  });
}

const mem = new Map();
async function fetchJSON(u) {
  const res = await fetch(u, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`ESPN respondió ${res.status}`);
  return res.json();
}

async function month(espn, ym, current) {
  const key = `hist:${espn}:${ym}`;
  const hit = mem.get(key);
  if (hit && (!current || Date.now() - hit.t < 30 * 60e3)) return hit.v;
  if (!current) {
    const row = (await query('SELECT value FROM football.cache WHERE key = $1', [key]).catch(() => ({ rows: [] }))).rows[0];
    if (row) { mem.set(key, { t: Date.now(), v: row.value }); return row.value; }
  }
  try {
    const v = compact(await fetchJSON(url(espn, ym)), espn);
    mem.set(key, { t: Date.now(), v });
    if (!current) await query(`INSERT INTO football.cache (key, value, t) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`, [key, JSON.stringify(v)]);
    return v;
  } catch (e) {
    if (hit) return hit.v;
    throw e;
  }
}

const ymOf = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
function monthsBack(n, to = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(ymOf(new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - i, 1))));
  return out;
}

// De pocas en pocas: la primera vez son cientos de meses y ESPN no tiene por qué aguantarlos de golpe
async function inBatches(tasks, size = 4) {
  const out = [];
  for (let i = 0; i < tasks.length; i += size) out.push(...(await Promise.all(tasks.slice(i, i + size).map(f => f()))));
  return out;
}

// Los partidos acabados de un grupo en los últimos `months` meses, del más antiguo al más reciente. Si un mes falla se
// salta (mejor un modelo con un mes menos que ninguno)
async function results(pool, months = 18) {
  const cur = ymOf(new Date());
  const tasks = POOLS[pool].flatMap(espn => monthsBack(months).map(ym => () => month(espn, ym, ym >= cur).catch(e => {
    console.error(`[football] histórico ${espn} ${ym}:`, e.message);
    return [];
  })));
  const seen = new Set();
  return (await inBatches(tasks)).flat().filter(r => !seen.has(r.id) && seen.add(r.id)).sort((x, y) => x.date.localeCompare(y.date));
}

module.exports = { POOLS, CUPS, FRIENDLY, poolOf, results, monthsBack };
