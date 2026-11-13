// Emparejar nombres de jugadores entre fuentes.
// Las casas escriben "Nadal R.", "R. Nadal", "Nadal, Rafael" o "Rafael Nadal";
// los resultados históricos usan "Rafael Nadal". Sin esto el escáner no sirve.

const PARTICLES = new Set(['de', 'del', 'la', 'van', 'von', 'der', 'den', 'da', 'di', 'dos', 'du', 'le', 'el']);

export function stripAccents(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokens(name) {
  return stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z\s,.\-']/g, ' ')
    .replace(/[-']/g, ' ')
    .split(/[\s,]+/)
    .map((t) => t.replace(/\./g, ''))
    .filter(Boolean);
}

/** Clave canónica "nombre-apellidos" en minúsculas y sin acentos. */
export function playerKey(name) {
  return tokens(name).join('-');
}

/**
 * Interpreta un nombre en cualquiera de los formatos habituales.
 * Devuelve { surname, initial, full } donde surname son los tokens del apellido.
 */
export function parseName(raw) {
  const s = String(raw ?? '').trim();
  if (s.includes(',')) {
    const [last, first] = s.split(',');
    const t = tokens(first);
    return { surname: tokens(last), initial: t[0]?.[0] ?? '', first: t[0] ?? '' };
  }
  const t = tokens(s);
  const rawParts = s.split(/\s+/);
  // "Nadal R." o "Nadal R"
  const lastRaw = rawParts[rawParts.length - 1] ?? '';
  if (t.length >= 2 && /^[A-Za-z]\.?$/.test(lastRaw)) {
    return { surname: t.slice(0, -1), initial: t[t.length - 1], first: '' };
  }
  // "R. Nadal"
  const firstRaw = rawParts[0] ?? '';
  if (t.length >= 2 && /^[A-Za-z]\.$/.test(firstRaw)) {
    return { surname: t.slice(1), initial: t[0], first: '' };
  }
  // "Rafael Nadal" / "Juan Martin del Potro"
  if (t.length === 1) return { surname: t, initial: '', first: '' };
  let i = 1;
  // Si hay partículas, el apellido empieza en la primera partícula.
  const p = t.findIndex((x, idx) => idx > 0 && PARTICLES.has(x));
  if (p > 0) i = p;
  return { surname: t.slice(i), initial: t[0][0], first: t[0] };
}

/**
 * Índice de jugadores conocidos para buscar por nombre de casa de apuestas.
 * players: iterable de { id, name }
 */
export class PlayerIndex {
  constructor(players = []) {
    this.byKey = new Map();
    this.bySurname = new Map();
    for (const p of players) this.add(p.id, p.name);
  }

  add(id, name) {
    const key = playerKey(name);
    if (!this.byKey.has(key)) this.byKey.set(key, { id, name });
    const pn = parseName(name);
    // Indexamos por el apellido completo y por su última palabra (apellidos compuestos).
    const keys = new Set([pn.surname.join(' '), pn.surname[pn.surname.length - 1]]);
    for (const k of keys) {
      if (!k) continue;
      if (!this.bySurname.has(k)) this.bySurname.set(k, []);
      const list = this.bySurname.get(k);
      if (!list.some((x) => x.id === id)) list.push({ id, name, initial: pn.initial });
    }
  }

  /**
   * Busca un jugador. Devuelve { id, name, confidence: 'exact'|'surname+initial'|'surname' }
   * o null si no hay coincidencia clara (mejor no apostar que apostar al jugador equivocado).
   */
  find(raw) {
    const exact = this.byKey.get(playerKey(raw));
    if (exact) return { ...exact, confidence: 'exact' };
    const pn = parseName(raw);
    const candidates = [pn.surname.join(' '), pn.surname[pn.surname.length - 1]]
      .flatMap((k) => this.bySurname.get(k) ?? []);
    const unique = [...new Map(candidates.map((c) => [c.id, c])).values()];
    if (!unique.length) return null;
    if (pn.initial) {
      const withInitial = unique.filter((c) => c.initial === pn.initial);
      if (withInitial.length === 1) return { id: withInitial[0].id, name: withInitial[0].name, confidence: 'surname+initial' };
      if (withInitial.length > 1) return null; // Ambiguo.
    }
    if (unique.length === 1) return { id: unique[0].id, name: unique[0].name, confidence: 'surname' };
    return null;
  }
}
