'use strict';
// Leer el ticket de una casa (Winamax, bet365…) a partir del texto de su captura (lo saca ocr.js) y convertirlo en una apuesta
// de la app enlazada a su partido (ref), como si se hubiera apuntado desde el cupón: así sale en «Tus apuestas» y se resuelve sola.
// Todo es puro: los partidos candidatos llegan de fuera (index.js los pide a cada servicio). Nada se guarda aquí: se devuelve un
// borrador que el usuario revisa. El OCR se equivoca a veces (un 8 por un 6, «19 cuarto» por «1º cuarto», «B05» por «BOS»), así
// que todo se compara de forma aproximada y lo que no se reconoce se deja sin enlazar en vez de adivinar.

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const round2 = x => Math.round(x * 100) / 100;
const num = s => Number(String(s).replace(/\s/g, '').replace(',', '.'));
// Sin acentos ni mayúsculas, sólo letras, cifras y espacios
const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();
// Palabras del texto, con los errores típicos del OCR en las que mezclan letras y cifras ("b05" → "bos")
const tokensOf = s => plain(s).split(' ').filter(Boolean).map(t => (/[a-z]/.test(t) && /\d/.test(t) ? t.replace(/0/g, 'o').replace(/5/g, 's').replace(/1/g, 'l') : t));

