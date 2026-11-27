// Avisos de cuotas: la app vigila sola y avisa (campana de la app, aviso en vivo y notificación con la app cerrada) de
//  - caídas y subidas fuertes (odds/moves.js, 10 % o más entre dos lecturas) en lo de cada usuario: sus favoritos (el ganador),
//    sus apuestas pendientes (su mercado) y su cupón (oddsWatch, lo manda la interfaz);
//  - recomendaciones nuevas con valor: las de tenis, fútbol y MMA se piden a sus servicios cada 10 minutos; las de baloncesto
//    se calculan en el navegador, así que salen de bets.predictions cuando alguien las ha visto;
//  - surebets entre Winamax y Betway (las manda odds/surebets.js al encontrarlas: tras cada lectura y cada 15 minutos).
// Para saber de quién es una apuesta afectada se leen las apuestas pendientes de todos (como el resolvedor, settle.js): sólo para
// avisar a su dueño. Nunca se expone en una ruta.
const { query, notify } = require('../../shared/db');
const client = require('../../shared/client');
const push = require('./push');
const { norm, mentionsTeam } = require('../../shared/mentions');

const PREF_KEYS = ['drop', 'rise', 'value', 'news', 'sure'];
const DEFAULT_PREFS = { drop: true, rise: true, value: true, news: true, sure: true };
const REPEAT_MS = 3 * 3600e3; // lo mismo (partido, mercado, selección, sentido) no se repite antes de 3 h
const KEEP_DAYS = 14;
const PUSH_PER_DAY = 20; // notificaciones con la app cerrada por usuario y día; el resto queda en la campana
const VALUE_PER_SCAN = 5;
const SURE_PER_SCAN = 5; // surebets por usuario en cada envío (las de más beneficio)
const SURE_REPEAT_MS = 6 * 3600e3; // el mismo mercado del mismo partido no se repite antes de 6 h aunque cambie un poco la cuota // recomendaciones con valor por usuario en cada pasada (las de más valor)
const MAX_WATCH = 40;
// Recomendación con valor: la regla de «apostar» de la app (BET_EV y BET_REL en src/lib/value.ts). En baloncesto se guardan
// todas las líneas, así que sólo las fuertes (la regla de «Recomendaciones fuertes» de los avisos de la app)
const VALUE = { ev: 0.02, rel: 55 }, VALUE_BASKET = { ev: 0.08, rel: 65 };

const odd = v => Number(v).toFixed(2).replace('.', ',');
const pctOf = c => `${c > 0 ? '+' : '−'}${Math.round(Math.abs(c) * 100)} %`;
const madridDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const SPORT_NAME = { lol: 'LoL', basket: 'Baloncesto', tennis: 'Tenis', football: 'Fútbol', mma: 'MMA' };

// La dirección a la que lleva la notificación: la del partido (la misma forma que hrefOf de src/lib/route.ts), o la lista de su
// día si no tiene partido o es de LoL (su ficha necesita el partido entero). Con ?aviso=<id> para que la app lo marque como leído.
// Antes era siempre /?aviso=<id> y la app tenía que buscar el aviso al arrancar para saltar al partido: si la sesión o la lista
// tardaban, se quedaba en la portada
const SPORT_SLUG = { lol: 'lol', basket: 'baloncesto', tennis: 'tenis', football: 'futbol', mma: 'mma' };
function urlOf(id, open) {
  if (open?.surebets) return `/surebets?${new URLSearchParams({ aviso: String(id) })}`;
  const slug = SPORT_SLUG[open?.sport];
  if (!slug) return `/?aviso=${id}`;
  const day = open.date && !isNaN(Date.parse(open.date)) ? madridDay(new Date(open.date)) : null;
  const q = new URLSearchParams({ ...(day ? { dia: day } : {}), aviso: String(id) });
  const path = open.id && open.sport !== 'lol' ? `/${slug}/partido/${encodeURIComponent(String(open.id)).replace(/%3A/gi, ':')}` : `/${slug}`;
  return `${path}?${q}`;
}

// ---------- Quién tiene que enterarse (funciones puras, con pruebas en server/test/avisos.test.js) ----------

const sameStart = (a, b) => !a || !b || Math.abs(+new Date(a) - +new Date(b)) <= 6 * 3600e3;

