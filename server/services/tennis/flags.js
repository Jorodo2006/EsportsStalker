'use strict';
// Banderas de los jugadores que no salen de ESPN (Challenger y previas de LiveScore, previas de ProTennisLive), con las mismas
// imágenes que las de ESPN para que la lista se vea igual. ESPN las nombra con su propio código, casi siempre el del COI: Alemania
// es ger, Suiza sui, Países Bajos ned (sacados de sus rankings de la ATP y la WTA en noviembre de 2026). LiveScore da el ISO de
// tres letras (DEU, CHE, NLD) y los PDF de ProTennisLive, el del COI: los dos se traducen aquí. Ojo, ESPN tampoco sigue siempre al
// COI: Rumanía es rom, Serbia ser y Trinidad y Tobago tri. Cada código de la tabla y 90 más que pasan tal cual se comprobaron contra
// su CDN el 19-11-2026 (responde 200; uno que no existe da 404 y el navegador deja el hueco). Si sale una bandera rota, mira ahí.
const BASE = 'https://a.espncdn.com/i/teamlogos/countries/500/';

// ISO 3166 (o COI, cuando ESPN no lo sigue) → ESPN. Lo que no está se usa tal cual, en minúsculas (esp, fra, usa, arg…)
const CODE = {
  DEU: 'ger', NLD: 'ned', HRV: 'cro', CHE: 'sui', PRT: 'por', GRC: 'gre', DNK: 'den', ZAF: 'rsa', BGR: 'bul', SVN: 'slo',
  LVA: 'lat', MCO: 'mon', CHL: 'chi', IDN: 'ina', PHL: 'phi', PRY: 'par', ROU: 'rom', SRB: 'ser', URY: 'uru', TWN: 'tpe',
  LBN: 'lib', MYS: 'mas', SAU: 'ksa', ARE: 'uae', IRN: 'iri', KWT: 'kuw', VNM: 'vie', NGA: 'ngr', DZA: 'alg', ZWE: 'zim',
  PRI: 'pur', SLV: 'esa', GTM: 'gua', HND: 'hon', CRI: 'crc', BRB: 'bar', BHS: 'bah', HTI: 'hai', NPL: 'nep', LKA: 'sri',
  BGD: 'ban', MNG: 'mgl', KHM: 'cam', MDG: 'mad', OMN: 'oma', BHR: 'brn', ZMB: 'zam', BWA: 'bot', MUS: 'mri', TGO: 'tog', TTO: 'tri'
};
// Por el nombre, cuando el código no vale: Gran Bretaña llega de LiveScore como "NON", y las naciones del Reino Unido van con la suya
const BY_NAME = {
  'great britain': 'gbr', england: 'gbr', scotland: 'gbr', wales: 'gbr', 'northern ireland': 'gbr', 'united kingdom': 'gbr',
  'chinese taipei': 'tpe', taiwan: 'tpe', kosovo: 'kos'
};

// code: tres letras (ISO o COI); name: el país en inglés. '' si no hay con qué
function flagOf(code, name) {
  const byName = BY_NAME[String(name || '').trim().toLowerCase()];
  if (byName) return BASE + byName + '.png';
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c) || c === 'NON') return '';
  return BASE + (CODE[c] || c.toLowerCase()) + '.png';
}

// El país de un código del COI (los de TennisMyLife) en inglés, como lo da ESPN: la interfaz lo pasa al castellano (countryEs, en
// src/lib/countries.ts). Los que no están se quedan como código
const COUNTRY = {
  ALB: 'Albania', AND: 'Andorra', ARG: 'Argentina', ARM: 'Armenia', AUS: 'Australia', AUT: 'Austria', AZE: 'Azerbaijan', BAH: 'Bahamas', BAR: 'Barbados',
  BEL: 'Belgium', BIH: 'Bosnia-Herzegovina', BLR: 'Belarus', BOL: 'Bolivia', BRA: 'Brazil', BUL: 'Bulgaria', CAN: 'Canada', CHI: 'Chile', CHN: 'China',
  COL: 'Colombia', CRC: 'Costa Rica', CRO: 'Croatia', CUB: 'Cuba', CYP: 'Cyprus', CZE: 'Czechia', DEN: 'Denmark', DOM: 'Dominican Republic', ECU: 'Ecuador',
  EGY: 'Egypt', ESA: 'El Salvador', ESP: 'Spain', EST: 'Estonia', FIN: 'Finland', FRA: 'France', GBR: 'Great Britain', GEO: 'Georgia', GER: 'Germany',
  GRE: 'Greece', GUA: 'Guatemala', HKG: 'Hong Kong', HUN: 'Hungary', INA: 'Indonesia', IND: 'India', IRI: 'Iran', IRL: 'Ireland', ISL: 'Iceland',
  ISR: 'Israel', ITA: 'Italy', JAM: 'Jamaica', JOR: 'Jordan', JPN: 'Japan', KAZ: 'Kazakhstan', KEN: 'Kenya', KOR: 'South Korea', KSA: 'Saudi Arabia',
  KUW: 'Kuwait', LAT: 'Latvia', LBN: 'Lebanon', LIB: 'Lebanon', LIE: 'Liechtenstein', LTU: 'Lithuania', LUX: 'Luxembourg', MAR: 'Morocco', MAS: 'Malaysia',
  MDA: 'Moldova', MEX: 'Mexico', MKD: 'North Macedonia', MLT: 'Malta', MNE: 'Montenegro', MON: 'Monaco', NED: 'Netherlands', NGR: 'Nigeria', NOR: 'Norway',
  NZL: 'New Zealand', PAK: 'Pakistan', PAN: 'Panama', PAR: 'Paraguay', PER: 'Peru', PHI: 'Philippines', POL: 'Poland', POR: 'Portugal', PUR: 'Puerto Rico',
  QAT: 'Qatar', ROU: 'Romania', RSA: 'South Africa', RUS: 'Russia', SGP: 'Singapore', SLO: 'Slovenia', SMR: 'San Marino', SRB: 'Serbia', SUI: 'Switzerland',
  SVK: 'Slovakia', SWE: 'Sweden', THA: 'Thailand', TPE: 'Chinese Taipei', TTO: 'Trinidad & Tobago', TUN: 'Tunisia', TUR: 'Turkey', UAE: 'United Arab Emirates',
  UKR: 'Ukraine', URU: 'Uruguay', USA: 'USA', UZB: 'Uzbekistan', VEN: 'Venezuela', VIE: 'Vietnam', ZIM: 'Zimbabwe'
};
const countryOf = code => COUNTRY[String(code || '').trim().toUpperCase()] || String(code || '').trim();

module.exports = { flagOf, countryOf, CODE, BY_NAME };
