// Lectura ligera: cuando se pide una lectura para un mercado concreto (el botón de una recomendación o del cupón, job.match.focus con
// la clave del comparador), de Betway sólo se leen las pestañas donde está ese mercado y no las diez del partido. Winamax no cuenta:
// su socket da el partido entero de una vez. Las demás pestañas no se pierden: cada página guardada sólo sustituye a la misma
// página (odds/bridge.js). Si no se sabe en qué pestaña está, se lee todo, como sin foco.
// all: los marketGroup del partido en Betway ("main-markets", "1st-half", "players", "points-rebounds"…; '' si no tiene pestañas)

// Estadística de las líneas de jugador de baloncesto (BASKET_STAT en odds.js) → su pestaña en Betway
const PLAYER_TAB = { Puntos: /^points(-over-under)?$/, 'Pts + Ast': /^points-assists$/, 'Pts + Reb': /^points-rebounds$/, 'Pts + Reb + Ast': /^points-assists-rebounds$/ };

function focusGroups(all, focus, sport) {
  if (!focus || !Array.isArray(all) || all.length <= 1) return all;
  const has = re => all.filter(g => re.test(g));
  const main = has(/^main-markets$/);
  const first = main.length ? main : all.slice(0, 1);
  const [type, per] = String(focus).split('|');
  let pick = [];
  if (type === 'player') {
    const tab = PLAYER_TAB[String(focus).split('|')[1]];
    pick = [...(tab ? has(tab) : []), ...has(/^players$/)];
    if (!pick.length) pick = has(/player|points|rebound|assist|three|steal|block/);
  } else if (/^\d+$/.test(per || '')) {
    const p = Number(per);
    // Las de un periodo, con la principal: así isPeriodCopy (odds.js) puede descartar la pestaña si Betway devuelve el partido entero
    const extra = p === 0
      ? (type === 'corners' ? has(/^corners$/) : sport === 'football' && /total/.test(type) ? has(/^goals$/) : [])
      : p <= 2 ? has(/half/) : p <= 14 ? has(/quarter/) : [];
    if (p !== 0 && !extra.length) return all;
    pick = [...first, ...extra];
  }
  return pick.length ? [...new Set(pick)] : all;
}

module.exports = { focusGroups };
