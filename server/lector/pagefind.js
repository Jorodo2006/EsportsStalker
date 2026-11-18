// Busca en una lista de la casa el partido de dos equipos y devuelve la dirección de su evento. Se ejecuta DENTRO de la página
// (el lector la pasa con toString), así que no puede usar nada de fuera: ni imports ni funciones del módulo.
function pageFind(teams, opts) {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const strip = s => norm(s).replace(/\b(e ?sports?|gaming|team|club|academy)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const al = t => [...new Set([t.name, t.code, ...(t.alt || [])].flatMap(x => [norm(x), strip(x)]).filter(x => x && x.length >= 2))];
  const A = al(teams[0]), B = al(teams[1]);
  // Una palabra distintiva del nombre (5 letras o más, no genérica): "Zelli" encuentra "Rigas Zelli" cuando lo tenemos como "Riga
  // Zelli". Los dos equipos tienen que salir en el mismo bloque, así que no empareja partidos de otros. Sólo con opts.words (equipos
  // de baloncesto): en tenis, "Carlos" o "Daniel" los comparten muchos jugadores
  const GEN = /^(basket|basketball|baloncesto|club|sporting|united|city|calcio|futbol|football|tennis|esports?)$/;
  const keyWords = t => [...new Set([t.name, ...(t.alt || [])].flatMap(x => norm(x).split(' ')).filter(w => w.length >= 5 && !GEN.test(w)))];
  const WA = opts.words ? keyWords(teams[0]) : [], WB = opts.words ? keyWords(teams[1]) : [];
  const has = (txt, list, ws = []) => { const n = ' ' + norm(txt) + ' '; return list.some(x => n.includes(' ' + x + ' ')) || ws.some(w => n.includes(' ' + w + ' ')); };
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cands = [...document.querySelectorAll(opts.selector || 'a,div,li,tr,section,article')]
    .filter(el => { const t = el.innerText || ''; return t.length < 400 && has(t, A, WA) && has(t, B, WB) && visible(el); })
    .sort((x, y) => (x.innerText || '').length - (y.innerText || '').length);
  // Los eventos que hay en un elemento (o en el que lo envuelve), por número: id -> dirección. Un contenedor con dos o más es una
  // lista de partidos, no un partido: con "Utah Jazz" en una fila y "Lakers" en la siguiente cumplía los dos nombres, y su primer
  // enlace era el de otro partido (Utah–Clippers leído como Utah–Lakers)
  const eventsOf = c => {
    const out = new Map();
    const put = (id, href) => { if (id && !out.has(id)) out.set(id, href); };
    for (const a of [c.closest(opts.href), ...c.querySelectorAll(opts.href)]) if (a) put((String(a.href).match(/event\/(\d+)/) || [])[1] || a.href, a.href);
    for (const e of [c.closest('[data-eventid]'), ...c.querySelectorAll('[data-eventid]')]) if (e) put(e.getAttribute('data-eventid'), '/sports/event/' + e.getAttribute('data-eventid'));
    return out;
  };
  for (const el of cands) {
    for (let c = el, i = 0; c && i < 6; c = c.parentElement, i++) {
      const evs = eventsOf(c);
      if (evs.size > 1) break;
      if (evs.size === 1) return [...evs.values()][0];
    }
  }
  if (opts.scroll) window.scrollBy(0, 1200);
  return null;
}

module.exports = { pageFind };