// Cuota: dos decimales, que no sea dinero ni una línea ("Más de 214,5" lleva uno)
const ODDS = /(?:^|[\s[(|])(\d{1,3}[.,]\d{2})(?![\d€]|\s*€)/g;
const OU = /\b(m[aá]s|menos)\s+de\s+(\d+(?:[.,]\d+)?)/i;
const FOOTER = /^(importe|imp:|ganancias|cuota total|ref:|completar|cerrar apuesta|reutilizar|apuesta cerrada)/i;

// ---------- Equipos ----------
// Los nombres con los que puede salir un equipo o jugador en un ticket: el entero, la abreviatura, los otros nombres y, en
// baloncesto, el apodo ("Kings"); en tenis y MMA, el apellido
// En fútbol, las palabras propias del nombre («Celta de Vigo» → "celta"; ESPN puede llamarlo «Celta Vigo»), sin las que comparten
// muchos clubes
const COMMON = new Set(['real', 'club', 'atletico', 'athletic', 'sporting', 'deportivo', 'united', 'city', 'union', 'balompie', 'football', 'calcio']);
function aliasesOf(side, sport) {
  const list = [side.name, side.short, side.abbr, ...(side.alt || []), ...(side.alts || [])].filter(Boolean);
  const words = plain(side.name).split(' ');
  if ((sport === 'basket' || sport === 'tennis' || sport === 'mma') && words.length > 1 && words.at(-1).length >= 4) list.push(words.at(-1));
  if (sport === 'football') list.push(...words.filter(w => w.length >= 5 && !COMMON.has(w)));
  return [...new Set(list.map(plain).filter(a => a.length >= 3))]; // las de dos letras («NO», «SA») son palabras corrientes
}
// ¿Qué lado nombra un texto corto («I. Montes de la Torr», cortado por la casa)? Por las palabras de 4 letras o más del nombre,
// enteras o por su principio
function fuzzySide(text, G) {
  const toks = tokensOf(text).filter(t => t.length >= 4);
  const score = side => plain(side.name).split(' ').filter(w => w.length >= 4 && !COMMON.has(w) && toks.some(t => w === t || w.startsWith(t))).length;
  const a = score(G.a), b = score(G.b);
  return a && !b ? 'a' : b && !a ? 'b' : null;
}
// ¿Sale este nombre en el texto? Palabras enteras; un nombre de 5 letras o más también pegado a otra ("SACKings")
function mentions(aliases, text) {
  const toks = tokensOf(text), joined = ` ${toks.join(' ')} `;
  return aliases.some(a => (a.includes(' ') ? joined.includes(` ${a} `)
    : toks.includes(a) || (a.length >= 5 && toks.some(t => t.length > a.length && (t.endsWith(a) || t.startsWith(a))))));
}

// Un partido de un servicio, con a y b orientados como sus claves de mercado (baloncesto: visitante y local; fútbol: local y
// visitante; tenis y MMA: como vienen)
function gameOf(sport, g) {
  if (sport === 'basket') return { sport, id: g.id, start: g.date, league: String(g.league || '').toUpperCase().replace('EUROLEAGUE', 'Euroliga').replace('EUROCUP', 'EuroCup'), a: g.away, b: g.home, event: `${g.away.abbr} @ ${g.home.abbr}` };
  if (sport === 'football') return { sport, id: g.id, start: g.date, league: g.leagueName || '', a: g.home, b: g.away, event: `${g.home.name} - ${g.away.name}` };
  if (sport === 'tennis') return { sport, id: g.id, start: g.date, league: g.tournament || '', a: g.a, b: g.b, event: `${g.a.name} - ${g.b.name}` };
  if (sport === 'mma') return { sport, id: g.id, start: g.date, league: g.orgName || '', a: g.a, b: g.b, event: `${g.a.name} vs ${g.b.name}` };
  return null;
}

// Los partidos que salen en el ticket (con los dos equipos) y la línea donde está cada uno
function findGames(lines, games, placedAt) {
  const found = [];
  for (const G of games) {
    const A = aliasesOf(G.a, G.sport), B = aliasesOf(G.b, G.sport);
    const la = [], lb = [];
    lines.forEach((l, i) => { if (mentions(A, l)) la.push(i); if (mentions(B, l)) lb.push(i); });
    if (!la.length || !lb.length) continue;
    const both = la.find(i => lb.includes(i));
    found.push({ G, A, B, at: both ?? Math.min(la[0], lb[0]) });
  }
  // Si el OCR se ha comido un equipo («BOS Celtics» leído como "BETA"), vale el partido de un solo equipo nombrado entero o por
  // su apodo (no por la abreviatura, que es corta y sale en cualquier sitio), y se avisa (partial)
  // Con un solo equipo, un apodo lo comparten varios («Kings»: Sacramento y Sydney): gana el que tiene más nombres suyos en el
  // ticket («SAC Kings»: la abreviatura y el apodo), y si empatan dos equipos distintos no se elige ninguno
  if (!found.length) {
    const all = lines.join(' ');
    const one = [];
    for (const G of games) {
      const A = aliasesOf(G.a, G.sport), B = aliasesOf(G.b, G.sport);
      const strong = list => list.filter(a => a.length >= 4);
      const la = lines.findIndex(l => mentions(strong(A), l)), lb = lines.findIndex(l => mentions(strong(B), l));
      if ((la < 0) === (lb < 0)) continue;
      const side = la >= 0 ? A : B;
      one.push({ G, A, B, at: la >= 0 ? la : lb, partial: (la >= 0 ? G.a : G.b).name, score: side.filter(a => mentions([a], all)).length });
    }
    const top = Math.max(0, ...one.map(f => f.score));
    const best = one.filter(f => f.score === top);
    // Al menos dos nombres suyos (el entero o la abreviatura, más el apodo): un apodo suelto no basta
    if (top >= 2 && new Set(best.map(f => plain(f.partial))).size === 1) found.push(...best);
  }
  // El mismo cruce en dos días: el más cercano a cuando se hizo la apuesta
  const best = new Map();
  for (const f of found) {
    const k = f.partial ? `1|${plain(f.partial)}` : [plain(f.G.a.name), plain(f.G.b.name)].sort().join('|');
    const d = Math.abs(+new Date(f.G.start) - placedAt);
    if (!best.has(k) || d < best.get(k).d) best.set(k, { ...f, d });
  }
  return [...best.values()].sort((x, y) => x.at - y.at);
}

// ---------- Mercados ----------
const PERIOD_NAME = { 1: '1.ª mitad', 2: '2.ª mitad', 11: '1.er cuarto', 12: '2.º cuarto', 13: '3.er cuarto', 14: '4.º cuarto' };
// "1º cuarto", "19 cuarto" (el OCR lee la º como un 9), "1ª mitad", "2.ª parte"
function periodOf(text) {
  let m = /\b([1-4])\s*[º°ª9o]?\s*(?:\.?\s*er\s*)?cuarto/i.exec(text);
  if (m) return 10 + Number(m[1]);
  m = /\b([12])\s*[º°ª9a]?\s*(?:mitad|parte|tiempo)/i.exec(text);
  return m ? Number(m[1]) : 0;
}

// Estadísticas de jugador: las palabras de las casas → el nombre de la app (PLAYER_STAT de settle.js)
const STAT_WORD = [[/puntos/, 'pts'], [/rebotes/, 'reb'], [/asistencias/, 'ast'], [/triples/, '3pm'], [/robos/, 'stl'], [/tapones/, 'blk'], [/p[eé]rdidas/, 'tov']];
const STAT_NAME = {
  pts: 'Puntos', reb: 'Rebotes', ast: 'Asistencias', '3pm': 'Triples anotados', stl: 'Robos', blk: 'Tapones', tov: 'Pérdidas',
  'ast+pts+reb': 'Pts + Reb + Ast', 'pts+reb': 'Pts + Reb', 'ast+pts': 'Pts + Ast', 'ast+reb': 'Reb + Ast', 'blk+stl': 'Robos + Tapones'
};
function statOf(words) {
  const got = STAT_WORD.filter(([re]) => re.test(words.toLowerCase())).map(([, k]) => k).sort();
  return STAT_NAME[got.join('+')] || null;
}
const cleanName = s => String(s || '').replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
const fmtLine = l => String(l);
const signed = l => (l > 0 ? `+${l}` : `${l}`);

// Fútbol, jugador: lo que dice bet365 («Courtois - Más de 2.5» + «Paradas del portero»; «Iglesias - 1+ faltas cometidas») → el
// título de los mercados de Winamax que entiende la resolución (FOOTBALL_COUNT y evaluateFootballPlayer de settle.js), con el
// jugador como selección
function footballPlayer(t, sub) {
  let m = /^(.+?)\s+ser[aá] amonestad[oa]/i.exec(t);
  if (m) return { who: cleanName(m[1]), title: 'El jugador recibe una o más tarjetas' };
  m = /^(.+?)\s+-\s*(?:(\d+)\s*\+\s*(.*)|m[aá]s de (\d+(?:[.,]\d+)?)\s*(.*))$/i.exec(t);
  if (!m) return null;
  const who = cleanName(m[1]);
  const n = m[2] ? Number(m[2]) : Math.floor(num(m[4])) + 1; // «Más de 2.5» = 3 o más
  const what = `${m[3] || m[5] || ''} ${sub || ''}`.toLowerCase();
  if (!(n >= 1) || who.length < 4 || /^jugador$/i.test(who)) return null;
  if (/paradas/.test(what)) return { who, title: `Realiza ${n} o más paradas` };
  if (/(remates|tiros) a puerta/.test(what)) return { who, title: `Realiza ${n} o más remates a puerta` };
  if (/remates|tiros/.test(what)) return { who, title: `Realiza ${n} o más remates` };
  if (/faltas (cometidas|concedidas)/.test(what)) return { who, title: `Comete ${n} o más faltas` };
  if (/faltas recibidas/.test(what)) return { who, title: `Recibe ${n} o más faltas` };
  if (/goles|marca/.test(what)) return { who, title: n === 1 ? 'Goleador' : `Marca ${n} goles o más` };
  return null;
}

// El texto de una selección → { key, out, market, selection } con las claves de odds.js, o null si no se reconoce.
// sub: la línea de debajo en bet365 («Paradas del portero - Otras opciones»), que dice de qué es
function marketOf(text, G, A, B, sub = '') {
  let t = cleanName(text);
  // bet365 a veces sólo pone «Más de 4.5» y debajo de qué («Total de goles», «1ª mitad - Total de tarjetas»): se le añade la
  // unidad (y el equipo, si el subtítulo nombra a uno) para que lo reconozcan las reglas de abajo
  if (sub && /^(m[aá]s|menos) de \d+(?:[.,]\d+)?$/i.test(t)) {
    const u = /tarjetas/i.test(sub) ? 'tarjetas' : /c[oó]rners|saques de esquina/i.test(sub) ? 'córners' : /goles/i.test(sub) ? 'goles'
      : /puntos/i.test(sub) ? 'puntos' : /juegos/i.test(sub) ? 'juegos' : '';
    const a = mentions(A, sub), b = mentions(B, sub);
    if (u) t = `${t} ${u}${a !== b ? ` de ${(a ? G.a : G.b).name}` : ''}`;
  }
  const period = periodOf(t) || periodOf(sub);
  const pre = PERIOD_NAME[period] ? `${PERIOD_NAME[period]} · ` : '';
  const ou = OU.exec(t);
  const over = ou ? /^m[aá]s$/i.test(ou[1]) : null, line = ou ? num(ou[2]) : null;
  const sideIn = s => { const a = mentions(A, s), b = mentions(B, s); return a && !b ? 'a' : b && !a ? 'b' : fuzzySide(s, G); };

  if (G.sport === 'football') {
    const p = footballPlayer(t, sub);
    if (p) return { key: `wmx|${p.title}|`, out: 'yes', market: p.title, selection: p.who };
    // «Ambos equipos recibirán 2 tarjetas o más» (bet365): cards_both, que resuelve settle.js con las tarjetas de cada uno
    const both = /^ambos equipos recibir[aá]n (\d+) (?:tarjetas o m[aá]s|o m[aá]s tarjetas)/i.exec(t);
    if (both) return { key: `cards_both|0||${both[1]}`, out: 'yes', market: `Ambos equipos con ${both[1]} tarjetas o más`, selection: 'Sí' };
    // «Más de 5 tarjetas» (bet365, «Crear apuesta»): sin medio punto es 6 o más, que ahí no hay nulas
    const c = /^(m[aá]s|menos) de (\d+(?:[.,]\d+)?)\s+(tarjetas|c[oó]rners|saques de esquina)/i.exec(t);
    if (c) {
      const ov = /^m[aá]s/i.test(c[1]), raw = num(c[2]), l = Number.isInteger(raw) ? raw + (ov ? 0.5 : -0.5) : raw;
      const type = /tarjetas/i.test(c[3]) ? 'cards' : 'corners';
      return { key: `${type}|0||${l}`, out: ov ? 'over' : 'under', market: type === 'cards' ? 'Total de tarjetas' : 'Total de córners', selection: `${ov ? 'Más' : 'Menos'} de ${fmtLine(l)}` };
    }
  }
  const label = x => x.abbr || x.short || x.name;
  const unit = G.sport === 'football' ? 'goles' : G.sport === 'tennis' ? 'juegos' : 'puntos';

  if (G.sport === 'basket') {
    // bet365: "Domantas Sabonis - 17+ rebotes" (17 o más: más de 16,5)
    let m = /^(.+?)\s+-\s+(\d+)\s*\+\s*([a-záéíóúñ ]+?)(?:\s+\d|$)/i.exec(t);
    if (m && statOf(m[3]) && !/h[aá]ndicap|cuarto|mitad/i.test(m[1])) {
      const stat = statOf(m[3]), who = cleanName(m[1]), l = Number(m[2]) - 0.5;
      return { key: `player|${stat}|${who.toLowerCase()}|${l}`, out: 'over', market: `${stat} · ${who}`, selection: `Más de ${fmtLine(l)}` };
    }
    // Winamax: "Total del jugador (asistencias + rebotes) (logros) - Danny Wolf" + "Más de 5,5"
    m = /jugador\s*\(([^)]*)\)/i.exec(t);
    if (m && ou && statOf(m[1])) {
      const stat = statOf(m[1]);
      const after = t.slice(t.lastIndexOf(' - ') + 3).replace(OU, '').replace(/\d{1,3}[.,]\d{2}/g, '');
      const who = cleanName(after);
      if (t.includes(' - ') && who.length >= 4) return { key: `player|${stat}|${who.toLowerCase()}|${line}`, out: over ? 'over' : 'under', market: `${stat} · ${who}`, selection: `${over ? 'Más' : 'Menos'} de ${fmtLine(line)}` };
    }
  }
  if (/h[aá]ndicap/i.test(t)) {
    const rest = t.replace(/^.*h[aá]ndicap(?:\s*\([^)]*\))?\s*-?\s*/i, '');
    const side = sideIn(rest), l = /([+-]\s?\d+(?:[.,]\d+)?)/.exec(rest);
    if (side && l) {
      const v = num(l[1]), lineA = side === 'a' ? v : -v;
      return { key: `spread|${period}||${lineA}`, out: side, market: `${pre}Hándicap`, selection: `${label(side === 'a' ? G.a : G.b)} ${signed(v)}` };
    }
    return null;
  }
  // «Ambos marcan: Sí», y en bet365 «Ambos equipos anotarán» (sin Sí ni No: es que sí). «Ambos equipos recibirán 2 tarjetas» no es esto
  if (/ambos (?:equipos )?(marcan|anotar[aá]n|marcar[aá]n)/i.test(t)) {
    const rest = t.replace(/.*(marcan|anotar[aá]n|marcar[aá]n)/i, '');
    const no = /\bno\b/i.test(rest) || /\bno (anotar|marcar)/i.test(t), yes = /\bs[ií]\b/i.test(rest) || (!no && /anotar[aá]n|marcar[aá]n/i.test(t));
    return yes !== no ? { key: 'btts|0||', out: yes ? 'yes' : 'no', market: 'Ambos marcan', selection: yes ? 'Sí' : 'No' } : null;
  }
  if (/ambos equipos/i.test(t)) return null;
  if (ou && /total|n[uú]mero|puntos|goles|juegos/i.test(t)) {
    const side = sideIn(t.replace(OU, ''));
    if (side) return { key: `team_total|${period}|${side}|${line}`, out: over ? 'over' : 'under', market: `${pre}${unit[0].toUpperCase() + unit.slice(1)} de ${label(side === 'a' ? G.a : G.b)}`, selection: `${over ? 'Más' : 'Menos'} de ${fmtLine(line)}` };
    return { key: `total|${period}||${line}`, out: over ? 'over' : 'under', market: `${pre}Total de ${unit}`, selection: `${over ? 'Más' : 'Menos'} de ${fmtLine(line)}` };
  }
  // bet365 pone sólo el equipo («Barcelona 2.00») y el mercado debajo («Resultado final»): se mira con el subtítulo. Lo de
  // descanso/final o empate no válido, no: es otro mercado
  const ctx = sub ? `${t} ${sub}` : t;
  if (/descanso\s*\/\s*final|sin empate|doble oportunidad/i.test(ctx)) return null;
  if (/ganador|resultado|1x2|gana el partido/i.test(ctx) || sideIn(t)) {
    if (G.sport === 'football' && /\bempate\b/i.test(t.replace(/sin empate/i, ''))) return { key: 'moneyline|0||', out: 'x', market: 'Resultado', selection: 'Empate' };
    const side = sideIn(t.replace(/^.*(ganador|resultado)[^a-z]*/i, '')) || sideIn(t);
    if (side) return { key: `moneyline|${period}||`, out: side, market: G.sport === 'football' && !period ? 'Resultado' : `${pre}Ganador`, selection: label(side === 'a' ? G.a : G.b) };
  }
  return null;
}

