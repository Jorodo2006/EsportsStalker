// Actividad y factor local de cada jugador (fase 2 de docs/superpowers/specs/2026-11-19-motor-challenger-v2-design.md).
//
// Medido antes de meterlas (scripts/medir-variables.mjs, Challengers de 2024 a mayo de 2026): quien ha jugado 4 torneos o más en
// las 5 semanas anteriores gana 1,8 puntos más de lo que dice el Elo y quien sólo ha jugado 1, 2,5 menos (es forma, no
// cansancio); quien juega en su país, 2,1 más. Entran en el logit del modelo como diferencias entre los dos jugadores, con su
// peso (bWeeks, bLastWeek, bHome en elo.js), ajustado con un año distinto del que se evalúa.
//
// De cada jugador se guardan sus últimos torneos [clave, día de inicio, partidos] y su país. El país del torneo sale de la
// tabla de ciudades (venueSurfaces en data.js: el de la mayoría de sus invitados) o, en directo, del nombre de LiveScore
// ("Knoxville, USA").

import { venueKey } from './data.js';

const DAY = 86400000;
const KEEP = 6; // torneos que se guardan de cada jugador: la ventana es de 5 semanas
export const dayNum = (date) => Math.floor(Date.parse(date) / DAY);
/** Día del lunes de la semana de una fecha (el 1-1-1970 fue jueves). */
export const mondayOf = (date) => { const d = dayNum(date); return d - ((d + 3) % 7); };

/** Apunta un partido en el registro de torneos del jugador. */
export function recordTour(p, key, day) {
  const t = (p.tours ??= []);
  const last = t[t.length - 1];
  if (last && last[0] === key) { last[2]++; return; }
  t.push([key, day, 1]);
  if (t.length > KEEP) t.shift();
}

/**
 * Lo de un jugador antes del torneo que empieza el día `ref` (cur: su clave, para no contarlo; en directo no se sabe):
 *  - weeks5: torneos distintos que empezaron entre 35 y 3 días antes, hasta 4;
 *  - lastWeek: partidos del último que empezó entre 10 y 3 días antes, hasta 5.
 */
export function activity(p, ref, cur = null) {
  const seen = new Set();
  let lastWeek = 0, lastDay = -Infinity;
  for (const [key, day, n] of p?.tours ?? []) {
    if (key === cur || day > ref - 3 || day < ref - 35) continue;
    seen.add(key);
    if (day >= ref - 10 && day >= lastDay) { lastDay = day; lastWeek = n; }
  }
  return { weeks5: Math.min(seen.size, 4), lastWeek: Math.min(lastWeek, 5) };
}

// ---------- Riesgo de retirada (fase 4) ----------
// Medido en los Challenger (cuadro final y previas; tasas con 2021-2023 y comprobadas con 2024-2026): un jugador se retira en el
// 1,8 % de sus partidos (en el 3,6-3,8 % de los partidos se retira alguno). Sin retirada en 90 días, 1,67 % (1,69 % en la
// comprobación); si se retiró en los últimos 90 días, 2,49 % (×1,5; 2,90 % en la comprobación); con ranking protegido, 4,04 %
// (×2,2; 3,11 %, con mucho margen: 386 casos). Volver de un parón largo no cambia nada claro (1,7 % tras 180 días o más) y no cuenta
export const RETIRE = { base: 0.0167, recentDays: 90, recent: 1.5, pr: 2.2 };

/** Probabilidad de que el jugador se retire en un partido que empieza el día ref; entry: cómo entró al cuadro ('PR'…). */
export function retirementRisk(p, ref, entry = null) {
  const since = p?.lastRet ? ref - dayNum(p.lastRet) : Infinity;
  const recent = since >= 0 && since <= RETIRE.recentDays;
  const pr = String(entry ?? '').toUpperCase() === 'PR';
  return { r: RETIRE.base * (recent ? RETIRE.recent : 1) * (pr ? RETIRE.pr : 1), recent, pr };
}

/** 1 si juega en el país del torneo, 0 si no; null si no se sabe de dónde es el torneo. */
export const homeOf = (ioc, venueIoc) => (venueIoc ? (ioc && ioc === venueIoc ? 1 : 0) : null);

