// ¿El texto de un partido de una apuesta ("UTAH @ LAC", "Albacete - Celta", "Alcaraz vs Sinner") nombra a este equipo? Lo usan los
// avisos de cuotas (bets/alerts.js) y la cuota de cierre (odds/closing.js) para unir una apuesta con el partido del comparador
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function mentionsTeam(event, team) {
  const e = ` ${norm(event)} `, name = norm(team?.name), code = norm(team?.code);
  if (name && e.includes(` ${name} `)) return true;
  if (code && code.length >= 2 && e.includes(` ${code} `)) return true;
  // Tenis y MMA: basta el apellido ("Alcaraz vs Sinner")
  const last = name.split(' ').pop();
  return !!last && last.length >= 4 && e.includes(` ${last} `);
}

module.exports = { norm, mentionsTeam };
