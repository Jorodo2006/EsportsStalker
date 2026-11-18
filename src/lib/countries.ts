// Países de ESPN (tenis y MMA) en castellano: llegan en inglés ("Spain", "Czech Republic"). La tabla sale del propio navegador
// (Intl.DisplayNames, inglés → español para cada código de dos letras) y se completa con los nombres que usa ESPN y no son
// los de la norma. Lo que no se encuentra se queda como viene. Sólo para enseñarlo: el buscador sigue mirando el original
const EXTRA: Record<string, string> = {
  USA: 'Estados Unidos', 'Great Britain': 'Gran Bretaña', England: 'Inglaterra', Scotland: 'Escocia', Wales: 'Gales',
  'Northern Ireland': 'Irlanda del Norte', 'Czech Republic': 'Chequia', 'Chinese Taipei': 'Taiwán', 'Korea': 'Corea del Sur',
  'Republic of Korea': 'Corea del Sur', 'Bosnia-Herzegovina': 'Bosnia y Herzegovina', 'Ivory Coast': 'Costa de Marfil',
  Turkey: 'Turquía', Holland: 'Países Bajos', Netherlands: 'Países Bajos', 'Russian Federation': 'Rusia'
};

let table: Map<string, string> | null = null;
function build() {
  const out = new Map<string, string>();
  try {
    const en = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    const es = new Intl.DisplayNames(['es'], { type: 'region', fallback: 'none' });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      try { const e = en.of(code), s = es.of(code); if (e && s && e !== code) out.set(e.toLowerCase(), s); } catch { /* código que no existe */ }
    }
  } catch { /* navegador sin Intl.DisplayNames: sólo la tabla de a mano */ }
  for (const [e, s] of Object.entries(EXTRA)) out.set(e.toLowerCase(), s);
  return out;
}

export function countryEs(name?: string | null) {
  if (!name) return '';
  table ??= build();
  return table.get(name.trim().toLowerCase()) ?? name;
}
