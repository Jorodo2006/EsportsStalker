'use strict';
// Los dobles de tenis (ATP y WTA de ESPN; los Challenger salen de livescore.js): cada pareja con la forma de un jugador, para que la
// lista, la ficha, las cuotas y el cupón los traten igual. Van en su propia ruta (/api/tennis/doubles) y no en /api/tennis/games,
// porque lo que lee esa (lecturas programadas, modelo de tenis, motor de los Challenger, resolución, buscador) da por hecho un
// jugador por lado. Sin modelo ni recomendaciones: no hay histórico de dobles reciente y gratuito (Sackmann llega a 2020 y
// TennisMyLife no tiene). Sin red: lo prueba npm test

// "Rafael Matos" → "Matos"; con más palabras, todo menos el nombre de pila ("Guiomar Maristany Zuleta De Reales")
const words = n => String(n || '').trim().split(/\s+/).filter(Boolean);
const surname = n => { const w = words(n); return w.length > 1 ? w.slice(1).join(' ') : w[0] || ''; };
const initial = n => { const w = words(n); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(' ')}` : String(n || ''); };

// La pareja con la forma de TennisPlayer. name: "Orlando Luz / Rafael Matos" (es la clave de sus cuotas); short: "Luz / Matos", lo
// que cabe en una fila; alt: como pueden escribirla las casas (newJob guarda 4 como mucho). El lector y el comparador emparejan por
// los dos apellidos en cualquier orden (equipos.js, winamaxfind.js, pagefind.js), así que alt sólo es una ayuda más
function pairOf(id, players, extra = {}) {
  const [x, y] = players;
  const short = `${surname(x.name)} / ${surname(y.name)}`;
  return {
    id, name: `${x.name} / ${y.name}`, short, flag: '', country: [...new Set(players.map(p => p.country).filter(Boolean))].join(' / '),
    seed: null, rank: null, sets: [], setWins: [], tiebreaks: [], winner: false,
    alt: [...new Set([short, short.replace(' / ', '/'), `${surname(y.name)} / ${surname(x.name)}`, `${initial(x.name)} / ${initial(y.name)}`])].slice(0, 4),
    players: players.map(p => ({ name: p.name, short: p.short || initial(p.name), flag: p.flag || '', country: p.country || '' })),
    ...extra
  };
}

// Super tie-break: en los dobles que no son de Grand Slam el tercer set es un tie-break a 10. ESPN lo da como un set 1-0 con los
// puntos entre paréntesis ("1(10)" y "0(4)"); LiveScore, como un set de 10-7. Se deja todo como ESPN, porque si no la resolución
// lo sumaría como juegos (4-6 7-6 10-7 daría 34 juegos en vez de 24). Un set normal no pasa de 7: 8 o más en el tercero es el
// tie-break, acabado o no (si alguien se retira en él no hay ganador del set)
function fixMtb(a, b) {
  const x = a.sets[2], y = b.sets[2];
  if (x == null || y == null || Math.max(x, y) < 8) return [a, b];
  const done = Math.max(x, y) >= 10 && Math.abs(x - y) >= 2;
  const put = (p, mine, other) => {
    const won = done && mine > other;
    const sets = [...p.sets], setWins = [...p.setWins], tiebreaks = [...p.tiebreaks];
    sets[2] = won ? 1 : 0; setWins[2] = won; tiebreaks[2] = mine;
    return { ...p, sets, setWins, tiebreaks };
  };
  return [put(a, x, y), put(b, y, x)];
}

// mtb: el partido ha llegado al super tie-break (dobles que no son de Grand Slam con tercer set). Lo usan la ficha, para llamarlo
// por su nombre, y la resolución, que no resuelve sola los mercados de juegos de esos partidos
function withMtb(m) {
  if (m.major || Math.max(m.a.sets.length, m.b.sets.length) < 3) return m;
  const [a, b] = fixMtb(m.a, m.b);
  return { ...m, a, b, mtb: true };
}

// Los dobles de los marcadores de ESPN de un circuito: los grupos "mens-doubles", "womens-doubles" (y los mixtos), con el mismo
// recorrido que los individuales de matches() en index.js. Cada lado es un competidor "team" con roster.athletes; si una de las
// parejas aún no se sabe (sin sus dos jugadores) el partido no sale, como los individuales sin rival.
// fmt: { roundEs, statusEs } de index.js, para que las rondas y los estados se traduzcan igual que en los individuales
function espnDoubles(boards, tour, fmt) {
  const seen = new Set(), out = [];
  for (const j of boards) {
    for (const e of j?.events || []) {
      for (const g of e.groupings || []) {
        if (!/doubles/i.test(g.grouping?.slug || g.grouping?.displayName || '')) continue;
        for (const c of g.competitions || []) {
          if (seen.has(c.id) || (c.competitors || []).length !== 2) continue;
          const sides = c.competitors.slice().sort((x, y) => (x.order || 0) - (y.order || 0));
          if (!sides.every(x => (x.roster?.athletes || []).length === 2)) continue;
          seen.add(c.id);
          const st = c.status?.type?.state;
          const [a, b] = sides.map(x => pairOf(`dbl:${tour}:${x.id}`, x.roster.athletes.map(p => ({
            name: p.displayName || p.fullName || '', short: p.shortName || '', flag: p.flag?.href || '', country: p.flag?.alt || ''
          })), {
            seed: x.curatedRank?.current ?? null,
            sets: (x.linescores || []).map(l => Number(l.value)), setWins: (x.linescores || []).map(l => !!l.winner),
            tiebreaks: (x.linescores || []).map(l => (l.tiebreak != null ? Number(l.tiebreak) : null)), winner: !!x.winner
          }));
          out.push(withMtb({
            id: `dbl:${tour}:${c.id}`, tour, tournament: e.name || '', tournamentId: e.id, major: !!e.major, date: c.date,
            state: st === 'in' ? 'in' : st === 'post' ? 'post' : 'pre', status: st === 'pre' ? '' : fmt.statusEs(c.status?.type?.detail),
            round: fmt.roundEs(c.round?.displayName), court: c.venue?.court || '', city: c.venue?.fullName || '', bestOf: 3,
            note: c.notes?.[0]?.text || '', a, b, doubles: true
          }));
        }
      }
    }
  }
  return out;
}

module.exports = { pairOf, fixMtb, withMtb, espnDoubles, surname };
