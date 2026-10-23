// Cuotas de LoL por partido, comparando casas. Todas llegan desde el marcador de tu Chrome
// (Bet365, Winamax y Betway): no se usa ninguna API de cuotas.
// Se normalizan a cuotas decimales y se orientan según los equipos A/B del partido de lolesports.
const bridge = require('./bridge');

const round2 = x => Math.round(x * 100) / 100;

const { norm, teamScore, orient } = require('./equipos');

// ---------- Nombres de mercado ----------
function marketLabel(type, period, teamName) {
  const map = period ? `Mapa ${period} · ` : '';
  switch (type) {
    case 'moneyline': return period ? `${map}Ganador` : 'Ganador del partido';
    case 'spread': return period ? `${map}Hándicap de kills` : 'Hándicap de mapas';
    case 'total': return period ? `${map}Total de kills` : 'Total de mapas';
    case 'team_total': return `${map}Kills de ${teamName}`;
    default: return type;
  }
}

// Mercados de jugador: "Player Kills Map 1" → "Kills · Mapa 1"
const PLAYER_PERIOD = 98;
const STAT_RE = /(kill|assist|death|asistenc|muerte)/i;
function propLabel(name) {
  const n = String(name || '');
  const stat = /assist|asistenc/i.test(n) ? 'Asistencias' : /death|muerte/i.test(n) ? 'Muertes' : /kill/i.test(n) ? 'Kills' : n.trim() || 'Jugador';
  const map = n.match(/\b(?:map|game|mapa)\s*(\d)/i);
  return stat + (map ? ` · Mapa ${map[1]}` : '');
}
const isOver = n => /over|más|\+/i.test(n || '');
const isUnder = n => /under|menos|-/i.test(n || '');

// Acumula las cuotas de todas las fuentes. Las claves canónicas (tipo|periodo|lado|línea) hacen que
// la misma línea de casas distintas acabe en la misma fila.
class Book {
  constructor(a, b) { this.a = a; this.b = b; this.markets = new Map(); this.books = new Set(); }

  add({ key, group, period, line, main, outcomes }, bookmaker, prices) {
    if (!this.markets.has(key)) this.markets.set(key, { key, group, period, line, main: !!main, outcomes: outcomes.map(o => ({ ...o, prices: {} })) });
    const m = this.markets.get(key);
    m.main = m.main || !!main;
    // Otra fuente puede traer selecciones que faltaban (p. ej. sólo "Más de" en una y "Menos de" en otra)
    for (const o of outcomes) if (!m.outcomes.some(x => x.id === o.id)) m.outcomes.push({ ...o, prices: {} });
    let any = false;
    for (const o of m.outcomes) {
      const p = prices[o.id];
      if (p && p > 1) { o.prices[bookmaker] = round2(p); any = true; }
    }
    if (any) this.books.add(bookmaker);
  }

  // Mercado estándar: ganador / hándicap / total, del partido (period 0) o de un mapa
  addStd(type, period, line, bookmaker, prices, main, side) {
    const { a, b } = this;
    const fmt = v => (v > 0 ? `+${v}` : `${v}`);
    let outcomes;
    if (type === 'moneyline') outcomes = [{ id: 'a', label: a.code || a.name }, { id: 'b', label: b.code || b.name }];
    else if (type === 'spread') outcomes = [{ id: 'a', label: `${a.code || a.name} ${fmt(line)}` }, { id: 'b', label: `${b.code || b.name} ${fmt(-line)}` }];
    else outcomes = [{ id: 'over', label: `Más de ${line}` }, { id: 'under', label: `Menos de ${line}` }];
    const team = side === 'a' ? a : side === 'b' ? b : null;
    this.add({
      key: `${type}|${period}|${side || ''}|${type === 'moneyline' ? '' : line}`,
      group: marketLabel(type, period, team ? team.code || team.name : ''),
      period, line: type === 'moneyline' ? null : line, main, outcomes
    }, bookmaker, prices);
  }