// A quién le importa cada movimiento de un partido. Devuelve [{ userId, move, why, open }] (why: 'bet' | 'watch' | 'fav')
function targetsOf(match, moves, { bets = [], watch = [], favorites = [] }) {
  const out = [];
  const sport = match.sport || 'lol';
  const byKey = new Map(moves.map(m => [`${m.market_key}\u0000${m.outcome_id}`, m]));
  // Apuestas pendientes: su mercado y su selección, en este partido
  for (const b of bets) {
    const r = b.ref;
    if (!r || (r.sport || 'lol') !== sport || !sameStart(r.start, match.start)) continue;
    if (!mentionsTeam(b.event, match.a) || !mentionsTeam(b.event, match.b)) continue;
    const m = byKey.get(`${r.key}\u0000${r.out}`);
    if (m) out.push({ userId: String(b.user_id), move: m, why: 'bet', open: { sport, id: r.match, date: r.start || match.start } });
  }
  // El cupón: lo mismo, con los nombres del comparador (exactos)
  for (const w of watch) {
    if ((w.sport || 'lol') !== sport || norm(w.a) !== norm(match.a?.name) || norm(w.b) !== norm(match.b?.name)) continue;
    const m = byKey.get(`${w.key}\u0000${w.out}`);
    if (m) out.push({ userId: String(w.user_id), move: m, why: 'watch', open: w.id ? { sport, id: w.id, date: w.date || match.start } : { sport, date: match.start } });
  }
  // Favoritos: el ganador del partido de su equipo, jugador o luchador
  for (const f of favorites) {
    if (f.sport !== sport) continue;
    const fav = norm(f.name);
    if (fav !== norm(match.a?.name) && fav !== norm(match.b?.name)) continue;
    for (const m of moves) if (/^moneyline\|0\|/.test(m.market_key)) out.push({ userId: String(f.user_id), move: m, why: 'fav', fav: f.name, open: { sport, date: match.start } });
  }
  // Una vez por usuario y selección: si es de su apuesta y además está en su cupón, cuenta la apuesta
  const seen = new Set();
  return out.filter(t => { const k = `${t.userId}|${t.move.market_key}|${t.move.outcome_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Lo que dice el aviso de un movimiento
function moveText(match, book, t) {
  const m = t.move, kind = m.change < 0 ? 'drop' : 'rise';
  const what = String(m.outcome || '').trim() || m.outcome_id;
  const why = t.why === 'bet' ? 'Tienes una apuesta' : t.why === 'watch' ? 'Está en tu cupón' : `Sigues a ${t.fav}`;
  return {
    kind,
    title: `${kind === 'drop' ? 'Cae' : 'Sube'} ${what}: ${odd(m.from)} → ${odd(m.to)}`,
    body: `${match.a?.name} - ${match.b?.name} · ${m.market} · ${book}, ${pctOf(m.change)}. ${why}${kind === 'rise' && t.why === 'bet' ? ': el mercado va en contra' : ''}.`
  };
}

// ¿Es una recomendación con valor?
const isValue = (p, sport) => { const t = sport === 'basket' ? VALUE_BASKET : VALUE; return p && p.ev >= t.ev && (p.rel?.score ?? p.rel ?? 0) >= t.rel && p.price > 1; };

// ---------- Preferencias y cupón de cada usuario ----------
const cleanPrefs = v => Object.fromEntries(PREF_KEYS.map(k => [k, v?.[k] === undefined ? DEFAULT_PREFS[k] : !!v[k]]));
async function getPrefs(userId) {
  const r = (await query("SELECT value FROM bets.user_settings WHERE user_id = $1 AND key = 'alertPrefs'", [userId])).rows[0];
  return cleanPrefs(r?.value);
}
async function setPrefs(userId, v) {
  const p = cleanPrefs(v);
  await query(`INSERT INTO bets.user_settings (user_id, key, value) VALUES ($1, 'alertPrefs', $2::jsonb)
    ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [userId, JSON.stringify(p)]);
  return p;
}

// El cupón lo manda el navegador: se limpia (sólo lo que hace falta para reconocer la selección)
const str = (v, n) => String(v ?? '').trim().slice(0, n);
function cleanWatch(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list.slice(0, MAX_WATCH)) {
    const w = { sport: str(x?.sport, 10) || 'lol', a: str(x?.a, 80), b: str(x?.b, 80), key: str(x?.key, 160), out: str(x?.out, 20) };
    if (!w.a || !w.b || !w.key || !w.out || !['lol', 'basket', 'tennis', 'football', 'mma'].includes(w.sport)) continue;
    if (x?.id) w.id = str(x.id, 60);
    if (x?.date && !isNaN(Date.parse(x.date))) w.date = new Date(x.date).toISOString();
    out.push(w);
  }
  return out;
}
async function setWatch(userId, list) {
  const w = cleanWatch(list);
  await query(`INSERT INTO bets.user_settings (user_id, key, value) VALUES ($1, 'oddsWatch', $2::jsonb)
    ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [userId, JSON.stringify(w)]);
  return { n: w.length };
}

// ---------- Guardar y entregar ----------
async function prefsOf(userIds) {
  if (!userIds.length) return new Map();
  const { rows } = await query("SELECT user_id, value FROM bets.user_settings WHERE key = 'alertPrefs' AND user_id = ANY($1::bigint[])", [userIds]);
  const m = new Map(rows.map(r => [String(r.user_id), cleanPrefs(r.value)]));
  return new Map(userIds.map(id => [String(id), m.get(String(id)) || cleanPrefs()]));
}

// Guarda el aviso (si no se avisó ya de lo mismo hace poco), lo manda a la campana en vivo y, con la app cerrada, al móvil
async function deliver(userId, a, { repeatMs = REPEAT_MS } = {}) {
  const dup = (await query(`SELECT 1 FROM bets.alerts WHERE user_id = $1 AND dedupe = $2 AND created_at > now() - ($3::bigint * interval '1 millisecond') LIMIT 1`,
    [userId, a.dedupe, repeatMs])).rows.length;
  if (dup) return false;
  const { rows } = await query(`INSERT INTO bets.alerts (user_id, kind, dedupe, sport, title, body, open) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
    [userId, a.kind, a.dedupe, a.sport || '', a.title.slice(0, 200), String(a.body || '').slice(0, 500), a.open ? JSON.stringify(a.open) : null]);
  // Sólo el aviso de que hay algo nuevo, sin el texto: el gateway se lo manda sólo a ese usuario (data.to)
  notify('alerts:new', { to: String(userId) });
  const today = (await query(`SELECT count(*)::int AS n FROM bets.alerts WHERE user_id = $1 AND created_at > now() - interval '1 day'`, [userId])).rows[0].n;
  if (today <= PUSH_PER_DAY) push.send(userId, { title: a.title, body: a.body, tag: a.dedupe, url: urlOf(rows[0].id, a.open) }).catch(() => {});
  return true;
}

