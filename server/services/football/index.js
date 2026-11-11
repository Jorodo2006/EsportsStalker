// football-svc: fútbol de la API pública de ESPN (gratuita, sin clave): LaLiga, Segunda, las otras cuatro grandes ligas,
// las tres competiciones europeas, la Copa del Rey, las selecciones y el femenino (Champions, Liga F y WSL). Partidos por día en hora de España con el marcador en directo, ficha
// del partido (estadísticas, alineaciones, goles, tarjetas y cambios, forma y cara a cara) y clasificaciones.
// La ficha de ESPN también trae cuotas: no se usan, las cuotas sólo salen del lector de las casas.
// Caché en memoria y en football.cache (por si ESPN no responde).
const path = require('path');
const { start, fail } = require('../../shared/service');
const { migrate, query } = require('../../shared/db');
const { photoOf, photosOf } = require('./photos');
const { picksFor } = require('./picks');
const { hits, queryOf } = require('../../shared/search');

// En este orden salen en la lista de partidos
const LEAGUES = [
  { id: 'laliga', espn: 'esp.1', name: 'LaLiga', country: 'España' },
  { id: 'champions', espn: 'uefa.champions', name: 'Champions League', country: 'Europa' },
  { id: 'premier', espn: 'eng.1', name: 'Premier League', country: 'Inglaterra' },
  { id: 'seriea', espn: 'ita.1', name: 'Serie A', country: 'Italia' },
  { id: 'bundesliga', espn: 'ger.1', name: 'Bundesliga', country: 'Alemania' },
  { id: 'ligue1', espn: 'fra.1', name: 'Ligue 1', country: 'Francia' },
  { id: 'europa', espn: 'uefa.europa', name: 'Europa League', country: 'Europa' },
  { id: 'conference', espn: 'uefa.europa.conf', name: 'Conference League', country: 'Europa' },
  { id: 'segunda', espn: 'esp.2', name: 'Segunda División', country: 'España' },
  { id: 'copa', espn: 'esp.copa_del_rey', name: 'Copa del Rey', country: 'España' },
  // Selecciones (parones internacionales). national: ESPN da sus nombres en inglés; se piden en español (lang=es)
  { id: 'nations', espn: 'uefa.nations', name: 'Nations League', country: 'Selecciones', national: true },
  { id: 'amistosos', espn: 'fifa.friendly', name: 'Amistosos internacionales', country: 'Selecciones', national: true },
  // Fútbol femenino: su propio grupo en el modelo (history.js), no se mezcla con el masculino
  { id: 'wchampions', espn: 'uefa.wchampions', name: 'Champions League Femenina', country: 'Femenino', women: true },
  { id: 'ligaf', espn: 'esp.w.1', name: 'Liga F', country: 'Femenino', women: true },
  { id: 'wsl', espn: 'eng.w.1', name: "Women's Super League", country: 'Femenino', women: true }
];

// Las listas de las selecciones en español. La ficha del partido no: con lang=es también se traducen los tipos de jugada
// ("Gol", "Tiro de esquina") y dejarían de reconocerse los tiros; ahí se cambian sólo los nombres (spanishNames)
const lang = lg => (lg.national ? '&lang=es&region=es' : '');