// ---------- País del torneo ----------
// Los nombres en inglés que usa LiveScore tras la coma ("Lima, Peru"), con su código IOC (el de Sackmann y TennisMyLife)
const COUNTRIES = {
  usa: 'USA', 'united states': 'USA', canada: 'CAN', mexico: 'MEX', 'puerto rico': 'PUR', 'dominican republic': 'DOM', cuba: 'CUB',
  guatemala: 'GUA', 'costa rica': 'CRC', 'el salvador': 'ESA', panama: 'PAN', honduras: 'HON', nicaragua: 'NCA', jamaica: 'JAM',
  bahamas: 'BAH', barbados: 'BAR', 'trinidad and tobago': 'TTO', bermuda: 'BER',
  argentina: 'ARG', brazil: 'BRA', chile: 'CHI', colombia: 'COL', peru: 'PER', ecuador: 'ECU', bolivia: 'BOL', uruguay: 'URU',
  paraguay: 'PAR', venezuela: 'VEN',
  spain: 'ESP', france: 'FRA', italy: 'ITA', germany: 'GER', portugal: 'POR', 'great britain': 'GBR', 'united kingdom': 'GBR',
  england: 'GBR', scotland: 'GBR', wales: 'GBR', ireland: 'IRL', netherlands: 'NED', belgium: 'BEL', luxembourg: 'LUX',
  switzerland: 'SUI', austria: 'AUT', 'czech republic': 'CZE', czechia: 'CZE', slovakia: 'SVK', poland: 'POL', hungary: 'HUN',
  slovenia: 'SLO', croatia: 'CRO', serbia: 'SRB', 'bosnia and herzegovina': 'BIH', bosnia: 'BIH', montenegro: 'MNE',
  'north macedonia': 'MKD', albania: 'ALB', romania: 'ROU', bulgaria: 'BUL', moldova: 'MDA', greece: 'GRE', cyprus: 'CYP',
  turkey: 'TUR', turkiye: 'TUR', malta: 'MLT', monaco: 'MON', andorra: 'AND', 'san marino': 'SMR', liechtenstein: 'LIE',
  sweden: 'SWE', norway: 'NOR', denmark: 'DEN', finland: 'FIN', iceland: 'ISL', estonia: 'EST', latvia: 'LAT', lithuania: 'LTU',
  ukraine: 'UKR', belarus: 'BLR', russia: 'RUS', georgia: 'GEO', armenia: 'ARM', azerbaijan: 'AZE',
  china: 'CHN', japan: 'JPN', 'korea republic': 'KOR', 'south korea': 'KOR', korea: 'KOR', taiwan: 'TPE', 'chinese taipei': 'TPE',
  'hong kong': 'HKG', mongolia: 'MGL', india: 'IND', pakistan: 'PAK', 'sri lanka': 'SRI', bangladesh: 'BAN', thailand: 'THA',
  vietnam: 'VIE', malaysia: 'MAS', singapore: 'SGP', indonesia: 'INA', philippines: 'PHI', kazakhstan: 'KAZ', uzbekistan: 'UZB',
  australia: 'AUS', 'new zealand': 'NZL', fiji: 'FIJ', guam: 'GUM',
  israel: 'ISR', lebanon: 'LBN', jordan: 'JOR', 'saudi arabia': 'KSA', 'united arab emirates': 'UAE', uae: 'UAE', qatar: 'QAT',
  bahrain: 'BRN', kuwait: 'KUW', oman: 'OMA', iran: 'IRI',
  egypt: 'EGY', morocco: 'MAR', tunisia: 'TUN', algeria: 'ALG', libya: 'LBA', 'ivory coast': 'CIV', "cote d'ivoire": 'CIV',
  'cote divoire': 'CIV', senegal: 'SEN', togo: 'TOG', benin: 'BEN', ghana: 'GHA', nigeria: 'NGR', cameroon: 'CMR', kenya: 'KEN',
  uganda: 'UGA', rwanda: 'RWA', tanzania: 'TAN', zambia: 'ZAM', zimbabwe: 'ZIM', namibia: 'NAM', botswana: 'BOT',
  'south africa': 'RSA', mauritius: 'MRI', madagascar: 'MAD',
};
const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * País (código IOC) del torneo `name`: primero la tabla de ciudades (la misma ciudad, o una que sea parte del nombre o que lo
 * contenga, con palabras enteras: "Brest" vale para "Brest Open Groupe Vert" y "Cali" no vale para "Calimera"); si no, el país
 * tras la coma del nombre de LiveScore. null si no se sabe.
 */
export function countryOf(venues, name) {
  const k = venueKey(name);
  if (k) {
    const hit = venues?.[k];
    if (hit?.ioc) return hit.ioc;
    const inName = new RegExp(`(^| )${k}( |$)`);
    const cand = Object.entries(venues ?? {}).filter(([v, x]) => x.ioc && (inName.test(v) || new RegExp(`(^| )${v}( |$)`).test(k)));
    const iocs = new Set(cand.map(([, x]) => x.ioc));
    if (iocs.size === 1) return [...iocs][0]; // si salen ciudades de dos países, no se sabe
  }
  const tail = String(name ?? '').split(',').slice(1).join(',');
  return tail ? COUNTRIES[plain(tail)] ?? null : null;
}