// ---------- Movimientos de cuotas (los manda odds tras cada lectura) ----------
async function fromOdds(body) {
  const match = body?.match, moves = Array.isArray(body?.moves) ? body.moves : [];
  if (!match?.a?.name || !match?.b?.name || !moves.length) return { sent: 0 };
  const sport = match.sport || 'lol';
  const keys = [...new Set(moves.map(m => String(m.market_key)))];
  const [bets, watch, favorites] = await Promise.all([
    query(`SELECT b.user_id, b.event, b.ref FROM bets.bets b WHERE b.status = 'pending' AND b.ref->>'key' = ANY($1) AND coalesce(b.ref->>'sport', 'lol') = $2
      UNION ALL
      SELECT b.user_id, l.event, l.ref FROM bets.bet_legs l JOIN bets.bets b ON b.id = l.bet_id
      WHERE b.status = 'pending' AND l.status = 'pending' AND l.ref->>'key' = ANY($1) AND coalesce(l.ref->>'sport', 'lol') = $2`, [keys, sport]),
    query("SELECT user_id, value FROM bets.user_settings WHERE key = 'oddsWatch' AND jsonb_array_length(value) > 0"),
    query("SELECT user_id, value FROM bets.user_settings WHERE key = 'favorites' AND jsonb_array_length(value) > 0")
  ]);
  const targets = targetsOf(match, moves, {
    bets: bets.rows,
    watch: watch.rows.flatMap(r => (r.value || []).map(w => ({ ...w, user_id: r.user_id }))),
    favorites: favorites.rows.flatMap(r => (r.value || []).map(f => ({ ...f, user_id: r.user_id })))
  });
  const prefs = await prefsOf([...new Set(targets.map(t => t.userId))]);
  let sent = 0;
  for (const t of targets) {
    const txt = moveText(match, body.book || '', t);
    if (!prefs.get(t.userId)?.[txt.kind]) continue;
    const dedupe = `${txt.kind}|${sport}|${match.a.name}|${match.b.name}|${t.move.market_key}|${t.move.outcome_id}`;
    if (await deliver(t.userId, { ...txt, dedupe, sport, open: t.open })) sent++;
  }
  return { sent };
}