// Selecciones que ESPN deja en inglés aunque se pida en español, y cómo las llaman las casas: el primero es el nombre que
// se enseña; los demás, otros nombres para emparejarlas con Winamax y Betway
const NATIONAL = {
  'North Macedonia': ['Macedonia del Norte', 'Macedonia'], 'Bolívia': ['Bolivia'], 'Sao Tome and Principe': ['Santo Tomé y Príncipe'],
  Comoros: ['Comoras'], Djibouti: ['Yibuti'], Maldives: ['Maldivas'], Niger: ['Níger'], Kenya: ['Kenia'], Rwanda: ['Ruanda'],
  Botswana: ['Botsuana'], Benin: ['Benín'], Suriname: ['Surinam'], Anguilla: ['Anguila'], Tahiti: ['Tahití'], Fiji: ['Fiyi'],
  Chequia: ['Chequia', 'República Checa'], 'Países Bajos': ['Países Bajos', 'Holanda'], 'Estados Unidos': ['Estados Unidos', 'EE. UU.', 'USA'],
  'Bosnia y Herzegovina': ['Bosnia y Herzegovina', 'Bosnia-Herzegovina', 'Bosnia'], Irlanda: ['Irlanda', 'República de Irlanda'],
  'Corea del Sur': ['Corea del Sur', 'República de Corea'], 'China Taipéi': ['China Taipéi', 'Taiwán'], 'Arabia Saudita': ['Arabia Saudita', 'Arabia Saudí'],
  'Emiratos Árabes Unidos': ['Emiratos Árabes Unidos', 'Emiratos Árabes'], Moldavia: ['Moldavia', 'Moldova'], Bielorrusia: ['Bielorrusia', 'Belarús'],
  Turquía: ['Turquía', 'Türkiye'], Irán: ['Irán', 'RI de Irán'], 'República Democrática del Congo': ['República Democrática del Congo', 'RD Congo'],
  'Islas Feroe': ['Islas Feroe', 'Feroe'], 'Costa de Marfil': ['Costa de Marfil'], Kosovo: ['Kosovo']
};
const BY_ID = Object.fromEntries(LEAGUES.map(l => [l.id, l]));
const ORDER = Object.fromEntries(LEAGUES.map((l, i) => [l.id, i]));
const site = espn => `https://site.api.espn.com/apis/site/v2/sports/soccer/${espn}`;
const standingsUrl = espn => `https://site.api.espn.com/apis/v2/sports/soccer/${espn}/standings`;
const league = id => { const l = BY_ID[id]; if (!l) throw fail('Competición desconocida'); return l; };

// ---------- caché ----------
const mem = new Map();
// Última escritura en football.cache: es sólo una copia por si ESPN no responde, y un mes entero de una liga pesa
// cientos de KB, así que no se guarda en cada lectura
const saved = new Map();
async function getJSON(url, ttlMs) {
  const hit = mem.get(url);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    const v = await res.json();
    mem.set(url, { t: Date.now(), v });
    if (Date.now() - (saved.get(url) || 0) >= 5 * 60e3) {
      saved.set(url, Date.now());
      query(`INSERT INTO football.cache (key, value, t) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, t = EXCLUDED.t`,
        [url, JSON.stringify(v)]).catch(e => console.error('football.cache:', e.message));
    }
    return v;
  } catch (e) {
    const old = hit?.v ?? (await query('SELECT value FROM football.cache WHERE key = $1', [url]).catch(() => ({ rows: [] }))).rows[0]?.value;
    if (old) return old;
    throw new Error(`No se pudo leer ESPN (${e.message})`);
  }
}

// ---------- días en hora de España (igual que en basket y tennis) ----------
function tzOffset(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
}
const dayStart = ymd => { const [y, m, d] = ymd.split('-').map(Number); const g = Date.UTC(y, m - 1, d); return g - tzOffset(g); };
const madridDay = t => new Date(t + tzOffset(t)).toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.UTC(...ymd.split('-').map((v, i) => +v - (i === 1 ? 1 : 0))) + n * 864e5).toISOString().slice(0, 10);
const compact = s => s.replace(/-/g, '');
const valid = d => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) throw fail('Fecha no válida (AAAA-MM-DD)'); return d; };

