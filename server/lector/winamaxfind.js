'use strict';
// Busca un partido en el estado de Winamax (PRELOADED_STATE) y, si no está en la portada, en sus torneos por el socket. Se ejecuta
// DENTRO de la página (el lector la pasa con toString), así que no puede usar nada de fuera: ni imports ni funciones del módulo.
// Está aparte de runner.js (que carga Playwright) para poder probarla: server/test/winamaxfind.test.js

// cfg: { cat } la categoría de LoL, o { sport, tours } un deporte y qué torneos mirar si no está en la portada
function winamaxFind(teams, cfg) {
  const s = window.PRELOADED_STATE;
  if (!s) return null;
  const norm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const strip = x => norm(x).replace(/\b(e ?sports?|gaming|team|club|academy|bc|bk|kk|fc|basket(ball)?)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const al = t => [...new Set([t.name, t.code, ...(t.alt || [])].flatMap(x => [norm(x), strip(x)]).filter(x => x && x.length >= 2))];
  // Errata de una letra en el apellido con la misma inicial ("Charlie Radke" por "Charles Radtke"): las casas no escriben igual
  const near = (x, y) => {
    if (Math.abs(x.length - y.length) > 1) return false;
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i++;
    return x.slice(i + 1) === y.slice(i + 1) || x.slice(i) === y.slice(i + 1) || x.slice(i + 1) === y.slice(i);
  };
  const fuzzy = (name, t) => {
    const wn = norm(name).split(' ').filter(Boolean), ln = wn[wn.length - 1];
    return [t.name, ...(t.alt || [])].some(full => {
      const wt = norm(full).split(' ').filter(Boolean), lt = wt[wt.length - 1];
      return wt.length >= 2 && wn.length >= 2 && wt[0][0] === wn[0][0] && lt.length >= 5 && ln.length >= 5 && lt !== ln && near(lt, ln);
    });
  };
  // MMA: nombre y apellido (o su inicial); el apellido solo no basta ("Silva", "Rodriguez" son de muchos luchadores)
  const wordsOf = s => norm(s).split(' ').filter(Boolean);
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  const strictEq = (name, t) => {
    const nw = wordsOf(name), tw = wordsOf(t.name);
    if (!nw.length || !tw.length) return false;
    if (tw.length === 1) return nw.join('').includes(tw[0]);
    const ln = tw[tw.length - 1], fn = tw[0];
    return nw.some(x => x === ln || (ln.length >= 5 && x.length >= 5 && dist(x, ln) <= 1)) && nw.some(x => x.startsWith(fn) || fn.startsWith(x) || (fn.length >= 6 && x.length >= 6 && dist(fn, x) <= 2));
  };
  // Una palabra distintiva en común ("Zelli" en "Rigas Zelli" y "Riga Zelli"); sólo en baloncesto (en tenis los nombres de pila se
  // repiten) y sólo vale si el otro equipo también coincide (pick)
  const GEN = /^(basket|basketball|baloncesto|club|sporting|united|city|calcio|futbol|football|tennis|esports?)$/;
  const shares = (name, t) => { const ws = new Set(norm(name).split(' ').filter(w => w.length >= 5 && !GEN.test(w))); return [t.name, ...(t.alt || [])].some(x => norm(x).split(' ').some(w => ws.has(w))); };
  const eqOne = (name, t) => { if (cfg.sport === 117) return strictEq(name, t); const n = norm(name), st = strip(name); return al(t).some(x => x === n || x === st || (x.length > 3 && (n.includes(x) || x.includes(n)))) || fuzzy(name, t) || (cfg.sport === 2 && shares(name, t)); };
  // Dobles de tenis (cfg.doubles): nuestra pareja "Orlando Luz / Rafael Matos" contra "Luz O. / Matos R." o "Matos/Luz". Cada mitad del
  // nombre de Winamax tiene que casar con un jugador distinto, en cualquier orden: una pareja con un solo jugador en común no vale. Es
  // la idea de pairScore en server/services/odds/equipos.js, copiada porque esto corre dentro de la página. Y al revés: en tenis, un
  // nombre con barra es un dobles y no puede ser el de un individual
  // Cada jugador, por una palabra de su apellido sin partículas ("Reyes" en "M.A.Reyes-Varela" para "Miguel Angel Reyes", "Trotter"
  // en "J.Trotter" para "James Kent Trotter") o por las reglas de un jugador
  const halves = x => String(x || '').split('/').map(y => y.trim()).filter(Boolean);
  const player = full => { const w = String(full).trim().split(/\s+/), last = w.slice(1).join(' '); return { name: full, alt: [last, w[0][0] + '. ' + last, last + ' ' + w[0][0]] }; };
  const PARTICLE = /^(van|von|der|den|del|dos|das|los|las|les)$/;
  const surnameOf = full => { const w = wordsOf(full).slice(1), k = w.filter(x => x.length >= 3 && !PARTICLE.test(x)); return k.length ? k : w.slice(-1); };
  const sameOne = (half, full) => surnameOf(full).some(w => wordsOf(half).includes(w)) || eqOne(half, player(full));
  const pairEq = (name, t) => {
    const mine = halves(t.name), theirs = halves(name);
    if (mine.length !== 2 || theirs.length !== 2) return false;
    return (sameOne(theirs[0], mine[0]) && sameOne(theirs[1], mine[1])) || (sameOne(theirs[0], mine[1]) && sameOne(theirs[1], mine[0]));
  };
  const eq = (name, t) => (cfg.doubles ? pairEq(name, t) : cfg.sport === 5 && halves(name).length === 2 ? false : eqOne(name, t));
  const pick = matches => {
    for (const m of Object.values(matches || {})) {
      if (!m || !m.competitor1Name || (cfg.sport && m.sportId !== cfg.sport)) continue;
      const a = m.competitor1Name, b = m.competitor2Name;
      if ((eq(a, teams[0]) && eq(b, teams[1])) || (eq(a, teams[1]) && eq(b, teams[0]))) return String(m.matchId);
    }
    return null;
  };
  const hit = pick(s.matches);
  if (hit) return hit;
  const rx = cfg.tours ? new RegExp(cfg.tours, 'i') : null;
  const tours = cfg.cat ? ((s.categories && s.categories[cfg.cat] && s.categories[cfg.cat].tournaments) || [])
    : ((s.sports && s.sports[cfg.sport] && s.sports[cfg.sport].categories) || [])
      .flatMap(c => (s.categories && s.categories[c] && s.categories[c].tournaments) || [])
      .filter(t => rx && rx.test((s.tournaments && s.tournaments[t] && s.tournaments[t].tournamentName) || '')).slice(0, 12);
  if (!tours.length) return 'no';
  return new Promise(resolve => {
    const state = {};
    const merge = (t, x) => { for (const k of Object.keys(x)) { const v = x[k]; if (v && typeof v === 'object' && !Array.isArray(v)) { if (!t[k] || typeof t[k] !== 'object' || Array.isArray(t[k])) t[k] = {}; merge(t[k], v); } else t[k] = v; } };
    let sent = false, quiet = null, over = false;
    const ws = new WebSocket('wss://sports-eu-west-3.winamax.es/uof-sports-server/socket.io/?language=ES&version=3.72.0&embed=false&EIO=3&transport=websocket');
    const done = () => { if (over) return; over = true; try { ws.close(); } catch (_) {} resolve(pick(state.matches) || 'no'); };
    const send = () => { if (sent) return; sent = true; tours.forEach(t => ws.send('42' + JSON.stringify(['m', { route: 'tournament:' + t }]))); quiet = setTimeout(done, 2500); };
    setTimeout(done, 12000);
    ws.onmessage = ev => {
      const d = String(ev.data);
      if (d.charAt(0) === '0') setTimeout(send, 800);
      else if (d === '40') send();
      else if (d.slice(0, 2) === '42') { try { const x = JSON.parse(d.slice(2)); if (x[0] === 'm' && x[1]) merge(state, x[1]); } catch (_) {} if (sent) { clearTimeout(quiet); quiet = setTimeout(done, 1500); } }
    };
    ws.onerror = done;
  });
}

module.exports = { winamaxFind };