// ---------- Noticias: un jugador no juega, duda, está lesionado, sancionado o vuelve ----------
// Las manda football o basket en cuanto ven la noticia por primera vez (shared/news.js, onNew), para avisar antes de que se
// mueva la cuota. A quién: a quien tiene una apuesta pendiente con ese jugador (su nombre en la selección o el mercado, de ese
// deporte y con su equipo en el partido) y a quien lo sigue (favorito el jugador; o su equipo, si no juega o está sancionado)
const NEWS_STATUS = { out: 'no juega', suspended: 'sancionado', doubt: 'en duda', injured: 'lesionado', back: 'vuelve' };
const namedIn = (text, name) => {
  const t = ` ${norm(text)} `, n = norm(name), last = n.split(' ').filter(w => w.length >= 4).at(-1);
  return (!!n && t.includes(` ${n} `)) || (!!last && t.includes(` ${last} `));
};
function newsTargets(sport, o, { bets = [], favorites = [] }) {
  const out = [];
  for (const b of bets) {
    if ((b.sport || 'lol') !== sport) continue;
    if (!namedIn(`${b.selection} ${b.market}`, o.name)) continue;
    if (o.teamName && !mentionsTeam(b.event, { name: o.teamName }) && !namedIn(b.event, o.name)) continue;
    out.push({ userId: String(b.user_id), why: 'bet' });
  }
  for (const f of favorites) {
    if (f.sport !== sport) continue;
    if (norm(f.name) === norm(o.name)) out.push({ userId: String(f.user_id), why: 'fav', fav: f.name });
    else if (o.teamName && norm(f.name) === norm(o.teamName) && (o.status === 'out' || o.status === 'suspended')) out.push({ userId: String(f.user_id), why: 'fav', fav: f.name });
  }
  const seen = new Set();
  return out.filter(t => (seen.has(t.userId) ? false : (seen.add(t.userId), true)));
}
function newsText(o, item, t) {
  const why = t.why === 'bet' ? 'Tienes una apuesta con él' : `Sigues a ${t.fav}`;
  return {
    title: `${o.name}: ${NEWS_STATUS[o.status] || o.status}${o.teamName ? ` (${o.teamName})` : ''}`,
    body: `${item.title} · ${item.source}. ${why}: mira la cuota antes de que se mueva.`
  };
}
async function fromNews(body) {
  const sport = String(body?.sport || ''), items = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
  if (!['football', 'basket'].includes(sport) || !items.length) return { sent: 0 };
  const [bets, favorites] = await Promise.all([
    query(`SELECT b.user_id, b.event, b.market, b.selection, coalesce(b.sport, 'lol') AS sport FROM bets.bets b WHERE b.status = 'pending' AND coalesce(b.sport, 'lol') = $1 AND b.market <> 'Combinada'
      UNION ALL
      SELECT b.user_id, l.event, l.market, l.selection, coalesce(l.sport, b.sport, 'lol') AS sport FROM bets.bet_legs l JOIN bets.bets b ON b.id = l.bet_id
      WHERE b.status = 'pending' AND l.status = 'pending' AND coalesce(l.sport, b.sport, 'lol') = $1`, [sport]),
    query("SELECT user_id, value FROM bets.user_settings WHERE key = 'favorites' AND jsonb_array_length(value) > 0")
  ]);
  const favs = favorites.rows.flatMap(r => (r.value || []).map(f => ({ ...f, user_id: r.user_id })));
  let sent = 0;
  for (const item of items) {
    for (const o of Array.isArray(item.outs) ? item.outs.slice(0, 10) : []) {
      if (!NEWS_STATUS[o?.status] || !o?.name) continue;
      const targets = newsTargets(sport, o, { bets: bets.rows, favorites: favs });
      const prefs = await prefsOf([...new Set(targets.map(t => t.userId))]);
      for (const t of targets) {
        if (!prefs.get(t.userId)?.news) continue;
        const txt = newsText(o, item, t);
        const open = o.match?.id ? { sport, id: o.match.id, date: o.match.date } : { sport };
        if (await deliver(t.userId, { kind: 'news', sport, dedupe: `news|${sport}|${norm(o.name)}|${o.status}`, ...txt, open }, { repeatMs: 12 * 3600e3 })) sent++;
      }
    }
  }
  return { sent };
}