// ---------- partidos ----------
const hex = c => (/^[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : null);
const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function teamOf(x, state, national = false) {
  const t = x.team || {};
  const nat = national ? NATIONAL[t.displayName] : null;
  return {
    id: String(t.id || ''), name: nat?.[0] || t.displayName || t.name || '', short: nat?.[0] || t.shortDisplayName || t.displayName || '', abbr: t.abbreviation || '',
    logo: t.logo || t.logos?.[0]?.href || '', color: hex(t.color), alt: hex(t.alternateColor),
    score: state === 'pre' ? null : num(x.score), winner: !!x.winner,
    // form: últimos resultados, el más reciente al final (G, E o P); record: ganados-empatados-perdidos en la competición
    form: String(x.form || '').replace(/W/g, 'G').replace(/D/g, 'E').replace(/L/g, 'P'),
    record: (x.records || []).find(r => r.type === 'total')?.summary || '',
    // Cómo lo pueden llamar las casas ("Atlético Madrid", "Atlético", "ATM")
    alts: [...new Set([...(nat || []), t.displayName, t.shortDisplayName, t.name, t.location, t.abbreviation].filter(Boolean))]
  };
}

const STAGES = {
  'league-phase': 'Fase de liga', 'knockout-round-playoffs': 'Eliminatoria previa', 'round-of-32': 'Dieciseisavos de final',
  'round-of-16': 'Octavos de final', quarterfinals: 'Cuartos de final', semifinals: 'Semifinales', final: 'Final'
};
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
// Fase o ronda. En las ligas el slug es la temporada ("2026-27-laliga") y ESPN no da la jornada
function stageOf(slug) {
  const s = String(slug || '').replace(/^playoffs-+/, '');
  if (!s || /^\d{4}/.test(s)) return '';
  if (STAGES[s]) return STAGES[s];
  const m = s.match(/^(\w+)-round$/);
  if (m && ORDINAL.includes(m[1])) return `${ORDINAL.indexOf(m[1]) + 1}.ª ronda`;
  return s.replace(/-+/g, ' ').replace(/^./, c => c.toUpperCase());
}

// Estado en español: el minuto si se está jugando
function statusOf(status) {
  const t = status?.type || {}, n = t.name || '';
  if (/HALFTIME/.test(n)) return 'Descanso';
  if (/POSTPONED/.test(n)) return 'Aplazado';
  if (/CANCEL/.test(n)) return 'Cancelado';
  if (/SUSPENDED|ABANDONED/.test(n)) return 'Suspendido';
  if (/SHOOTOUT/.test(n) && t.state === 'in') return 'Penaltis';
  if (/PEN/.test(n) && t.state === 'post') return 'Final (penaltis)';
  if (/AET/.test(n)) return 'Final (prórroga)';
  if (t.state === 'post') return 'Final';
  if (t.state === 'in') return /EXTRA/.test(n) ? `Prórroga ${status.displayClock || ''}`.trim() : status.displayClock || t.shortDetail || 'En juego';
  return '';
}

// Goles y tarjetas del marcador (la ficha los saca de keyEvents, con los cambios)
function incidents(c) {
  return (c.details || []).flatMap(d => {
    const type = String(d.type?.text || '');
    const kind = d.ownGoal ? 'owngoal' : /goal/i.test(type) ? (d.penaltyKick ? 'penalty' : 'goal') : d.redCard || /red card/i.test(type) ? 'red' : /yellow/i.test(type) ? 'yellow' : null;
    return kind ? [{ kind, minute: d.clock?.displayValue || '', team: String(d.team?.id || ''), player: d.athletesInvolved?.[0]?.displayName || '' }] : [];
  });
}

function matchOf(lg, e) {
  const c = e.competitions?.[0] || {};
  const status = c.status || e.status || {};
  const st = status.type || {};
  const state = st.state === 'in' ? 'in' : st.state === 'post' ? 'post' : 'pre';
  const comp = c.competitors || [];
  const home = comp.find(x => x.homeAway === 'home') || comp[0], away = comp.find(x => x.homeAway === 'away') || comp[1];
  if (!home || !away) return null;
  return {
    id: `${lg.id}:${e.id}`, league: lg.id, leagueName: lg.name, date: e.date || c.date, state, status: statusOf(status),
    // Aplazado o cancelado: ESPN lo da por terminado, pero no se jugó
    off: /POSTPONED|CANCEL|SUSPENDED|ABANDONED/.test(st.name || ''),
    stage: stageOf(e.season?.slug), venue: c.venue?.fullName || '', city: c.venue?.address?.city || '', neutral: !!c.neutralSite,
    home: teamOf(home, state, lg.national), away: teamOf(away, state, lg.national), incidents: incidents(c)
  };
}

// Cerca de hoy se pide el marcador de cada día, fresco para el directo; lejos, el mes entero de cada liga de una vez
// (dates=AAAAMM), que para la tira de días ahorra decenas de peticiones
async function between(from, to) {
  const a = dayStart(from), b = dayStart(addDays(to, 1));
  const today = madridDay(Date.now()), month = today.slice(0, 7);
  // Un día de España empieza la tarde anterior en la hora de ESPN: se pide también el día de antes
  const espnDays = []; for (let d = addDays(from, -1); d <= to; d = addDays(d, 1)) espnDays.push(d);
  const near = espnDays.filter(d => d >= addDays(today, -1) && d <= addDays(today, 1));
  const months = [...new Set(espnDays.filter(d => !near.includes(d)).map(d => d.slice(0, 7)))];
  const lists = await Promise.all(LEAGUES.map(async lg => {
    try {
      const boards = await Promise.all([
        ...near.map(d => getJSON(`${site(lg.espn)}/scoreboard?dates=${compact(d)}${lang(lg)}`, 30e3)),
        ...months.map(m => getJSON(`${site(lg.espn)}/scoreboard?dates=${compact(m)}${lang(lg)}`, m < month ? 6 * 3600e3 : 15 * 60e3))
      ]);
      return boards.flatMap(j => (j.events || []).map(e => matchOf(lg, e)).filter(Boolean));
    } catch (e) {
      console.error(`[football] ${lg.id}:`, e.message);
      return [];
    }
  }));
  // El mismo partido puede venir del día y del mes: manda el primero (el del día, más fresco)
  const seen = new Set();
  return lists.flat().filter(m => {
    const t = new Date(m.date).getTime();
    if (seen.has(m.id) || t < a || t >= b) return false;
    seen.add(m.id);
    return true;
  }).sort((x, y) => new Date(x.date) - new Date(y.date) || ORDER[x.league] - ORDER[y.league]);
}

async function live() {
  const today = madridDay(Date.now());
  const lists = await Promise.all(LEAGUES.map(lg => Promise.all([addDays(today, -1), today].map(d => getJSON(`${site(lg.espn)}/scoreboard?dates=${compact(d)}${lang(lg)}`, 30e3)))
    .then(bs => bs.flatMap(j => (j.events || []).map(e => matchOf(lg, e)).filter(m => m?.state === 'in')))
    .catch(() => [])));
  const seen = new Set();
  return lists.flat().filter(m => !seen.has(m.id) && seen.add(m.id));
}

// Nombre y escudo de cada competición (del marcador de hoy, que ya está en caché casi siempre)
async function leagues() {
  const today = compact(madridDay(Date.now()));
  return Promise.all(LEAGUES.map(async lg => {
    const j = await getJSON(`${site(lg.espn)}/scoreboard?dates=${today}${lang(lg)}`, 6 * 3600e3).catch(() => null);
    return { id: lg.id, name: lg.name, country: lg.country, logo: j?.leagues?.[0]?.logos?.[0]?.href || '' };
  }));
}

// ---------- ficha del partido ----------
// Tipos de keyEvents: goal, goal---header, penalty---scored, own-goal, yellow-card, red-card, substitution…
function kindOf(k) {
  const t = String(k.type?.type || ''), text = String(k.type?.text || '');
  if (/own-goal/.test(t) || /own goal/i.test(text)) return 'owngoal';
  if (/penalty/.test(t) && /miss|saved/.test(t)) return 'missed';
  if (/penalty/.test(t) || (/goal/.test(t) && /penalty/i.test(text))) return 'penalty';
  if (/^goal/.test(t)) return 'goal';
  if (t === 'red-card' || /yellow-red/.test(t)) return 'red';
  if (t === 'yellow-card') return 'yellow';
  if (t === 'substitution') return 'sub';
  return null;
}

const STAT_KEYS = ['possessionPct', 'totalShots', 'shotsOnTarget', 'blockedShots', 'wonCorners', 'offsides', 'foulsCommitted', 'yellowCards', 'redCards',
  'saves', 'totalPasses', 'accuratePasses', 'passPct', 'totalCrosses', 'accurateCrosses', 'totalLongBalls', 'interceptions', 'totalTackles', 'effectiveTackles', 'totalClearance'];

// Resultado de un partido anterior, desde el lado del equipo: G/E/P y el marcador con sus goles primero
// (ESPN da el marcador sin decir de quién es cada número)
function pastGame(v) {
  const res = ({ W: 'G', D: 'E', L: 'P' })[v.gameResult] || '';
  const [x, y] = String(v.score || '').split('-').map(Number);
  const hi = Math.max(x, y), lo = Math.min(x, y);
  return {
    id: String(v.id || ''), date: v.gameDate || '', result: res, score: Number.isFinite(hi) ? (res === 'P' ? `${lo}-${hi}` : `${hi}-${lo}`) : v.score || '',
    home: v.atVs === 'vs', league: v.leagueName || v.leagueAbbreviation || '',
    opponent: { id: String(v.opponent?.id || ''), name: v.opponent?.displayName || '', logo: v.opponentLogo || v.opponent?.logo || '' }
  };
}

async function detail(id) {
  const [lgId, ev] = String(id || '').split(':');
  const lg = league(lgId);
  if (!/^\d+$/.test(ev || '')) throw fail('Partido desconocido');
  const j = await getJSON(`${site(lg.espn)}/summary?event=${ev}`, 30e3);
  const h = j.header?.competitions?.[0];
  if (!h) throw fail('Partido no encontrado', 404);
  const match = matchOf(lg, { id: ev, date: h.date, season: j.header?.season, competitions: [{ ...h, venue: j.gameInfo?.venue }] });
  if (!match) throw fail('Partido no encontrado', 404);
  const timeline = (j.keyEvents || []).flatMap(k => {
    const kind = kindOf(k);
    if (!kind) return [];
    const who = (k.participants || []).map(p => p.athlete?.displayName).filter(Boolean);
    // En los goles el segundo es quien da la asistencia; en los cambios, el que sale
    return [{ kind, minute: k.clock?.displayValue || '', team: String(k.team?.id || ''), player: who[0] || '', other: who[1] || '' }];
  });
  const stats = Object.fromEntries((j.boxscore?.teams || []).map(t => [String(t.team?.id || ''),
    Object.fromEntries((t.statistics || []).filter(s => STAT_KEYS.includes(s.name)).map(s => [s.name, num(s.displayValue)]))]));
  const lineups = (j.rosters || []).map(r => ({
    team: String(r.team?.id || ''), formation: r.formation || '',
    players: (r.roster || []).map(p => ({
      id: String(p.athlete?.id || ''), name: p.athlete?.displayName || '', number: p.jersey || '', pos: p.position?.abbreviation || '',
      starter: !!p.starter, subIn: !!p.subbedIn, subOut: !!p.subbedOut, place: num(p.formationPlace)
    }))
  })).filter(r => r.players.length);
  // Tiros con su sitio, del comentario de ESPN: x de 0 a 100 hacia la portería rival (100 es su línea de gol), y de 0 a 100
  // a lo ancho (lo bajo es la derecha del que tira), y x2/y2 hasta dónde llegó. Los goles en propia puerta no son tiros
  const teamByName = new Map((j.rosters || []).map(r => [r.team?.displayName, String(r.team?.id || '')]));
  const shots = (j.commentary || []).map(c => c.play).filter(p => p && p.fieldPositionX != null && p.fieldPositionY != null).flatMap(p => {
    const t = p.type?.text || '';
    const kind = /own goal/i.test(t) ? null : /^goal|penalty - scored/i.test(t) ? 'goal' : /on target|penalty - saved/i.test(t) ? 'saved'
      : /blocked/i.test(t) ? 'blocked' : /off target|woodwork|post|penalty - missed/i.test(t) ? 'off' : null;
    if (!kind) return [];
    return [{
      kind, team: teamByName.get(p.team?.displayName) || String(p.team?.id || ''), player: p.participants?.[0]?.athlete?.displayName || '',
      minute: p.clock?.displayValue || '', header: /header/i.test(`${t} ${p.text || ''}`), penalty: /penalty/i.test(t),
      x: Number(p.fieldPositionX), y: Number(p.fieldPositionY), x2: num(p.fieldPosition2X), y2: num(p.fieldPosition2Y)
    }];
  });
  const form = Object.fromEntries((j.lastFiveGames || []).map(x => [String(x.team?.id || ''), (x.events || []).map(pastGame).sort((p, q) => q.date.localeCompare(p.date))]));
  const h2h = (j.headToHeadGames || []).flatMap(x => (x.events || []).map(v => ({ ...pastGame(v), team: String(x.team?.id || '') })))
    .sort((p, q) => q.date.localeCompare(p.date)).slice(0, 10);
  const out = { match, timeline, stats, lineups, shots, form, h2h, attendance: num(j.gameInfo?.attendance) || null, hasStandings: !!j.standings?.groups?.length };
  return lg.national ? spanishNames(lg, h.date, out) : out;
}

// Selecciones: la ficha viene en inglés ("Spain"); los nombres se cambian por los del marcador en español de ese día (ya
// en caché casi siempre), en todo objeto con id y name de una de ellas (el partido, las alineaciones, la forma…)
async function spanishNames(lg, date, out) {
  const days = [0, -1].map(n => compact(new Date(Date.parse(date) + n * 864e5).toISOString().slice(0, 10)));
  const boards = await Promise.all(days.map(d => getJSON(`${site(lg.espn)}/scoreboard?dates=${d}${lang(lg)}`, 6 * 3600e3).catch(() => ({ events: [] }))));
  const names = new Map();
  for (const e of boards.flatMap(b => b.events || [])) {
    for (const c of e.competitions?.[0]?.competitors || []) { const t = teamOf(c, 'pre', true); names.set(t.id, t); }
  }
  const walk = o => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    const t = o.id != null && names.get(String(o.id));
    if (t && typeof o.name === 'string') { o.name = t.name; if (typeof o.short === 'string') o.short = t.short; }
    Object.values(o).forEach(walk);
  };
  walk(out);
  return out;
}