  result(sources) {
    const markets = [...this.markets.values()]
      .filter(m => m.outcomes.some(o => Object.keys(o.prices).length))
      .sort((x, y) => x.period - y.period || x.group.localeCompare(y.group) || (y.main - x.main) || ((x.line ?? 0) - (y.line ?? 0)));
    return { books: [...this.books], markets, sources };
  }
}


// ---------- Winamax (scraping de su web) ----------
const parseSbv = v => Object.fromEntries(String(v || '').split('|').filter(Boolean).map(x => x.split('=')));
const num = v => (v == null || v === '' ? null : Number(String(v).replace(',', '.')));
const fmtLine = v => (v > 0 ? `+${v}` : `${v}`);

// Pasa el estado de un partido de Winamax a las filas del comparador
function winamaxInto(book, match, st, found) {
  const { e, o } = found;
  const m = st.matches?.[e.id];
  if (!m?.bets?.length) return 0;
  const BK = 'Winamax';
  const name1 = m.competitor1Name, name2 = m.competitor2Name;
  const sideOf = code => ((code === '1') !== o.swapped ? 'a' : 'b'); // competidor 1/2 → equipo A/B
  const playerName = id => st.players?.[id]?.name || st.players?.[id]?.shortname;
  let n = 0;
  for (const betId of m.bets) {
    const bet = st.bets?.[betId];
    if (!bet || bet.available === false) continue;
    const outs = (bet.outcomes || []).map(id => ({ ...(st.outcomes?.[id] || {}), id: String(id), price: st.odds?.[id] }))
      .filter(x => x.price > 1 && x.available !== false);
    if (!outs.length) continue;
    const sbv = parseSbv(bet.specialBetValue);
    const period = sbv.mapnr ? Number(sbv.mapnr) : 0;
    const title = bet.betTitle || bet.betTypeName || '';
    const rest = title.replace(/^Mapa \d+\s*-\s*/i, '').trim();
    const total = num(sbv.total);
    const over = outs.find(x => /^más/i.test(x.label) || x.code === 'over');
    const under = outs.find(x => /^menos/i.test(x.label) || x.code === 'under');
    const pid = outs.find(x => x.playerId)?.playerId;
    const who = pid ? playerName(pid) : null;
    const generic = (group, per, line, list) => book.add({
      key: `wmx|${title}|${bet.specialBetValue || ''}`, group, period: per, line, main: true,
      outcomes: list.map(x => ({ id: x.id, label: x.label }))
    }, BK, Object.fromEntries(list.map(x => [x.id, x.price])));
    n++;

    if (bet.template === '2way' && /^ganador$/i.test(rest) && outs.length === 2) {
      const p = Object.fromEntries(outs.map(x => [sideOf(x.code), x.price]));
      book.addStd('moneyline', period, null, BK, p, true);
    } else if (bet.template === 'asian_handicap' && outs.length === 2 && sbv.hcp != null) {
      // hcp es el del competidor 1; nuestras líneas van referidas al equipo A
      const h = num(sbv.hcp);
      const [c1, c2] = outs;
      book.addStd('spread', period, o.swapped ? -h : h, BK, o.swapped ? { a: c2.price, b: c1.price } : { a: c1.price, b: c2.price }, true);
    } else if (bet.template === 'OverUnder' && who && total != null) {
      // Cuota de jugador: misma clave que Unibet y OddsPapi para compartir fila
      const stat = propLabel(title);
      const outcomes = [over && { id: 'over', label: `${who} · Más de ${total}` }, under && { id: 'under', label: `${who} · Menos de ${total}` }].filter(Boolean);
      book.add({ key: `player|${stat}|${who.toLowerCase()}|${total}`, group: `Jugadores · ${stat}`, period: PLAYER_PERIOD, line: total, main: true, outcomes },
        BK, { over: over?.price, under: under?.price });
    } else if (bet.template === 'OverUnder' && total != null && over && under && /^total kills$/i.test(rest)) {
      book.addStd('total', period, total, BK, { over: over.price, under: under.price }, true);
    } else if (bet.template === 'OverUnder' && total != null && over && under && /total kills$/i.test(rest) && (rest.includes(name1) || rest.includes(name2))) {
      const isC1 = rest.includes(name1);
      book.addStd('team_total', period, total, BK, { over: over.price, under: under.price }, true, isC1 !== o.swapped ? 'a' : 'b');
    } else if (pid || /jugador|cara a cara/i.test(title)) {
      // Resto de mercados de jugador: logros, cara a cara, jugador con más kills…
      const label = rest.replace(who || '\u0000', '').replace(/^\s*-\s*|\s*-\s*$/g, '').trim();
      const map = period ? ` · Mapa ${period}` : '';
      const list = who && bet.template === 'dynamic' ? outs.map(x => ({ ...x, label: `${who} · ${x.label}` })) : outs;
      const grp = /cara a cara/i.test(title) ? `Jugadores · Cara a cara${map}` : `Jugadores · ${label.replace(/Total Kills \(logros\)/i, 'Kills (logros)')}${map}`;
      book.add({
        key: `wmx|${title}|${bet.specialBetValue || ''}`, group: grp, period: PLAYER_PERIOD, line: total, main: true,
        outcomes: list.map(x => ({ id: x.id, label: /cara a cara/i.test(title) ? `${rest.replace(/^Cara a cara Kills\s*-\s*/i, '').replace(' - ', ' vs ')} · ${x.label}` : x.label }))
      }, BK, Object.fromEntries(list.map(x => [x.id, x.price])));
    } else {
      // Mercados del mapa sin equivalente en otras casas (dragones, torres, primera sangre…)
      const label = rest + (total != null && !/\d/.test(rest) ? ` (${total})` : sbv.hcp != null ? ` (${fmtLine(num(sbv.hcp))})` : '');
      generic(period ? `Mapa ${period} · ${label}` : label, period || 50, total, outs);
    }
  }
  return n;
}