// ---------- Recomendaciones nuevas con valor ----------
// Las del día y del siguiente de tenis, fútbol y MMA (las calcula cada servicio con las cuotas de ahora). De todas las líneas, no
// de las de la portada: la «más fiable» de cada partido suele pagar poco y casi nunca tiene valor
async function valuePicks() {
  const days = [madridDay(), madridDay(new Date(Date.now() + 864e5))];
  const out = [];
  const take = (sport, d, pick, event, league) => {
    if (!d || !isValue(pick, sport) || +new Date(d.date) < Date.now()) return;
    out.push({ sport, id: d.id, date: d.date, event, league, pick: { key: String(pick.id).split('#')[0], out: String(pick.id).split('#')[1], title: pick.title || pick.selection, market: pick.market, price: pick.price, book: pick.book, ev: pick.ev, p: pick.p } });
  };
  const get = (svc, path) => client.call(svc, 'GET', path, undefined, 90e3).catch(e => { console.warn(`avisos de valor (${svc}):`, e.message); return null; });
  for (const date of days) {
    const [tennis, football, mma] = await Promise.all([
      get('tennis', `/api/tennis/picks/board?date=${date}`),
      get('football', `/api/football/picks/lines?date=${date}`),
      get('mma', `/api/mma/picks/lines?date=${date}`)
    ]);
    for (const x of tennis?.matches || []) for (const p of x.picks || []) take('tennis', x.m, p, `${x.m?.a?.name} - ${x.m?.b?.name}`, x.m?.tournament);
    for (const r of football || []) take('football', r, r.pick, `${r.home?.name} - ${r.away?.name}`, r.leagueName);
    for (const r of mma || []) take('mma', r, r.pick, `${r.a?.name} - ${r.b?.name}`, r.orgName);
  }
  // Baloncesto: las líneas que han calculado los navegadores en las últimas 2 horas, de partidos que no han empezado (cada una se
  // avisa una vez)
  const { rows } = await query(`SELECT match, key, out, start, grp, title, event, league, book, price, p, ev, rel FROM bets.predictions
    WHERE sport = 'basket' AND last_at > now() - interval '2 hours' AND start > now() AND ev >= $1 AND rel >= $2`, [VALUE_BASKET.ev, VALUE_BASKET.rel]);
  for (const r of rows) out.push({ sport: 'basket', id: r.match, date: r.start, event: r.event, league: r.league, pick: { key: r.key, out: r.out, title: r.title, market: r.grp, price: Number(r.price), book: r.book, ev: Number(r.ev), p: Number(r.p) } });
  return out;
}

const pct0 = v => `${Math.round(v * 100)} %`;
async function scanValue() {
  const picks = (await valuePicks()).sort((x, y) => y.pick.ev - x.pick.ev);
  if (!picks.length) return { sent: 0 };
  const { rows } = await query('SELECT id FROM bets.users');
  const prefs = await prefsOf(rows.map(r => String(r.id)));
  let sent = 0;
  for (const [userId, p] of prefs) {
    if (!p.value) continue;
    let n = 0;
    for (const v of picks) {
      if (n >= VALUE_PER_SCAN) break;
      const ok = await deliver(userId, {
        kind: 'value', sport: v.sport, dedupe: `value|${v.sport}|${v.id}|${v.pick.key}|${v.pick.out}`,
        title: `Con valor: ${v.pick.title} a ${odd(v.pick.price)}`,
        body: `${SPORT_NAME[v.sport]} · ${v.event}${v.league ? ` (${v.league})` : ''} · ${v.pick.market}. Probabilidad ${pct0(v.pick.p)}, valor ${pctOf(v.pick.ev)} en ${v.pick.book}.`,
        open: { sport: v.sport, id: v.id, date: v.date }
      }, { repeatMs: 4 * 864e5 }); // una recomendación, una vez
      if (ok) { n++; sent++; }
    }
  }
  return { sent };
}