// ---------- clasificaciones ----------
// Zonas de la tabla (las da ESPN en inglés, con su color)
function zoneEs(s) {
  const t = String(s || '').replace(/^Qualifies for (the )?/i, '');
  return t.replace(/Champions League Qualifiers?/i, 'Previa de la Champions').replace(/Europa League Qualifiers?/i, 'Previa de la Europa League')
    .replace(/Conference League Qualifiers?/i, 'Previa de la Conference').replace(/Promotion Playoffs?/i, 'Promoción de ascenso')
    .replace(/^Promotion$/i, 'Ascenso').replace(/Relegation Playoffs?/i, 'Promoción de descenso').replace(/^Relegation$/i, 'Descenso')
    .replace(/Knockout Round Playoffs?/i, 'Eliminatoria previa').replace(/Round of 16/i, 'Octavos de final').replace(/Qualifiers?/i, 'Previa');
}

async function standings(lgId) {
  const lg = league(lgId);
  if (lg.id === 'copa' || lg.id === 'amistosos') return [];
  const j = await getJSON(standingsUrl(lg.espn) + (lg.national ? '?lang=es&region=es' : ''), 30 * 60e3);
  return (j.children?.length ? j.children : [j]).map(ch => ({
    name: /league phase/i.test(ch.name || '') ? 'Fase de liga' : String(ch.name || '').replace(/^Group/i, 'Grupo').replace(/^League/i, 'Liga'),
    rows: (ch.standings?.entries || []).map(e => {
      const s = Object.fromEntries((e.stats || []).map(x => [x.name, x.value]));
      return {
        rank: s.rank ?? null, team: { id: String(e.team?.id || ''), name: (lg.national && NATIONAL[e.team?.displayName]?.[0]) || e.team?.displayName || '', abbr: e.team?.abbreviation || '', logo: e.team?.logos?.[0]?.href || '' },
        played: s.gamesPlayed ?? 0, won: s.wins ?? 0, drawn: s.ties ?? 0, lost: s.losses ?? 0, gf: s.pointsFor ?? 0, ga: s.pointsAgainst ?? 0,
        gd: s.pointDifferential ?? 0, points: s.points ?? 0, zone: e.note?.description ? { color: e.note.color || '', text: zoneEs(e.note.description) } : null
      };
    }).sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99))
  })).filter(g => g.rows.length);
}