// ---------- Cuotas recibidas del marcador ----------
const STAT_NAME = { k: 'Kills', a: 'Asistencias', d: 'Muertes' };
const BOOK_LABEL = { bet365: 'Bet365', winamax: 'Winamax', betway: 'Betway' };

// Líneas de jugador leídas de la página (Bet365, Betway)
function sectionsInto(book, imp) {
  const BK = BOOK_LABEL[imp.book];
  let n = 0;
  for (const sec of imp.sections || []) {
    const stat = STAT_NAME[sec.mkt] || 'Kills';
    const map = ` · Mapa ${sec.map || imp.map || 1}`;
    for (const e of sec.entries || []) {
      if (sec.h2h) {
        const h = e.handicap != null ? ` (${fmtLine(e.handicap)})` : '';
        const h2 = e.handicap != null ? ` (${fmtLine(-e.handicap)})` : '';
        book.add({
          key: `h2h|${stat}${map}|${[e.p1, e.p2].map(x => x.toLowerCase()).join('|')}|${e.handicap ?? ''}`, group: `Jugadores · Comparación de ${stat.toLowerCase()}${map}`,
          period: PLAYER_PERIOD, line: e.handicap ?? null, main: true,
          outcomes: [{ id: 'p1', label: `${e.p1}${h} vs ${e.p2}` }, { id: 'p2', label: `${e.p2}${h2} vs ${e.p1}` }]
        }, BK, { p1: e.odds1, p2: e.odds2 });
      } else {
        // Misma clave en todas las casas: la línea de cada jugador se compara en una sola fila
        const s = `${stat}${map}`;
        book.add({
          key: `player|${s}|${String(e.name).toLowerCase()}|${e.line}`, group: `Jugadores · ${s}`, period: PLAYER_PERIOD, line: e.line, main: true,
          outcomes: [{ id: 'over', label: `${e.name} · Más de ${e.line}` }, { id: 'under', label: `${e.name} · Menos de ${e.line}` }]
        }, BK, { over: e.over, under: e.under });
      }
      n++;
    }
  }
  return n;
}