// ---------- Surebets (las manda odds/surebets.js) ----------
// Las líneas llegan con punto ("Más de 2.5"): en el aviso, con coma, como en la app
const decEs = t => String(t ?? '').replace(/(\d)\.(\d)/g, '$1,$2');
// Las de una tanda, de más a menos beneficio, con lo que dice el aviso. Pura (pruebas en server/test/avisos.test.js)
function sureItems(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list.slice(0, 200) : []) {
    const m = x?.match;
    if (!m?.a?.name || !m?.b?.name || !SPORT_NAME[m.sport]) continue;
    for (const a of Array.isArray(x.arbs) ? x.arbs : []) {
      const legs = Array.isArray(a?.legs) ? a.legs.filter(l => l?.label && l.book && l.price > 1) : [];
      if (!(a?.edge > 0) || legs.length < 2) continue;
      const pct = `+${(a.edge * 100).toFixed(1).replace('.', ',')} %`;
      out.push({
        edge: a.edge, sport: m.sport,
        dedupe: `sure|${m.sport}|${norm(m.a.name)}|${norm(m.b.name)}|${a.key}`,
        title: `Surebet ${pct}: ${m.a.name} - ${m.b.name}`,
        body: `${SPORT_NAME[m.sport]}${m.league ? ` · ${m.league}` : ''} · ${decEs(a.market)}: ${legs.map(l => `${decEs(l.label)} a ${odd(l.price)} en ${l.book}`).join(', ')}.`
          + ` ${a.check ? 'Es mucho: comprueba las dos cuotas antes de apostar.' : 'Comprueba las cuotas antes de apostar: duran poco.'}`,
        open: { sport: m.sport, surebets: true, date: m.start }
      });
    }
  }
  return out.sort((x, y) => y.edge - x.edge);
}
async function fromSurebets(body) {
  const items = sureItems(body?.list);
  if (!items.length) return { sent: 0 };
  const { rows } = await query('SELECT id FROM bets.users');
  const prefs = await prefsOf(rows.map(r => String(r.id)));
  let sent = 0;
  for (const [userId, p] of prefs) {
    if (!p.sure) continue;
    let n = 0;
    for (const it of items) {
      if (n >= SURE_PER_SCAN) break;
      if (await deliver(userId, { kind: 'sure', sport: it.sport, dedupe: it.dedupe, title: it.title, body: it.body, open: it.open }, { repeatMs: SURE_REPEAT_MS })) { n++; sent++; }
    }
  }
  return { sent };
}

// ---------- Lo que ve cada usuario ----------
async function list(userId) {
  const { rows } = await query(`SELECT id, kind, sport, title, body, open, created_at, read_at FROM bets.alerts WHERE user_id = $1
    ORDER BY created_at DESC LIMIT 60`, [userId]);
  return {
    list: rows.map(r => ({ id: String(r.id), kind: r.kind, sport: r.sport, title: r.title, body: r.body, open: r.open, created: r.created_at, read: !!r.read_at })),
    unread: rows.filter(r => !r.read_at).length,
    push: { key: await push.publicKey().catch(() => null), devices: await push.count(userId) }
  };
}
async function markRead(userId, ids) {
  if (Array.isArray(ids) && ids.length) await query('UPDATE bets.alerts SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::bigint[])', [userId, ids.map(String).filter(x => /^\d{1,18}$/.test(x))]);
  else await query('UPDATE bets.alerts SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  return { ok: true };
}

// Cada 10 minutos, las recomendaciones con valor; cada día, se borra lo viejo
function startAlerts() {
  const run = () => scanValue().catch(e => console.warn('avisos de valor:', e.message));
  setTimeout(run, 60e3);
  setInterval(run, 10 * 60e3);
  setInterval(() => query(`DELETE FROM bets.alerts WHERE created_at < now() - interval '${KEEP_DAYS} days'`).catch(() => {}), 6 * 3600e3);
}

module.exports = { fromSurebets, sureItems, fromNews, newsTargets, newsText, fromOdds, scanValue, list, markRead, getPrefs, setPrefs, setWatch, startAlerts, targetsOf, moveText, mentionsTeam, urlOf, cleanWatch, cleanPrefs, isValue };