// Últimos partidos acabados de un equipo, de todas las competiciones (para "cuántas veces se cumple"): esta temporada y la
// anterior (de ahí salen también los cara a cara cuando la ficha de ESPN no los trae). Del más reciente al más antiguo, con
// sus goles primero
async function teamGames(teamId) {
  if (!/^\d+$/.test(String(teamId || ''))) throw fail('Equipo desconocido');
  const url = season => `https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/${teamId}/schedule${season ? `?season=${season}` : ''}`;
  const parse = j => (j.events || []).flatMap(e => {
    const c = e.competitions?.[0];
    if (c?.status?.type?.state !== 'post') return [];
    const me = (c.competitors || []).find(x => String(x.team?.id) === String(teamId)), op = (c.competitors || []).find(x => x !== me);
    const sc = x => num(x?.score?.value ?? x?.score?.displayValue ?? x?.score);
    if (!me || !op || sc(me) == null || sc(op) == null) return [];
    return [{ id: String(e.id), date: e.date, home: me.homeAway === 'home', gf: sc(me), ga: sc(op), opp: { id: String(op.team?.id || ''), name: op.team?.displayName || '', logo: op.team?.logos?.[0]?.href || op.team?.logo || '' }, league: e.league?.name || e.league?.slug || '' }];
  });
  const now = await getJSON(url(), 30 * 60e3);
  let list = parse(now);
  const y = Number(now.requestedSeason?.year || now.season?.year);
  if (y) list = list.concat(parse(await getJSON(url(y - 1), 12 * 3600e3).catch(() => ({}))));
  const seen = new Set();
  return list.filter(g => !seen.has(g.id) && seen.add(g.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);
}

// Estadísticas de un jugador en un partido: la ficha (summary) sólo trae goles, tiros y tarjetas; la API "core" de ESPN, también
// pública y gratuita, trae el resto (entradas, intercepciones, regates, duelos, pases, xG, paradas…). Se devuelven tal cual,
// { nombre: valor }; la interfaz elige cuáles enseña. Un suplente que no jugó no tiene: ESPN responde 404
const coreStatsUrl = (espn, ev, team, player) =>
  `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${espn}/events/${ev}/competitions/${ev}/competitors/${team}/roster/${player}/statistics/0`;
async function playerStats(q) {
  const [lgId, ev] = String(q.match || '').split(':');
  const lg = league(lgId);
  if (!/^\d+$/.test(ev || '') || !/^\d+$/.test(q.team || '') || !/^\d+$/.test(q.player || '')) throw fail('Jugador desconocido');
  let j;
  try { j = await getJSON(coreStatsUrl(lg.espn, ev, q.team, q.player), 25e3); } // en juego cambian cada poco: como mucho 25 s de retraso
  catch (e) { throw fail(/404/.test(e.message) ? 'ESPN no tiene estadísticas de este jugador en este partido (puede que no llegara a jugar).' : e.message, 404); }
  const out = {};
  for (const c of j.splits?.categories || []) for (const s of c.stats || []) if (typeof s.value === 'number' && isFinite(s.value)) out[s.name] = s.value;
  return out;
}

// Buscador: partidos de ayer a dentro de una semana y competiciones (shared/search.js)
async function search(raw) {
  const q = queryOf(raw);
  if (!q) return { matches: [], competitions: [] };
  const t = madridDay(Date.now());
  const list = (await between(addDays(t, -1), addDays(t, 7))).filter(m => !m.off);
  const side = x => [x.name, x.short, x.abbr, ...(x.alts || [])];
  // Los partidos, por los equipos y el nombre de la competición; el país ("España") sólo encuentra competiciones, o saldrían
  // todos los partidos de sus ligas por delante de los de la selección
  const comp = lg => [lg.name, ...(lg.women ? ['femenino', 'femenina'] : [])];
  const matches = list.filter(m => hits(q, [...side(m.home), ...side(m.away)]) || hits(q, comp(BY_ID[m.league]))).map(m => ({
    sport: 'football', id: m.id, home: m.home.name, away: m.away.name, league: m.leagueName, stage: m.stage, date: m.date, state: m.state,
    status: m.status, score: m.state === 'pre' ? null : `${m.home.score ?? 0}-${m.away.score ?? 0}`, team: hits(q, [...side(m.home), ...side(m.away)])
  }));
  const competitions = LEAGUES.filter(l => hits(q, [...comp(l), l.country])).map(l => ({
    sport: 'football', id: l.id, name: l.name, sub: l.country, next: list.filter(m => m.league === l.id && m.state !== 'post')[0]?.date || null
  }));
  return { matches, competitions };
}

const routes = [
  ['GET', '/api/football/search', ({ query: q }) => search(q.q)],
  ['GET', '/api/football/leagues', () => leagues()],
  ['GET', '/api/football/games', ({ query: q }) => between(valid(q.date), valid(q.date))],
  ['GET', '/api/football/days', async ({ query: q }) => {
    const from = valid(q.from), n = Math.min(21, Math.max(1, Number(q.n) || 7));
    const list = await between(from, addDays(from, n - 1));
    const out = {};
    for (let i = 0; i < n; i++) out[addDays(from, i)] = { total: 0, live: 0 };
    for (const m of list) { const d = out[madridDay(new Date(m.date).getTime())]; if (d) { d.total++; if (m.state === 'in') d.live++; } }
    return out;
  }],
  ['GET', '/api/football/live', () => live()],
  ['GET', '/api/football/match', ({ query: q }) => detail(q.id)],
  ['GET', '/api/football/player-stats', ({ query: q }) => playerStats(q)],
  ['GET', '/api/football/team-games/:team', ({ params }) => teamGames(params.team)],
  ['GET', '/api/football/photo', ({ query: q }) => {
    const name = String(q.name || '').trim();
    if (!name || name.length > 80 || !/^\d*$/.test(String(q.id || ''))) throw fail('Jugador desconocido');
    return photoOf(String(q.id || ''), name, String(q.team || '').slice(0, 60));
  }],
  // Las de una alineación entera: { players: [{ id, name, team }] } → { id: { url, from } | null (aún buscándola) }
  ['POST', '/api/football/photos', ({ body }) => photosOf(body?.players)],
  ['GET', '/api/football/standings/:league', ({ params }) => standings(params.league)],
  // Recomendaciones de un partido (modelo de goles + cuotas), o las mejores de un día entre los partidos con cuotas leídas
  ['GET', '/api/football/picks', async ({ query: q }) => {
    const m = (await between(valid(q.date), valid(q.date))).find(x => x.id === q.id);
    if (!m) throw fail('Partido no encontrado');
    return picksFor(m, BY_ID[m.league].espn);
  }],
  ['GET', '/api/football/picks/day', async ({ query: q }) => {
    const date = valid(q.date);
    const hit = dayPicks.get(date);
    if (hit && Date.now() - hit.t < 60e3) return hit.v;
    const list = (await between(date, date)).filter(m => m.state === 'pre' && !m.off);
    const out = [];
    for (const m of list) {
      const r = await picksFor(m, BY_ID[m.league].espn).catch(e => { console.error('[football] recomendaciones:', m.id, e.message); return null; });
      if (r?.ready && r.top) out.push({ id: m.id, league: m.league, leagueName: m.leagueName, date: m.date, home: m.home, away: m.away, top: r.top, hard: r.hard[0] ?? null });
    }
    out.sort((x, y) => y.top.p - x.top.p);
    dayPicks.set(date, { t: Date.now(), v: out });
    return out;
  }]
];
const dayPicks = new Map();

migrate('football', path.join(__dirname, 'migrations'))
  // Las fotos de jugadores duran más: buscarlas cuesta (Wikipedia, de una en una) y casi no cambian
  // y los resultados de meses pasados (hist:, para el modelo) no cambian: se quedan
  .then(() => query(`DELETE FROM football.cache WHERE key NOT LIKE 'hist:%' AND t < now() - CASE WHEN key LIKE 'photo:%' THEN interval '60 days' ELSE interval '7 days' END`))
  .then(() => start({ name: 'football', port: Number(process.env.PORT) || 4006, routes, health: async () => (await query('SELECT 1'), true) }))
  .catch(e => { console.error(e); process.exit(1); });
