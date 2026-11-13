// WOW (organización española, wowmma.com): carteleras y resultados leídos de su web (Webflow, sin API). Su robots.txt permite
// rastrear todo salvo las rutas con parámetros (/*?*): aquí nunca se pide una URL con "?". Peticiones de una en una, con
// User-Agent propio y caché larga. Si la web cambia de diseño, el lector devuelve vacío y el resto de MMA sigue funcionando.
const BASE = 'https://www.wowmma.com';
const UA = 'Sharpex/1.0 (lector de carteleras)';
const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ', apos: "'" };

const decode = s => String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
}).replace(/\s+/g, ' ').trim();

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// El evento: nombre, fecha y ciudad de la cabecera. La web no da la hora: se pone las 19:00 UTC (20:00-21:00 en España)
function parseMeta(html, slug) {
  const h1 = /<h1[^>]*class="[^"]*wow-title-big[^"]*"[^>]*>([^<]*)</.exec(html || '');
  const d = /wow-event-short[^"]*"[^>]*>\s*([A-Za-z]+) (\d{1,2}), (\d{4})\s*</.exec(html || '');
  const month = d && MONTHS[d[1].toLowerCase()];
  if (!h1 || !month) return null;
  const city = /wow-event-taxonomy">[\s\S]*?<\/div>\s*<p[^>]*>([^<]*)</.exec(html)?.[1];
  const iso = `${d[3]}-${String(month).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}T19:00:00Z`;
  return { slug, name: decode(h1[1]), date: iso, city: decode(city) };
}

const methodOf = t => {
  const s = String(t || '').trim().toUpperCase();
  if (!s) return '';
  if (/^T?KO$/.test(s) || s === 'TKO') return 'ko';
  if (s.startsWith('SUB')) return 'sub';
  if (/^(UD|SD|MD|DEC)/.test(s)) return 'dec';
  return 'other';
};

// "3.12" → "3:12"; "5" → "5:00"
const timeOf = t => {
  const s = String(t || '').trim();
  if (!s) return '';
  const [m, sec = '0'] = s.split('.');
  return `${m}:${sec.padStart(2, '0')}`;
};

const num = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const texts = (html, re) => [...html.matchAll(re)].map(m => decode(m[1]));

// "Brian Hooi" → "brian-hooi": el id del combate lleva a los dos luchadores, no su posición en la página (si WOW añade o quita un
// combate, los demás no cambian de id y una apuesta no acaba resuelta con el resultado de otro)
const kebab = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 22);