// Resto de mercados leídos de la página (Betway y Bet365): ganador ("Ganará" en bet365), hándicaps y totales van a las filas comunes
// con Winamax ("Total de víctimas" = total de kills); lo demás (primera sangre, dragones, resultado exacto…) sale como mercado propio de la casa
const sentence = t => { const x = String(t).toLowerCase().trim(); return x.charAt(0).toUpperCase() + x.slice(1); };
function marketsInto(book, imp, match) {
  const BK = BOOK_LABEL[imp.book];
  const side = name => {
    const sa = teamScore(match.a, name), sb = teamScore(match.b, name);
    return sa >= 0.8 && sa > sb ? 'a' : sb >= 0.8 && sb > sa ? 'b' : null;
  };
  const mentions = t => [match.a, match.b].find(x => [x.name, x.code].filter(v => v && norm(v).length >= 2).some(v => norm(t).includes(norm(v))));
  const lineOf = o => { const x = String(o.hcap || '').match(/[-+]?\d+(?:[.,]\d+)?/); return x ? Number(x[0].replace(',', '.')) : null; };
  const OBJ = /sangre|primer|primera|torre|drag|bar[oó]n|inhib|heraldo|grub|larva|duraci/;
  let n = 0;
  for (const mk of imp.markets || []) {
    const period = mk.map || 0;
    const rest = mk.title.replace(/^(mapa\s*\d+|\d\s*º\s*mapa)\s*[-·:]\s*/i, '').trim(); // "Mapa 1 - " (Betway), "1º mapa - " (Bet365)
    const lo = rest.toLowerCase();
    const outs = (mk.outcomes || []).filter(o => o.price > 1);
    if (!outs.length) continue;
    const sides = outs.map(o => side(o.name));
    const ou = outs.every(o => /^(m[aá]s|menos|over|under)/i.test(o.name));
    const overOf = o => /^(m[aá]s|over)/i.test(o.name);
    const label = period ? `Mapa ${period} · ${sentence(rest)}` : sentence(rest);
    n++;
    if (outs.length === 2 && sides[0] && sides[1] && sides[0] !== sides[1] && /ganador|ganar[aá]|vencedor|resultado del partido|moneyline/.test(lo) && !OBJ.test(lo)) {
      book.addStd('moneyline', period, null, BK, { [sides[0]]: outs[0].price, [sides[1]]: outs[1].price }, true);
    } else if (/h[aá]ndicap/.test(lo) && sides.every(Boolean) && !OBJ.test(lo)) {
      // Pares (equipo A con línea h, equipo B con -h)
      for (const oa of outs.filter((o, i) => sides[i] === 'a')) {
        const h = lineOf(oa);
        const ob = outs.find((o, i) => sides[i] === 'b' && lineOf(o) === (h == null ? null : -h));
        if (h != null && ob) book.addStd('spread', period, h, BK, { a: oa.price, b: ob.price }, true);
      }
    } else if (ou && /total/.test(lo) && /kills|mapas|asesinatos|v[ií]ctimas/.test(lo) && !OBJ.test(lo)) {
      const team = mentions(rest);
      const lines = [...new Set(outs.map(lineOf).filter(v => v != null).map(Math.abs))];
      for (const l of lines) {
        const ov = outs.find(o => overOf(o) && Math.abs(lineOf(o)) === l), un = outs.find(o => !overOf(o) && Math.abs(lineOf(o)) === l);
        if (!ov && !un) continue;
        const pr = { over: ov?.price, under: un?.price };
        if (team) book.addStd('team_total', period, l, BK, pr, true, team === match.a ? 'a' : 'b');
        else book.addStd('total', period, l, BK, pr, true);
      }
    } else if (ou) {
      const lines = [...new Set(outs.map(o => lineOf(o) ?? Number(String(mk.line).replace(',', '.'))).map(Math.abs))];
      for (const l of lines) {
        const at = outs.filter(o => Math.abs(lineOf(o) ?? Number(String(mk.line).replace(',', '.'))) === l);
        book.add({
          key: `${imp.book}|${mk.title}|${l}`, group: label, period: period || 50, line: isNaN(l) ? null : l, main: true,
          outcomes: at.map(o => ({ id: overOf(o) ? 'over' : 'under', label: `${overOf(o) ? 'Más' : 'Menos'} de ${l}` }))
        }, BK, Object.fromEntries(at.map(o => [overOf(o) ? 'over' : 'under', o.price])));
      }
    } else {
      book.add({
        key: `${imp.book}|${mk.title}|${mk.line || ''}`, group: label, period: period || 50, line: null, main: true,
        outcomes: outs.map((o, i) => ({ id: String(i), label: o.hcap && !/^[OU]\s/.test(o.hcap) ? `${o.name} ${o.hcap}` : o.name }))
      }, BK, Object.fromEntries(outs.map((o, i) => [String(i), o.price])));
    }
  }
  return n;
}

