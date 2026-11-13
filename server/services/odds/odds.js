// Cuotas por partido (LoL y baloncesto), comparando casas. Llegan del lector de Docker o del marcador de Chrome
// (Winamax y Betway): no se usa ninguna API de cuotas.
// Se normalizan a cuotas decimales y se orientan según los equipos A/B del partido.
const bridge = require('./bridge');

const round2 = x => Math.round(x * 100) / 100;

const { norm, teamScore, orient } = require('./equipos');
const { mentions } = require('../../shared/fighters');

// ---------- Nombres de mercado ----------
// Baloncesto: periodo 0 = partido, 1-2 = mitades, 11-14 = cuartos. Tenis: 21-25 = sets
const BASKET_PERIOD = {
  1: '1.ª mitad', 2: '2.ª mitad', 11: '1.er cuarto', 12: '2.º cuarto', 13: '3.er cuarto', 14: '4.º cuarto',
  21: '1.er set', 22: '2.º set', 23: '3.er set', 24: '4.º set', 25: '5.º set'
};
function basketLabel(type, period, teamName, sport) {
  const pre = BASKET_PERIOD[period] ? `${BASKET_PERIOD[period]} · ` : '';
  const unit = sport === 'tennis' ? 'juegos' : 'puntos';
  switch (type) {
    case 'moneyline': return `${pre}Ganador`;
    case 'spread': return sport === 'tennis' ? `${pre}Hándicap de juegos` : `${pre}Hándicap`;
    case 'total': return `${pre}Total de ${unit}`;
    case 'team_total': return `${pre}${unit === 'juegos' ? 'Juegos' : 'Puntos'} de ${teamName}`;
    default: return type;
  }
}
// "1ª mitad - Hándicap…" → { period: 1, rest: "Hándicap…" }; "1er set - Ganador" → { period: 21, … }
function basketPeriod(title) {
  const t = String(title || '');
  const m = t.match(/^\s*(\d)\s*(?:ª|º|er|o|a)?\s*(mitad|cuarto|tiempo|set)\s*[-·:]?\s*/i);
  if (!m) return { period: 0, rest: t.trim() };
  const n = Number(m[1]);
  return { period: /cuarto/i.test(m[2]) ? 10 + n : /set/i.test(m[2]) ? 20 + n : n, rest: t.slice(m[0].length).trim() };
}
// Fútbol: periodo 0 = partido, 1-2 = mitades (los mismos números que en baloncesto)
function footballLabel(type, period, teamName) {
  const pre = period === 1 || period === 2 ? `${BASKET_PERIOD[period]} · ` : '';
  switch (type) {
    case 'moneyline': return `${pre}Resultado (1X2)`;
    case 'double': return `${pre}Doble oportunidad`;
    case 'dnb': return `${pre}Empate no válido`;
    case 'btts': return `${pre}Ambos marcan`;
    case 'spread': return `${pre}Hándicap asiático`;
    case 'total': return `${pre}Total de goles`;
    case 'team_total': return `${pre}Goles de ${teamName}`;
    case 'corners': return `${pre}Total de córners`;
    case 'cards': return `${pre}Total de tarjetas`;
    default: return type;
  }
}
// Deportes que usan el normalizador por periodos (ganador, hándicap, totales) en vez del de LoL
const PERIOD_SPORTS = ['basket', 'tennis'];
function marketLabel(type, period, teamName, sport) {
  if (sport === 'football') return footballLabel(type, period, teamName);
  if (PERIOD_SPORTS.includes(sport)) return basketLabel(type, period, teamName, sport);
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
  constructor(a, b, sport) { this.a = a; this.b = b; this.sport = sport; this.markets = new Map(); this.books = new Set(); }

  // swapped: la casa pone a los jugadores al revés que nosotros. Sólo en los mercados sueltos de Winamax, donde los marcadores
  // ("6-3", "2 - 0") van en su orden y quien los lee tiene que darles la vuelta
  add({ key, group, period, line, main, outcomes, swapped }, bookmaker, prices) {
    if (!this.markets.has(key)) this.markets.set(key, { key, group, period, line, main: !!main, outcomes: outcomes.map(o => ({ ...o, prices: {} })), ...(swapped ? { swapped: true } : {}) });
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
    const A = a.code || a.name, B = b.code || b.name;
    // Fútbol: el ganador lleva empate (1X2) y hay mercados sin línea (doble oportunidad, empate no válido, ambos marcan)
    const NO_LINE = ['moneyline', 'double', 'dnb', 'btts'];
    let outcomes;
    if (type === 'moneyline' && this.sport === 'football') outcomes = [{ id: 'a', label: A }, { id: 'x', label: 'Empate' }, { id: 'b', label: B }];
    else if (type === 'moneyline' || type === 'dnb') outcomes = [{ id: 'a', label: A }, { id: 'b', label: B }];
    else if (type === 'double') outcomes = [{ id: '1x', label: `${A} o empate` }, { id: '12', label: `${A} o ${B}` }, { id: 'x2', label: `Empate o ${B}` }];
    else if (type === 'btts') outcomes = [{ id: 'yes', label: 'Sí' }, { id: 'no', label: 'No' }];
    else if (type === 'spread') outcomes = [{ id: 'a', label: `${A} ${fmt(line)}` }, { id: 'b', label: `${B} ${fmt(-line)}` }];
    else outcomes = [{ id: 'over', label: `Más de ${line}` }, { id: 'under', label: `Menos de ${line}` }];
    const team = side === 'a' ? a : side === 'b' ? b : null;
    const noLine = NO_LINE.includes(type);
    this.add({
      key: `${type}|${period}|${side || ''}|${noLine ? '' : line}`,
      group: marketLabel(type, period, team ? team.code || team.name : '', this.sport),
      period, line: noLine ? null : line, main, outcomes
    }, bookmaker, prices);
  }

  // MMA: ganador, método (por luchador), llega a decisión y total de asaltos. Claves estables (las usan las recomendaciones y la
  // resolución de apuestas): moneyline|0|| · method|0|<ko|sub|dec>| · distance|0|| · total_rounds|0||<línea>
  addMma(type, kind, line, bookmaker, prices) {
    const A = this.a.name, B = this.b.name;
    const METHOD = { ko: 'KO/TKO', sub: 'sumisión', dec: 'decisión' };
    let outcomes, group;
    if (type === 'moneyline') { outcomes = [{ id: 'a', label: A }, { id: 'b', label: B }]; group = 'Ganador'; }
    else if (type === 'method') { outcomes = [{ id: 'a', label: A }, { id: 'b', label: B }]; group = `Gana por ${METHOD[kind]}`; }
    else if (type === 'distance') { outcomes = [{ id: 'yes', label: 'Sí' }, { id: 'no', label: 'No' }]; group = 'El combate llega a decisión'; }
    else { outcomes = [{ id: 'over', label: `Más de ${line}` }, { id: 'under', label: `Menos de ${line}` }]; group = 'Total de asaltos'; }
    this.add({ key: `${type}|0|${type === 'method' ? kind : ''}|${type === 'total_rounds' ? line : ''}`, group, period: 0, line: type === 'total_rounds' ? line : null, main: true, outcomes }, bookmaker, prices);
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

// ---------- Winamax, baloncesto ----------
// Ganador, hándicap y totales (del partido, de cada mitad y de cada cuarto) van a filas comunes con Betway;
// las líneas de jugador van con la misma clave que usa el analizador (player|estadística|jugador|línea)
// Betway mezcla títulos en español y en inglés ("Player To Get 5+ Rebounds Plus Assists"): se miran los dos
const BASKET_STAT = [
  [/puntos.*(rebotes.*asistencias|asistencias.*rebotes)|pts.*reb.*ast|points.*rebounds.*assists/i, 'Pts + Reb + Ast'],
  [/puntos.*rebotes|points.*rebounds/i, 'Pts + Reb'], [/puntos.*asistencias|points.*assists/i, 'Pts + Ast'],
  [/rebotes.*asistencias|asistencias.*rebotes|rebounds.*assists/i, 'Reb + Ast'],
  [/triples|3 puntos|tres puntos|three/i, 'Triples anotados'], [/rebotes|rebounds/i, 'Rebotes'],
  [/asistencias|assists/i, 'Asistencias'], [/robos.*tapones|tapones.*robos|steals.*blocks/i, 'Robos + Tapones'], [/robos|steals/i, 'Robos'],
  [/tapones|blocks/i, 'Tapones'], [/p[eé]rdidas|turnovers/i, 'Pérdidas'], [/puntos|points/i, 'Puntos']
];
const basketStat = t => (BASKET_STAT.find(([re]) => re.test(t)) || [null, null])[1];
// Clave del jugador en las líneas: sin mayúsculas, espacios de más ni "Jr." (Betway pone "Darius Acuff Jr.", Winamax no)
const playerKey = name => String(name || '').toLowerCase().trim().replace(/\s+(jr|sr|ii|iii|iv)\.?$/, '').trim();
// Una línea de jugador (la clave la comparte con el analizador y el escáner). Las escaleras ("N o más") sólo traen el Más
function addPlayerLine(book, bk, stat, who, line, over, under) {
  const outcomes = [over && { id: 'over', label: `${who.trim()} · Más de ${line}` }, under && { id: 'under', label: `${who.trim()} · Menos de ${line}` }].filter(Boolean);
  if (!outcomes.length) return;
  book.add({ key: `player|${stat}|${playerKey(who)}|${line}`, group: `Jugadores · ${stat}`, period: PLAYER_PERIOD, line, main: true, outcomes },
    bk, { over, under });
}

function winamaxBasketInto(book, match, st, found) {
  const { e, o } = found;
  const m = st.matches?.[e.id];
  if (!m?.bets?.length) return 0;
  const BK = 'Winamax';
  const sideOf = code => ((code === '1') !== o.swapped ? 'a' : 'b');
  const playerName = id => st.players?.[id]?.name || st.players?.[id]?.shortname;
  const teamOf = t => { const sa = teamScore(match.a, t), sb = teamScore(match.b, t); return sa >= 0.6 && sa > sb ? 'a' : sb >= 0.6 && sb > sa ? 'b' : null; };
  let n = 0;
  for (const betId of m.bets) {
    const bet = st.bets?.[betId];
    if (!bet || bet.available === false) continue;
    const outs = (bet.outcomes || []).map(id => ({ ...(st.outcomes?.[id] || {}), id: String(id), price: st.odds?.[id] }))
      .filter(x => x.price > 1 && x.available !== false);
    if (!outs.length) continue;
    const sbv = parseSbv(bet.specialBetValue);
    const title = bet.betTitle || bet.betTypeName || '';
    const { period, rest } = basketPeriod(title);
    const total = num(sbv.total);
    const over = outs.find(x => /^más/i.test(x.label) || x.code === 'over');
    const under = outs.find(x => /^menos/i.test(x.label) || x.code === 'under');
    const pid = outs.find(x => x.playerId)?.playerId;
    const who = pid ? playerName(pid) : null;
    n++;
    const teamPts = /(puntos|juegos) (por|de|ganados por) (.+)$/i.exec(rest);
    const ptsTeam = teamPts ? teamOf(teamPts[3]) : null;
    if (bet.template === '2way' && /^ganador$/i.test(rest) && outs.length === 2) {
      book.addStd('moneyline', period, null, BK, Object.fromEntries(outs.map(x => [sideOf(x.code), x.price])), true);
    } else if (bet.template === 'asian_handicap' && outs.length === 2 && sbv.hcp != null && !/h[aá]ndicap de sets/i.test(rest)) {
      const h = num(sbv.hcp);
      const [c1, c2] = outs;
      book.addStd('spread', period, o.swapped ? -h : h, BK, o.swapped ? { a: c2.price, b: c1.price } : { a: c1.price, b: c2.price }, true);
    } else if ((bet.template === 'OverUnder' || (/\(logros\)/i.test(rest) && over && !under)) && who && total != null) {
      // Más/Menos del jugador y su escalera "(logros)": una apuesta por línea, sólo con el Más
      const stat = basketStat(rest.replace(who, '')) || rest.replace(who, '').replace(/^\s*[-–]\s*|\s*[-–]\s*$/g, '').trim() || 'Jugador';
      addPlayerLine(book, BK, stat, who, total, over?.price, under?.price);
    } else if (bet.template === 'OverUnder' && total != null && over && under && /^(n[uú]mero (total )?de (puntos|juegos)|total (de )?(puntos|juegos))$/i.test(rest)) {
      book.addStd('total', period, total, BK, { over: over.price, under: under.price }, true);
    } else if (bet.template === 'OverUnder' && total != null && over && under && ptsTeam) {
      // "Número total de puntos por R. Madrid": puntos de un equipo
      book.addStd('team_total', period, total, BK, { over: over.price, under: under.price }, true, ptsTeam);
    } else {
      const label = (BASKET_PERIOD[period] ? `${BASKET_PERIOD[period]} · ` : '') + rest + (total != null && !/\d/.test(rest) ? ` (${total})` : '');
      book.add({
        key: `wmx|${title}|${bet.specialBetValue || ''}`, group: label, period: pid ? PLAYER_PERIOD : period || 50, line: total, main: true, swapped: o.swapped,
        outcomes: outs.map(x => ({ id: x.id, label: who && bet.template === 'dynamic' ? `${who} · ${x.label}` : x.label }))
      }, BK, Object.fromEntries(outs.map(x => [x.id, x.price])));
    }
  }
  return n;
}

// ---------- Fútbol (Winamax y Betway) ----------
// 1X2, doble oportunidad, empate no válido, ambos marcan, hándicap asiático y totales (goles del partido y de cada equipo,
// córners y tarjetas) van a filas comunes entre las dos casas; lo demás (resultado exacto, goleadores…) sale como mercado
// propio de cada una. El periodo sale sólo del título ("1ª mitad - …"): la pestaña "1er Tiempo" de Betway repite los
// mercados del partido entero
const STOP_FOOTBALL = /^(tr[ií]o|d[uú]o) goleadores/i; // decenas de combinaciones de goleadores que llenarían el comparador
const PLAYER_FOOTBALL = /goleador|asistente|jugador|remates|paradas|faltas|tarjeta roja|tarjeta amarilla|recibe una o m[aá]s tarjetas|marca \d+ goles|marcador de/i;
const lastNum = s => { const x = String(s || '').match(/([-+]?\d+(?:[.,]\d+)?)\s*$/); return x ? Number(x[1].replace(',', '.')) : null; };
const fbSide = (match, name, min = 0.6) => {
  const sa = teamScore(match.a, name), sb = teamScore(match.b, name);
  return sa >= min && sa > sb ? 'a' : sb >= min && sb > sa ? 'b' : null;
};
// Doble oportunidad por el nombre de la selección: "Italia o empate", "Italia o Francia", "Empate o Eldense"
function doubleId(match, name) {
  const n = String(name || '');
  if (!/empate/i.test(n)) return '12';
  const s = fbSide(match, n.replace(/\s*\bo\s+empate\b|\bempate\s+o\s*/i, '').trim());
  return s === 'a' ? '1x' : s === 'b' ? 'x2' : null;
}
const periodPre = period => (period === 1 || period === 2 ? `${BASKET_PERIOD[period]} · ` : '');

function winamaxFootballInto(book, match, st, found) {
  const { e, o } = found;
  const m = st.matches?.[e.id];
  if (!m?.bets?.length) return 0;
  const BK = 'Winamax';
  const sideOf = code => ((code === '1') !== o.swapped ? 'a' : 'b');
  let n = 0;
  for (const betId of m.bets) {
    const bet = st.bets?.[betId];
    if (!bet || bet.available === false) continue;
    const outs = (bet.outcomes || []).map(id => ({ ...(st.outcomes?.[id] || {}), id: String(id), price: st.odds?.[id] }))
      .filter(x => x.price > 1 && x.available !== false);
    const title = String(bet.betTitle || bet.betTypeName || '').trim();
    if (!outs.length || STOP_FOOTBALL.test(title)) continue;
    const sbv = parseSbv(bet.specialBetValue);
    const { period, rest } = basketPeriod(title); // "1ª mitad - …", "1º Mitad - …"
    const lo = rest.toLowerCase();
    const total = num(sbv.total);
    const code = c => outs.find(x => String(x.code).toLowerCase() === c);
    const over = outs.find(x => /^más/i.test(x.label) || x.code === 'over');
    const under = outs.find(x => /^menos/i.test(x.label) || x.code === 'under');
    const ou = bet.template === 'OverUnder' && total != null && over && under;
    const ouAdd = (type, side) => book.addStd(type, period, total, BK, { over: over.price, under: under.price }, true, side);
    const teamGoals = /^n[uú]mero total de goles (?:marcados )?(?:por|de) (.+)$/i.exec(rest);
    const goalsSide = teamGoals ? fbSide(match, teamGoals[1]) : null;
    n++;
    if (bet.template === '3way' && /^resultado$/.test(lo) && code('1') && code('x') && code('2')) {
      book.addStd('moneyline', period, null, BK, { [sideOf('1')]: code('1').price, x: code('x').price, [sideOf('2')]: code('2').price }, true);
      continue;
    }
    if (/^doble oportunidad$/.test(lo) && outs.length === 3) {
      const p = Object.fromEntries(outs.map(x => [doubleId(match, x.label), x.price]).filter(([id]) => id));
      if (p['1x'] && p['12'] && p.x2) { book.addStd('double', period, null, BK, p, true); continue; }
    }
    if (bet.template === '2way' && /^ganador sin empate/.test(lo) && code('1') && code('2')) {
      book.addStd('dnb', period, null, BK, { [sideOf('1')]: code('1').price, [sideOf('2')]: code('2').price }, true);
      continue;
    }
    if (bet.template === '2way' && /^ambos equipos marcan$/.test(lo)) {
      const yes = outs.find(x => /^s[ií]$/i.test(x.label)), no = outs.find(x => /^no$/i.test(x.label));
      if (yes && no) { book.addStd('btts', period, null, BK, { yes: yes.price, no: no.price }, true); continue; }
    }
    if (ou && /^n[uú]mero total de goles$/.test(lo)) { ouAdd('total'); continue; }
    if (ou && goalsSide) { ouAdd('team_total', goalsSide); continue; }
    if (ou && /^n[uú]mero total de c[oó]rners$/.test(lo)) { ouAdd('corners'); continue; }
    if (ou && /^n[uú]mero total de tarjetas$/.test(lo)) { ouAdd('cards'); continue; }
    if (bet.template === 'asian_handicap' && outs.length === 2 && /^h[aá]ndicap asi[aá]tico/.test(lo)) {
      // "Italia -1.5" / "Francia +1.5": el lado sale del nombre y la línea, del número del final
      const sides = outs.map(x => fbSide(match, String(x.label).replace(/\s*[-+]?\d+(?:[.,]\d+)?\s*$/, '')));
      const ia = sides.indexOf('a'), ib = sides.indexOf('b');
      const h = ia >= 0 ? lastNum(outs[ia].label) : null;
      if (ia >= 0 && ib >= 0 && h != null) { book.addStd('spread', period, h, BK, { a: outs[ia].price, b: outs[ib].price }, true); continue; }
    }
    const label = periodPre(period) + rest + (total != null && !/\d/.test(rest) ? ` (${total})` : '');
    book.add({
      key: `wmx|${title}|${bet.specialBetValue || ''}`, group: label,
      period: PLAYER_FOOTBALL.test(rest) || outs.some(x => x.playerId) ? PLAYER_PERIOD : period || 50, line: total, main: true,
      outcomes: outs.map(x => ({ id: x.id, label: x.label }))
    }, BK, Object.fromEntries(outs.map(x => [x.id, x.price])));
  }
  return n;
}

function betwayFootballInto(book, imp, match) {
  const BK = BOOK_LABEL[imp.book];
  const players = /marketGroup=players\b/.test(imp.page || '');
  const lineOf = o => { const v = lastNum(o.hcap); return v == null ? null : v; };
  const isOU = o => /^(m[aá]s|menos|over|under)/i.test(o.name);
  const overOf = o => /^(m[aá]s|over)/i.test(o.name);
  let n = 0;
  for (const mk of imp.markets || []) {
    const outs = (mk.outcomes || []).filter(o => o.price > 1);
    if (!outs.length) continue;
    const { period, rest } = basketPeriod(mk.title);
    const lo = rest.toLowerCase().trim();
    const ou = outs.every(isOU) && outs.every(o => lineOf(o) != null);
    // Una fila por línea: "Más de / O 2.5" con "Menos de / U 2.5"
    const ouAdd = (type, side) => {
      for (const l of [...new Set(outs.map(o => Math.abs(lineOf(o))))]) {
        const ov = outs.find(o => overOf(o) && Math.abs(lineOf(o)) === l), un = outs.find(o => !overOf(o) && Math.abs(lineOf(o)) === l);
        if (ov || un) book.addStd(type, period, l, BK, { over: ov?.price, under: un?.price }, true, side);
      }
    };
    const teamPre = /^(.+?)\s+(goles|c[oó]rners) en total$/i.exec(rest);
    const preSide = teamPre ? fbSide(match, teamPre[1], 0.8) : null;
    n++;
    if (/^1-x-2$/.test(lo) && outs.length === 3) {
      const p = Object.fromEntries(outs.map(o => [/^empate$/i.test(o.name) ? 'x' : fbSide(match, o.name, 0.8), o.price]).filter(([s]) => s));
      if (p.a && p.x && p.b) { book.addStd('moneyline', period, null, BK, p, true); continue; }
    }
    if (/^doble oportunidad$/.test(lo) && outs.length === 3) {
      const p = Object.fromEntries(outs.map(o => [doubleId(match, o.name), o.price]).filter(([id]) => id));
      if (p['1x'] && p['12'] && p.x2) { book.addStd('double', period, null, BK, p, true); continue; }
    }
    if (/^(apuesta sin posibilidad de empate|empate no v[aá]lido)$/.test(lo) && outs.length === 2) {
      const p = Object.fromEntries(outs.map(o => [fbSide(match, o.name, 0.8), o.price]).filter(([s]) => s));
      if (p.a && p.b) { book.addStd('dnb', period, null, BK, p, true); continue; }
    }
    if (/^ambos equipos marcan$/.test(lo)) {
      const yes = outs.find(o => /^s[ií]$/i.test(o.name)), no = outs.find(o => /^no$/i.test(o.name));
      if (yes && no) { book.addStd('btts', period, null, BK, { yes: yes.price, no: no.price }, true); continue; }
    }
    if (ou && /^goles en total$/.test(lo)) { ouAdd('total'); continue; }
    if (ou && teamPre && /^goles$/i.test(teamPre[2]) && preSide) { ouAdd('team_total', preSide); continue; }
    if (ou && /^c[oó]rners en total$/.test(lo)) { ouAdd('corners'); continue; }
    if (ou && /^(tarjetas en total|total de tarjetas)$/.test(lo)) { ouAdd('cards'); continue; }
    if (/^h[aá]ndicap asi[aá]tico$/.test(lo)) {
      const sides = outs.map(o => fbSide(match, o.name, 0.8));
      let any = false;
      for (const oa of outs.filter((x, i) => sides[i] === 'a')) {
        const h = lineOf(oa);
        const ob = outs.find((x, i) => sides[i] === 'b' && h != null && lineOf(x) === -h);
        if (h != null && ob) { book.addStd('spread', period, h, BK, { a: oa.price, b: ob.price }, true); any = true; }
      }
      if (any) continue;
    }
    // Mercado propio de Betway: resultado exacto, hándicap a 3 formas, córners de un equipo…
    const label = periodPre(period) + rest.charAt(0).toUpperCase() + rest.slice(1); // sin sentence(): bajaría los nombres de equipo
    const per = players || PLAYER_FOOTBALL.test(rest) ? PLAYER_PERIOD : period || 50;
    if (ou) {
      for (const l of [...new Set(outs.map(o => Math.abs(lineOf(o))))]) {
        const at = outs.filter(o => Math.abs(lineOf(o)) === l);
        book.add({
          key: `${imp.book}|${mk.title}|${l}`, group: label, period: per, line: l, main: true,
          outcomes: at.map(o => ({ id: overOf(o) ? 'over' : 'under', label: `${overOf(o) ? 'Más' : 'Menos'} de ${l}` }))
        }, BK, Object.fromEntries(at.map(o => [overOf(o) ? 'over' : 'under', o.price])));
      }
    } else {
      book.add({
        key: `${imp.book}|${mk.title}|${mk.line || ''}`, group: label, period: per, line: null, main: true,
        outcomes: outs.map((o, i) => ({ id: String(i), label: o.hcap && !/^[OU]\s/.test(o.hcap) && o.hcap !== o.name ? `${o.name} ${o.hcap}` : o.name }))
      }, BK, Object.fromEntries(outs.map((o, i) => [String(i), o.price])));
    }
  }
  return n;
}

// ---------- MMA (Winamax y Betway) ----------
// Ganador, método de victoria de cada luchador, "llega a decisión" y total de asaltos van a filas comunes entre las dos casas;
// lo demás (asalto exacto, doble oportunidad, método y ronda…) sale como mercado propio de cada una
// Nombre y apellido (o su inicial): "Silva" solo no basta, hay muchos luchadores con el mismo apellido
const mmaSide = (match, name) => {
  const sa = mentions(match.a.name, name), sb = mentions(match.b.name, name);
  return sa && !sb ? 'a' : sb && !sa ? 'b' : null;
};
const mmaKind = s => (/sumisi|submission/i.test(s) ? 'sub' : /decisi|puntos/i.test(s) ? 'dec' : /\bko\b|tko|descalific|dsq/i.test(s) ? 'ko' : null);

function winamaxMmaInto(book, match, st, found) {
  const { e, o } = found;
  const m = st.matches?.[e.id];
  if (!m?.bets?.length) return 0;
  const BK = 'Winamax';
  const sideOf = code => ((code === '1') !== o.swapped ? 'a' : 'b');
  let n = 0;
  for (const betId of m.bets) {
    const bet = st.bets?.[betId];
    if (!bet || bet.available === false) continue;
    const outs = (bet.outcomes || []).map(id => ({ ...(st.outcomes?.[id] || {}), id: String(id), price: st.odds?.[id] }))
      .filter(x => x.price > 1 && x.available !== false);
    if (!outs.length) continue;
    const title = String(bet.betTitle || bet.betTypeName || '').trim();
    const lo = title.toLowerCase();
    const total = num(parseSbv(bet.specialBetValue).total);
    const over = outs.find(x => /^más/i.test(x.label) || x.code === 'over');
    const under = outs.find(x => /^menos/i.test(x.label) || x.code === 'under');
    n++;
    if (/^ganador$/.test(lo) && outs.length === 2 && outs.every(x => x.code === '1' || x.code === '2')) {
      book.addMma('moneyline', '', null, BK, Object.fromEntries(outs.map(x => [sideOf(x.code), x.price])));
      continue;
    }
    if (/^n[uú]mero total de asaltos$/.test(lo) && bet.template === 'OverUnder' && total != null && over && under) {
      book.addMma('total_rounds', '', total, BK, { over: over.price, under: under.price });
      continue;
    }
    if (/^el combate llegar[aá] al final$/.test(lo)) {
      const yes = outs.find(x => /^s[ií]$/i.test(x.label)), no = outs.find(x => /^no$/i.test(x.label));
      if (yes && no) { book.addMma('distance', '', null, BK, { yes: yes.price, no: no.price }); continue; }
    }
    if (/^ganador y m[eé]todo de victoria$/.test(lo)) {
      const byKind = {};
      for (const x of outs) {
        const side = mmaSide(match, String(x.label).replace(/\s+gana por.*$/i, '')), kind = mmaKind(x.label);
        if (side && kind) (byKind[kind] ||= {})[side] = x.price;
      }
      for (const [kind, p] of Object.entries(byKind)) book.addMma('method', kind, null, BK, p);
      if (Object.keys(byKind).length) continue;
    }
    book.add({
      key: `wmx|${title}|${bet.specialBetValue || ''}`, group: title + (total != null && !/\d/.test(title) ? ` (${total})` : ''), period: 50, line: total, main: true,
      outcomes: outs.map(x => ({ id: x.id, label: x.label }))
    }, BK, Object.fromEntries(outs.map(x => [x.id, x.price])));
  }
  return n;
}

function betwayMmaInto(book, imp, match) {
  const BK = BOOK_LABEL[imp.book];
  const markets = imp.markets || [];
  // Sin el ganador con los dos luchadores del combate, la página es de otro combate (un sustituto, otra pelea): no se mezcla
  const win = markets.find(mk => /^ganador del combate$/i.test(mk.title));
  const sides = (win?.outcomes || []).map(x => mmaSide(match, x.name));
  if (!sides.includes('a') || !sides.includes('b')) return 0;
  let n = 0;
  for (const mk of markets) {
    const outs = (mk.outcomes || []).filter(x => x.price > 1);
    if (!outs.length) continue;
    const title = String(mk.title || '').trim(), lo = title.toLowerCase();
    n++;
    if (mk === win) {
      book.addMma('moneyline', '', null, BK, Object.fromEntries(outs.map(x => [mmaSide(match, x.name), x.price]).filter(([s]) => s)));
      continue;
    }
    const tr = /^total de asaltos\s*-\s*(\d+(?:[.,]\d+)?)$/.exec(lo);
    if (tr) {
      const line = Number(tr[1].replace(',', '.'));
      const ov = outs.find(x => /^(m[aá]s|over)/i.test(x.name)), un = outs.find(x => /^(menos|under)/i.test(x.name));
      if (ov || un) { book.addMma('total_rounds', '', line, BK, { over: ov?.price, under: un?.price }); continue; }
    }
    if (/^el combate terminar[aá] en empate o se decidir[aá] por puntos$/.test(lo)) {
      const yes = outs.find(x => /^s[ií]$/i.test(x.name)), no = outs.find(x => /^no$/i.test(x.name));
      if (yes && no) { book.addMma('distance', '', null, BK, { yes: yes.price, no: no.price }); continue; }
    }
    if (/^m[eé]todo de victoria$/.test(lo)) {
      const byKind = {};
      for (const x of outs) {
        const side = mmaSide(match, x.name), kind = mmaKind(x.name);
        if (side && kind) (byKind[kind] ||= {})[side] = x.price;
      }
      for (const [kind, p] of Object.entries(byKind)) book.addMma('method', kind, null, BK, p);
      if (Object.keys(byKind).length) continue;
    }
    book.add({
      key: `${imp.book}|${title}|${mk.line || ''}`, group: title, period: 50, line: null, main: true,
      outcomes: outs.map((x, i) => ({ id: String(i), label: x.hcap && !/^[OU]\s/.test(x.hcap) && x.hcap !== x.name ? `${x.name} ${x.hcap}` : x.name }))
    }, BK, Object.fromEntries(outs.map((x, i) => [String(i), x.price])));
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
  // Baloncesto: el periodo sale del título ("1ª mitad - …") o de la pestaña (marketGroup=1st-half, quarter…)
  const basket = PERIOD_SPORTS.includes(book.sport); // baloncesto y tenis
  const pagePeriod = basket ? (/marketGroup=(1st-half|half)\b/.test(imp.page || '') ? 1 : /marketGroup=(1st-quarter|quarter)\b/.test(imp.page || '') ? 11 : 0) : 0;
  for (const mk of imp.markets || []) {
    let period = mk.map || 0;
    let rest = mk.title.replace(/^(mapa\s*\d+|\d\s*º\s*mapa)\s*[-·:]\s*/i, '').trim(); // "Mapa 1 - " (Betway), "1º mapa - " (Bet365)
    if (basket) {
      const bp = basketPeriod(mk.title.replace(/^1er tiempo\s*[-·:]\s*/i, '1ª mitad - '));
      period = bp.period || pagePeriod;
      rest = bp.rest.replace(/^otros\s+/i, '');
    }
    // Tenis: "Brandon Nakashima 1er Set Juegos en total" lleva el set en medio del título
    const inner = book.sport === 'tennis' && !period ? /(\d)\s*(?:er|º|ª|o)?\s*set\b/i.exec(rest) : null;
    if (inner) { period = 20 + Number(inner[1]); rest = rest.replace(inner[0], '').replace(/\s+/g, ' ').trim(); }
    const lo = rest.toLowerCase();
    const outs = (mk.outcomes || []).filter(o => o.price > 1);
    if (!outs.length) continue;
    // Baloncesto en Betway: escaleras de jugador ("Jugador anota 2 triples o más", "Player To Get 5+ Rebounds"), una
    // selección por jugador. "N o más" es Más de N - 0,5: van a las mismas líneas que el Más/Menos de Winamax
    const ladder = book.sport === 'basket' && !period && /^(?:jugador\s+\S+|player to get)\s+(\d+)\+?\s+(.+?)(?:\s+o\s+m[aá]s)?$/i.exec(rest);
    const ladderStat = ladder ? basketStat(ladder[2]) : null;
    if (ladder && ladderStat && outs.every(o => !side(o.name))) {
      for (const o of outs) addPlayerLine(book, BK, ladderStat, o.name, Number(ladder[1]) - 0.5, o.price);
      n++;
      continue;
    }
    // Más/Menos de un jugador en Betway: "Bobby Portis Puntos + Rebotes", "Bam Adebayo Rebounds Plus Assists"
    const propOf = book.sport === 'basket' && !period
      && /^(.+?)\s+((?:puntos|rebotes|asistencias|triples|robos|tapones|p[eé]rdidas|points|rebounds|assists|three|steals|blocks|turnovers)\b.*)$/i.exec(rest);
    const propStat = propOf && !mentions(propOf[1]) && !/total|mitad|cuarto|equipo|partido|margen|jugador/i.test(propOf[1]) ? basketStat(propOf[2]) : null;
    if (propStat && outs.every(o => /^(m[aá]s|menos|over|under)/i.test(o.name))) {
      for (const l of [...new Set(outs.map(lineOf).filter(v => v != null).map(Math.abs))]) {
        const ov = outs.find(o => /^(m[aá]s|over)/i.test(o.name) && Math.abs(lineOf(o)) === l), un = outs.find(o => /^(menos|under)/i.test(o.name) && Math.abs(lineOf(o)) === l);
        addPlayerLine(book, BK, propStat, propOf[1], l, ov?.price, un?.price);
      }
      n++;
      continue;
    }
    const sides = outs.map(o => side(o.name));
    const ou = outs.every(o => /^(m[aá]s|menos|over|under)/i.test(o.name));
    const overOf = o => /^(m[aá]s|over)/i.test(o.name);
    const label = basket ? (BASKET_PERIOD[period] ? `${BASKET_PERIOD[period]} · ` : '') + sentence(rest) : period ? `Mapa ${period} · ${sentence(rest)}` : sentence(rest);
    n++;
    // En baloncesto y tenis sólo cuenta como ganador el mercado que se llama así ("Ganará un set" no lo es)
    const isWinner = basket ? /^(ganador( del partido)?( \(pr[oó]rroga incluida\))?|moneyline)$/.test(lo) : /ganador|ganar[aá]|vencedor|resultado del partido|moneyline/.test(lo);
    if (outs.length === 2 && sides[0] && sides[1] && sides[0] !== sides[1] && isWinner && !OBJ.test(lo)) {
      book.addStd('moneyline', period, null, BK, { [sides[0]]: outs[0].price, [sides[1]]: outs[1].price }, true);
    } else if (/h[aá]ndicap/.test(lo) && !/h[aá]ndicap de sets?/.test(lo) && sides.every(Boolean) && !OBJ.test(lo)) {
      // Pares (equipo A con línea h, equipo B con -h)
      for (const oa of outs.filter((o, i) => sides[i] === 'a')) {
        const h = lineOf(oa);
        const ob = outs.find((o, i) => sides[i] === 'b' && lineOf(o) === (h == null ? null : -h));
        if (h != null && ob) book.addStd('spread', period, h, BK, { a: oa.price, b: ob.price }, true);
      }
    } else if (ou && /total/.test(lo) && /kills|mapas|asesinatos|v[ií]ctimas|puntos|juegos/.test(lo) && !(basket ? /par|impar|victoria/.test(lo) : OBJ.test(lo))) {
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
  const football = book.sport === 'football', mma = book.sport === 'mma';
  if (imp.book === 'winamax') {
    const o = orient(match.a, match.b, imp.home, imp.away) || { swapped: false, score: 0 };
    // En MMA un combate cambiado (sustituto, otra pelea) no se lee como el de la app: los dos luchadores tienen que ser los mismos
    if (mma) {
      const direct = mentions(match.a.name, imp.home) && mentions(match.b.name, imp.away);
      const swap = !direct && mentions(match.a.name, imp.away) && mentions(match.b.name, imp.home);
      return direct || swap ? winamaxMmaInto(book, match, imp.state, { e: { id: imp.matchId }, o: { swapped: swap, score: 2 } }) : 0;
    }
    const into = football ? winamaxFootballInto : PERIOD_SPORTS.includes(book.sport) ? winamaxBasketInto : winamaxInto;
    return into(book, match, imp.state, { e: { id: imp.matchId }, o });
  }
  if (football) return betwayFootballInto(book, imp, match);
  if (mma) return betwayMmaInto(book, imp, match);
  return sectionsInto(book, imp) + marketsInto(book, imp, match);
}

// Betway devuelve la página del partido entero cuando se le pide una pestaña que ese partido no tiene (en la NBL no hay
// "1st-half": su mitad está en "half"), y como el periodo sale de la pestaña, las líneas del partido pasaban por las de la
// 1.ª mitad. Esa copia se descarta si tiene los mismos mercados (título y línea) que una página del mismo trabajo sin periodo
const PERIOD_TAB = /marketGroup=(1st-half|half|1st-quarter|quarter)\b/;
const marketsPrint = imp => JSON.stringify((imp.markets || []).map(m => [m.title, m.line]));
const isPeriodCopy = (imp, all) => imp.book === 'betway' && PERIOD_TAB.test(imp.page || '') && !!imp.markets?.length
  && all.some(o => o !== imp && o.id !== imp.id && o.book === 'betway' && o.job === imp.job && !PERIOD_TAB.test(o.page || '') && marketsPrint(o) === marketsPrint(imp));

// match = { a: {name, code}, b: {name, code}, start }
async function getMatchOdds(match) {
  const all = await bridge.forMatch(match);
  const imports = all.filter(imp => !isPeriodCopy(imp, all));
  const book = new Book(match.a, match.b, match.sport || imports.find(i => i.sport)?.sport);
  const sources = {}, counts = {};
  for (const imp of imports) {
    const name = BOOK_LABEL[imp.book];
    try {
      const n = intoBook(book, match, imp);
      // Una casa puede llegar en varias páginas (pestañas): se suman
      const prev = counts[name] || { n: 0, ts: 0 };
      counts[name] = { n: prev.n + n, ts: Math.max(prev.ts, imp.ts) };
      const mins = Math.round((Date.now() - counts[name].ts) / 60e3);
      sources[name] = { ok: counts[name].n > 0, ts: counts[name].ts, msg: `${counts[name].n} mercados · enviadas hace ${mins} min` };
    } catch (e) { if (!sources[name]?.ok) sources[name] = { ok: false, msg: e.message }; }
  }
  return book.result(sources);
}

// Tras guardar una importación: cuota de ganador (para las tarjetas del calendario) e histórico de cuotas.
// En el histórico sólo se apunta una cuota cuando cambia, para que la tabla no crezca sin control.
async function afterImport(match, imp) {
  // La copia de la página del partido en una pestaña de periodo apuntaría en el histórico líneas del partido como de la mitad
  if (imp.book === 'betway' && PERIOD_TAB.test(imp.page || '') && isPeriodCopy(imp, await bridge.forMatch(match))) return;
  const book = new Book(match.a, match.b, imp.sport);
  intoBook(book, match, imp);
  const ml = book.markets.get('moneyline|0||');
  const price = id => ml?.outcomes.find(x => x.id === id)?.prices[BOOK_LABEL[imp.book]];
  // En fútbol va también el empate (x)
  if (price('a') && price('b')) await bridge.setMoneyline(imp.id, { a: price('a'), b: price('b'), ...(price('x') ? { x: price('x') } : {}) });
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

module.exports = { getMatchOdds, getBoardFor, afterImport, orient, winamaxInto, Book, intoBook };