function fighter(name, side, specs) {
  const parts = name.replace(/"[^"]*"/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  const last = parts.slice(1).join(' ') || parts[0] || '';
  return {
    id: `wow:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: name.replace(/\s*"[^"]*"\s*/g, ' ').replace(/\s+/g, ' ').trim(),
    short: last && parts[0] ? `${parts[0][0]}. ${last}` : name, country: '', flag: side.flag, record: specs.record, photo: side.photo,
    alt: [...new Set([last, parts[0] && last ? `${last} ${parts[0][0]}` : ''].filter(Boolean))],
    age: specs.age, weightKg: specs.weight, heightM: specs.height
  };
}

// Combates profesionales del evento (la pestaña AMATEUR no entra). Cada combate es un bloque "wow-result-fight-element": el lado
// rojo es el primero (a) y el azul el segundo (b); el ganador lleva la etiqueta GANADOR dentro de su lado.
function parseEvent(html, slug) {
  const full = String(html || '');
  const cut = full.search(/data-w-tab="AMATEUR"\s+class="tab-pane/);
  const pro = cut > 0 ? full.slice(0, cut) : full;
  const meta = parseMeta(full, slug);
  // Sin fecha (la web cambió de diseño) no hay en qué día poner los combates: mejor ninguno que uno en todos los días
  if (!meta?.date) return [];
  const blocks = pro.split('class="wow-result-fight-element').slice(1);
  const out = [];
  blocks.forEach((b, i) => {
    const names = texts(b, /class="wow-fighter-name[^"]*"[^>]*>([^<]*)</g);
    if (names.length < 2) return;
    const azul = b.indexOf('wow-fighter-lado-azul');
    const side = (from, to) => {
      const seg = b.slice(from, to < 0 ? undefined : to);
      return { flag: /class="bandera"\s+src="([^"]*)"/.exec(seg)?.[1] || '', photo: /class="wow-fighter-image"\s+src="([^"]*)"/.exec(seg)?.[1] || '' };
    };
    const sa = side(0, azul), sb = side(azul, -1);
    // Valores [rojo, etiqueta, azul] de edad, peso, altura y récord, en ese orden
    const rows = [...b.matchAll(/class="wow-fighter-specs-flex">([\s\S]*?)<\/div>/g)].map(m => texts(m[1], /<p[^>]*>([^<]*)</g));
    const spec = k => [rows[k]?.[0] ?? '', rows[k]?.[2] ?? ''];
    const [age, weight, height, record] = [0, 1, 2, 3].map(spec);
    const specText = texts(b, /class="wow-spec-text"[^>]*>([^<]*)</g); // tiempo, asaltos, técnica
    const label = b.indexOf('wow-fight-winner-label');
    const tech = specText[2] || '';
    const done = label >= 0 || !!tech;
    const f = {
      id: `wow:${slug}:${kebab(names[0])}-vs-${kebab(names[1])}`, org: 'wow', orgName: 'WOW', event: meta?.name || slug, eventId: slug, date: meta?.date || '',
      state: done ? 'post' : 'pre', status: done ? 'Final' : '', weightClass: texts(b, /class="wow-event-mode-2"[^>]*>([^<]*)</g)[0] || '',
      title: false, rounds: 3, cardPos: i + 1, venue: '', city: meta?.city || '',
      a: fighter(names[0], sa, { record: record[0], age: num(age[0]), weight: num(weight[0]), height: num(height[0]) }),
      b: fighter(names[1], sb, { record: record[1], age: num(age[1]), weight: num(weight[1]), height: num(height[1]) })
    };
    if (done) {
      f.result = {
        winner: label < 0 ? null : azul >= 0 && label > azul ? 'b' : 'a', method: methodOf(tech),
        round: num(specText[1]), time: timeOf(specText[0]), draw: false, noContest: false
      };
    }
    out.push(f);
  });
  return out;
}

// Eventos del sitemap, del número más alto (el más nuevo) al más bajo
function slugsOf(xml) {
  const slugs = [...new Set([...String(xml || '').matchAll(/\/wow-events\/([a-z0-9-]+)/g)].map(m => m[1]))];
  const n = s => parseInt(/wow-(\d+)/.exec(s)?.[1] || '0', 10);
  return slugs.sort((x, y) => n(y) - n(x));
}

// Descarga de texto con caché en memoria: sirve lo guardado si la web falla, y de una en una para no cargarla
let queue = Promise.resolve();
const mem = new Map(), pending = new Map();
const STALE = 24 * 3600e3; // lo caducado hace menos se sirve al momento mientras se renueva por detrás
function getText(url, ttlMs) {
  const hit = mem.get(url);
  const age = hit ? Date.now() - hit.t : Infinity;
  if (hit && age < ttlMs) return Promise.resolve(hit.v);
  const load = () => {
    if (!pending.has(url)) pending.set(url, fetchText(url, hit).finally(() => pending.delete(url)));
    return pending.get(url);
  };
  if (hit && age < ttlMs + STALE) { load().catch(() => {}); return Promise.resolve(hit.v); }
  return load();
}
function fetchText(url, hit) {
  const job = queue.then(async () => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`respondió ${res.status}`);
      const v = await res.text();
      mem.set(url, { t: Date.now(), v });
      return v;
    } catch (e) {
      if (hit) return hit.v;
      throw new Error(`No se pudo leer WOW (${e.message})`);
    }
  });
  queue = job.catch(() => {});
  return job;
}

// Combates de los últimos `n` eventos, pero sin esperar a WOW más de `ms`: si la web va lenta o está caída, UFC y PFL no se quedan
// esperándola (la descarga sigue por detrás y la próxima vez ya está)
function recentWithin(ms, n = 8, get = getText) {
  return Promise.race([recent(n, get).catch(() => []), new Promise(r => setTimeout(() => r([]), ms))]);
}

// Combates de los últimos `n` eventos (los futuros y los pasados más recientes). Las páginas de eventos ya jugados no cambian:
// 24 h; las futuras, 30 min (la cartelera se va publicando)
const finished = new Set();
async function recent(n = 8, get = getText) {
  const slugs = slugsOf(await get(`${BASE}/sitemap.xml`, 6 * 3600e3)).slice(0, n);
  const out = [];
  for (const slug of slugs) {
    try {
      const html = await get(`${BASE}/wow-events/${slug}`, finished.has(slug) ? 24 * 3600e3 : 30 * 60e3);
      const list = parseEvent(html, slug);
      if (list.length && list.every(f => f.state === 'post')) finished.add(slug);
      out.push(...list);
    } catch (e) { console.error(`[mma] WOW ${slug}:`, e.message); }
  }
  return out;
}

// Un solo evento por su slug (la ficha de un combate antiguo). El slug se valida: nunca se pide una URL con parámetros
async function event(slug, get = getText) {
  if (!/^wow-\d+[a-z0-9-]*$/.test(String(slug || ''))) throw new Error('Evento WOW no válido');
  return parseEvent(await get(`${BASE}/wow-events/${slug}`, 24 * 3600e3), slug);
}

module.exports = { parseEvent, parseMeta, slugsOf, methodOf, recent, recentWithin, event, getText };