// Mete una importación (una casa, una página) en el acumulador; devuelve cuántos mercados ha leído
function intoBook(book, match, imp) {
  if (imp.book === 'winamax') {
    const o = orient(match.a, match.b, imp.home, imp.away) || { swapped: false, score: 0 };
    return winamaxInto(book, match, imp.state, { e: { id: imp.matchId }, o });
  }
  return sectionsInto(book, imp) + marketsInto(book, imp, match);
}

// match = { a: {name, code}, b: {name, code}, start }
async function getMatchOdds(match) {
  const book = new Book(match.a, match.b);
  const sources = {}, counts = {};
  for (const imp of await bridge.forMatch(match)) {
    const name = BOOK_LABEL[imp.book];
    try {
      const n = intoBook(book, match, imp);
      // Una casa puede llegar en varias páginas (pestañas): se suman
      const prev = counts[name] || { n: 0, ts: 0 };
      counts[name] = { n: prev.n + n, ts: Math.max(prev.ts, imp.ts) };
      const mins = Math.round((Date.now() - counts[name].ts) / 60e3);
      sources[name] = { ok: counts[name].n > 0, msg: `${counts[name].n} mercados · enviadas hace ${mins} min` };
    } catch (e) { if (!sources[name]?.ok) sources[name] = { ok: false, msg: e.message }; }
  }
  return book.result(sources);
}

// Tras guardar una importación: cuota de ganador (para las tarjetas del calendario) e histórico de cuotas.
// En el histórico sólo se apunta una cuota cuando cambia, para que la tabla no crezca sin control.
async function afterImport(match, imp) {
  const book = new Book(match.a, match.b);
  intoBook(book, match, imp);
  const ml = book.markets.get('moneyline|0||');
  const price = id => ml?.outcomes.find(x => x.id === id)?.prices[BOOK_LABEL[imp.book]];
  if (price('a') && price('b')) await bridge.setMoneyline(imp.id, { a: price('a'), b: price('b') });
  const rows = [];
  for (const m of book.markets.values()) {
    for (const o of m.outcomes) {
      const p = o.prices[BOOK_LABEL[imp.book]];
      if (p) rows.push({ market_key: m.key, market: m.group, outcome_id: o.id, outcome: o.label, line: m.line, price: p });
    }
  }
  await bridge.recordPrices(imp.matchKey, imp.book, rows);
}

// Cuota de ganador para las tarjetas del calendario: la mejor de las casas ya enviadas
async function getBoardFor(events) {
  const list = (events || []).filter(ev => ev?.a && ev?.b);
  const best = await bridge.moneylines(list);
  const out = {};
  for (const ev of list) {
    const m = best[bridge.keyOf(ev)];
    if (m && m.a && m.b) out[ev.id] = m;
  }
  return out;
}

module.exports = { getMatchOdds, getBoardFor, afterImport, orient, winamaxInto };