// ---------- Leer el ticket ----------
function bookOf(text) {
  if (/reutilizar selecciones|crear apuesta|\bimp:/i.test(text)) return 'bet365';
  if (/ganancias potenciales|ref:\s*\w+\s*\/\s*\d+|\bimporte\b/i.test(text)) return 'Winamax';
  if (/betway/i.test(text)) return 'Betway';
  return '';
}

// "22:03 - 21 noviembre 2026" (Winamax) → fecha; sin ella, null
function placedOf(text) {
  const m = new RegExp(`(?:(\\d{1,2}):?(\\d{2})\\s*-\\s*)?(\\d{1,2})\\s+(?:de\\s+)?(${MONTHS.join('|')})\\s+(?:de\\s+)?(\\d{4})`, 'i').exec(text);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[4].toLowerCase()) + 1;
  const hh = m[1] ? Number(m[1]) : 12, mi = m[2] ? Number(m[2]) : 0;
  if (hh > 23 || mi > 59) return null;
  // Hora de España (sin afinar el cambio de hora: sólo sirve para elegir el día y el partido)
  const iso = `${m[5]}-${String(mo).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+01:00`;
  const d = new Date(iso);
  return isNaN(+d) ? null : +d;
}

const money = s => { const v = num(String(s).replace(/\.(?=\d{3}\b)/g, '')); return isFinite(v) ? v : null; };

