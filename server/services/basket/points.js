// Lo común a las dos fuentes (ESPN y la Euroliga) para los puntos de los equipos: la lista de partidos de una liga y las
// estadísticas avanzadas, que no vienen hechas y salen de los promedios de tiro.

// De la lista de partidos terminados, con el nombre y el escudo repetidos en cada uno, a una tabla de equipos y una lista
// ligera (de más reciente a más antiguo). La temporada actual es la última con partidos: la WNBA en invierno no tiene otra.
function assemble(list, fallbackSeason) {
  const games = [...new Map(list.map(g => [g.id, g])).values()].sort((a, b) => new Date(b.date) - new Date(a.date));
  const teams = {};
  const side = s => {
    teams[s.id] ||= { abbr: s.abbr, name: s.name, logo: s.logo };
    return { id: s.id, pts: s.pts, q: s.q };
  };
  return {
    currentSeason: games[0]?.season ?? fallbackSeason,
    teams,
    games: games.map(g => ({ id: g.id, date: g.date, season: g.season, type: g.type, home: side(g.home), away: side(g.away) }))
  };
}

const fix = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : null);

// Posesiones = tiros + 0,44 × tiros libres − rebotes de ataque + pérdidas (la estimación habitual). Las del rival son casi las
// mismas, por eso el rating defensivo también va sobre las propias.
function advanced({ pts, pa, fgm, fga, fg3m, fg3a, fta, orb, tov }) {
  const poss = fga + 0.44 * fta - orb + tov;
  const rows = [
    ['Posesiones', fix(poss)],
    ['Rating ofensivo', fix((pts / poss) * 100)],
    ['Rating defensivo', fix((pa / poss) * 100)],
    ['Rating neto', fix(((pts - pa) / poss) * 100)],
    ['Tiro efectivo %', fix(((fgm + 0.5 * fg3m) / fga) * 100)],
    ['Tiro real %', fix((pts / (2 * (fga + 0.44 * fta))) * 100)],
    ['Tiros que son triple %', fix((fg3a / fga) * 100)]
  ];
  return rows.filter(([, v]) => v != null).map(([label, value]) => ({ label, value, group: 'Avanzadas' }));
}

module.exports = { assemble, advanced };