// Las líneas útiles: sin las de rayas y marcas (las barras de progreso salen como "———]]—"), ni las de sólo cifras sueltas
function linesOf(text) {
  return String(text || '').split(/\r?\n/).map(l => l.replace(/[—–_]{2,}.*$/, '').replace(/[|[\]]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(l => l && (l.match(/\p{L}/gu) || []).length >= 3);
}

// Texto del OCR → lo que dice el ticket (sin enlazar). legs: { text, odds, at } con la línea donde empieza cada selección
function parseTicket(text) {
  const raw = String(text || '');
  const lines = linesOf(raw);
  const book = bookOf(raw);
  const out = { book, kind: 'single', stake: null, payout: null, odds: null, placedAt: placedOf(raw), cashout: null, legs: [], lines };
  const flat = raw.replace(/\s+/g, ' ');
  let m;
  if ((m = /importe\D{0,80}?(\d[\d.,]*)\s*€/i.exec(flat))) out.stake = money(m[1]);
  if ((m = /cuota total\D{0,40}?(\d{1,3}[.,]\d{2})/i.exec(flat))) out.odds = num(m[1]);
  if ((m = /(\d[\d.,]*)\s*€\s*apuesta cerrada/i.exec(flat))) out.cashout = money(m[1]);
  // bet365: arriba "10,00€ Simple" / "8,27€ Crear apuesta"; abajo "Imp: … 10,00€ 50,00€"
  // (si los dos dicen lo mismo, el importe está confirmado y no se corrige con las ganancias)
  let header = null, imp = null;
  if ((m = /^\s*(\d[\d.,]*)\s*€\s*(simple|crear apuesta|combinada|doble|triple|cu[aá]druple)/im.exec(raw))) { header = money(m[1]); out.stake = out.stake ?? header; }
  if ((m = /imp:\s*(?:ganancias\s*)?(\d[\d.,]*)\s*€\s*(\d[\d.,]*)\s*€/i.exec(flat))) { imp = money(m[1]); out.stake = out.stake ?? imp; out.payout = out.payout ?? money(m[2]); }
  // Winamax: «Ganancias (potenciales) … 20,88 €» («Gananciss» también, que el OCR se come letras); después de lo de bet365, que pone
  // «Imp: Ganancias» y debajo el importe y luego las ganancias
  if (out.payout == null && (m = /ganan\w*(?: potenciales)?\D{0,80}?(\d[\d.,]*)\s*€/i.exec(flat))) out.payout = money(m[1]);
  // Winamax, cerrada antes de tiempo: la etiqueta «Cashout» y en «Ganancias» lo cobrado (las abiertas dicen «Ganancias potenciales»)
  if (out.cashout == null && /\bcash ?out\b/i.test(raw) && out.payout != null && !/ganancias potenciales/i.test(flat)) out.cashout = out.payout;
  if ((m = /crear apuesta\s+(\d{1,3}[.,]\d{2})/i.exec(flat))) { out.kind = 'builder'; out.odds = num(m[1]); }
  else if (/combinada/i.test(raw)) out.kind = 'combo';

  // Las selecciones: bet365 las pone una por línea ("Jugador - 10+ rebotes", "1º cuarto - Hándicap - SAC Kings +4.5 puntos");
  // Winamax, el mercado y debajo la selección, a veces partidos en varias líneas: se juntan hasta tener cuota y selección
  // bet365: cada selección es un título y debajo, más pequeño, de qué es («Paradas del portero - Otras opciones», «Rebotes»)
  const isLeg365 = l => !/^(?:\S\s+)?jugador\b/i.test(l) && (
    /\s-\s*\d+\s*\+\s*\p{L}/u.test(l) || /\s-\s*h[aá]ndicap\s*-|\s-\s*total[^-]*-|\s-\s*ganador[^-]*-/i.test(l) ||
    /\s-\s*(m[aá]s|menos) de \d/i.test(l) || /^(?:\S\s+)?ambos equipos (anotar|marcar|recibir)/i.test(l) ||
    /^(?:\S\s+)?(m[aá]s|menos) de \d+(?:[.,]\d+)? (tarjetas|c[oó]rners|goles|puntos|juegos)/i.test(l) || /\sser[aá] amonestad/i.test(l));
  const isMarket = l => !FOOTER.test(l) && !/crear apuesta|reutilizar|simple|combinada/i.test(l) &&
    /total|h[aá]ndicap|ganador|resultado|jugador|n[uú]mero|ambos|doble oportunidad|1x2/i.test(l);
  // La viñeta de bet365 sale como "9", "o", "S%"…: un carácter, o dos con un símbolo (no «TJ McConnell» ni «J. Smith»)
  const stripBullet = l => l.replace(/^(?:\S|[^\p{L}\s.']\S|\S[^\p{L}\s.'])\s+(?=\p{Lu})/u, '');
  // bet365 también pone sólo «Más de 4.5» y el mercado debajo («Total de goles»). Winamax tiene líneas así (la selección bajo el
  // mercado), así que eso sólo cuenta en los de bet365
  // …y también sólo el equipo y la cuota («Barcelona 2.00», con «Resultado final» debajo). El marcador de abajo («Barcelona 3»)
  // no lleva decimales, y el importe, el €
  const endsInOdds = l => book === 'bet365' && /\s\d{1,3}[.,]\d{2}$/.test(l) && !/€|crear apuesta/i.test(l);
  const bareOu = l => book === 'bet365' && /^(?:\S{1,2}\s+)?(m[aá]s|menos) de \d+(?:[.,]\d+)?(?:\s+\d{1,3}[.,]\d{2})?$/i.test(l);
  if (book === 'bet365' || lines.some(isLeg365)) {
    // El subtítulo puede repetir el título con otras palabras («Ambos equipos recibirán 2 o más tarjetas»): se reconoce porque
    // empieza igual, y no cuenta como otra selección
    const first3 = l => plain(stripBullet(l)).split(' ').slice(0, 3).join(' ');
    for (let i = 0; i < lines.length; i++) {
      const title = l => isLeg365(l) || bareOu(l) || endsInOdds(l);
      if (!title(lines[i])) continue;
      const t = stripBullet(lines[i]), next = lines[i + 1], at = i;
      let sub = '';
      if (next && !FOOTER.test(next) && (!title(next) || first3(next) === first3(lines[i]))) { sub = next; i++; }
      const o = [...t.matchAll(ODDS)].at(-1);
      out.legs.push({ text: o ? t.slice(0, o.index).trim() : t, sub, odds: o ? num(o[1]) : null, at });
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      if (!isMarket(lines[i])) continue;
      let block = lines[i], at = i;
      for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
        const hasOdds = [...block.matchAll(ODDS)].length > 0, hasSel = OU.test(block) || !/jugador|total|n[uú]mero/i.test(block);
        if (hasOdds && hasSel) break;
        if (FOOTER.test(lines[j]) || isMarket(lines[j])) break;
        block += ` ${lines[j]}`; i = j;
      }
      const o = [...block.matchAll(ODDS)].at(-1);
      out.legs.push({ text: o ? `${block.slice(0, o.index)} ${block.slice(o.index + o[0].length)}`.replace(/\s+/g, ' ').trim() : block, odds: o ? num(o[1]) : null, at });
    }
  }
  // Una «selección» sin cuota ni «Más/Menos de» es ruido del OCR («Cuota total» mal leído sale como "Gtatotal E")
  if (book !== 'bet365') out.legs = out.legs.filter(l => l.odds || OU.test(l.text));
  if (out.legs.length > 1 && out.kind === 'single') out.kind = 'combo';
  if (out.odds == null) out.odds = out.legs.length === 1 ? out.legs[0].odds : out.legs.every(l => l.odds) && out.legs.length ? round2(out.legs.reduce((p, l) => p * l.odds, 1)) : null;
  // El importe se comprueba con las ganancias: importe × cuota = ganancias (el OCR confunde 8 y 6)
  out.warnings = [];
  // No se toca si bet365 lo dice dos veces igual, ni con un «aumento de ganancias» (las ganancias llevan el premio)
  const confirmed = header != null && imp != null && Math.abs(header - imp) < 0.01;
  if (out.odds && out.payout && out.payout > 0 && !out.cashout && !confirmed && !/aumento|boost/i.test(raw)) {
    const fromPayout = round2(out.payout / out.odds);
    // Sólo si se parece a lo leído (una cifra mal leída): una perdida dice «Ganancias 0,00 €», y un 0 mal leído no es el importe
    const near = !out.stake || (fromPayout > out.stake / 2 && fromPayout < out.stake * 2);
    if (near && (!out.stake || Math.abs(out.stake * out.odds - out.payout) > 0.06)) {
      if (out.stake) out.warnings.push(`El importe se leyó como ${String(out.stake).replace('.', ',')} €; por las ganancias, son ${String(fromPayout).replace('.', ',')} €.`);
      out.stake = fromPayout;
    }
  }
  return out;
}

// Lo leído + los partidos candidatos → borrador de apuesta (como lo guarda store.saveBet) y qué se ha enlazado
function linkTicket(t, games, now = Date.now()) {
  const placedAt = t.placedAt ?? now;
  const found = findGames(t.lines, games, placedAt);
  const legs = t.legs.map((l, n) => {
    // Su partido: el que está justo encima en el ticket (Winamax) o, si no hay, el de debajo (bet365 lo pone al final)
    const above = found.filter(f => f.at <= l.at).at(-1), below = found.find(f => f.at > l.at);
    const f = above || below || (found.length === 1 ? found[0] : null);
    const odds = t.kind === 'builder' ? (n === 0 ? t.odds || 1 : 1) : l.odds || (t.legs.length === 1 ? t.odds : null) || 1;
    if (!f) return { leg: { event: '', league: '', market: l.text, selection: '', odds, status: 'pending' }, linked: false, text: l.text, why: 'No encuentro el partido entre los de esos días' };
    const mk = marketOf(l.text, f.G, f.A, f.B, l.sub);
    const base = { event: f.G.event, league: f.G.league, odds, status: 'pending', sport: f.G.sport };
    if (!mk) return { leg: { ...base, market: l.text, selection: '' }, linked: false, text: l.text, game: f.G.event, why: 'No reconozco el mercado: complétalo a mano' };
    const ref = { sport: f.G.sport, match: f.G.id, key: mk.key, out: mk.out, start: f.G.start };
    return { leg: { ...base, market: mk.market, selection: mk.selection, ref }, linked: true, text: l.text, game: f.G.event };
  });
  // El día de la apuesta: el del ticket (Winamax lo pone) o, si no lo trae (bet365), el de su partido, no el de hoy: la captura
  // se puede subir días después
  const start = legs.map(x => x.leg.ref?.start).find(Boolean);
  const date = new Date(t.placedAt ?? (start ? +new Date(start) : now)).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const notes = t.kind === 'builder' ? `Crear apuesta de ${t.book || 'la casa'}: cuota conjunta ${String(t.odds).replace('.', ',')} (va en la primera selección)` : '';
  const common = { date, bookmaker: t.book, stake: t.stake ?? 0, notes, ...(t.cashout ? { status: 'cashout', cashout: t.cashout } : { status: 'pending', cashout: 0 }) };
  let draft;
  if (legs.length === 1 && t.kind !== 'builder') {
    const { leg } = legs[0];
    draft = { ...common, ...(leg.sport ? { sport: leg.sport } : {}), league: leg.league, event: leg.event, market: leg.market, selection: leg.selection, odds: t.odds || leg.odds, ...(leg.ref ? { ref: leg.ref } : {}) };
  } else {
    draft = { ...common, odds: t.odds, legs: legs.map(x => x.leg) };
  }
  const partial = [...new Set(found.filter(f => f.partial).map(f => `${f.G.event} (sólo se lee ${f.partial})`))];
  const warnings = [...(t.warnings || []), ...partial.map(p => `El partido se ha reconocido por un solo equipo: ${p}. Comprueba que es el tuyo.`)];
  if (!t.stake) warnings.push('No se ha podido leer el importe: ponlo en el formulario («Revisar en el formulario»).');
  return { book: t.book, kind: t.kind, draft, legs: legs.map(({ linked, text, game, why }) => ({ linked, text, game: game || null, why: why || null })), warnings };
}

module.exports = { parseTicket, linkTicket, marketOf, gameOf, findGames, aliasesOf, mentions, periodOf };
