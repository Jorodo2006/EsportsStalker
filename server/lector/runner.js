// lector: hace en Docker, con Chromium sin cabeza, los trabajos de lectura de cuotas que antes hacía la extensión
// de Chrome. Pregunta al gateway cada pocos segundos (GET /jobs/next), abre Winamax y Betway, busca el partido,
// pasa el mismo lector del marcador (electron/bookmarklet/marcador.js, montado en /lector-src) y manda las cuotas.
// Es el mismo flujo que electron/extension/background.js, cambiando chrome.tabs/scripting por Playwright.
// No usa trucos anti-bot: si una casa bloquea el navegador, el trabajo termina con error y se ve en la app.
const fs = require('fs');
const { chromium } = require('playwright');

const APP = process.env.GATEWAY_URL || 'http://gateway:47365';
const LECTOR = process.env.LECTOR_FILE || '/lector-src/marcador.js';
const POLL = 5e3; // en local no cuesta nada, y así un "Actualizar cuotas" empieza enseguida
const sleep = ms => new Promise(r => setTimeout(r, ms));

// El lector se vuelve a leer en cada trabajo: si cambias marcador.js no hace falta reconstruir la imagen
const lectorCode = () => fs.readFileSync(LECTOR, 'utf8').replace(/__PORT__/g, '47365');

let browser = null;
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  return browser;
}

const post = (p, body) => fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })
  .then(r => r.json()).catch(() => null);

// ---------- utilidades de página (equivalen a las de la extensión) ----------
// Ejecuta una función de la página con sus argumentos; undefined si la página está cambiando
async function run(page, func, args = []) {
  try { return await page.evaluate(`(${func.toString()})(...${JSON.stringify(args)})`); } catch (_) { return undefined; }
}
async function until(page, func, args, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await run(page, func, args);
    if (r) return r;
    await sleep(700);
  }
  return null;
}
async function goTo(page, url) {
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (_) { /* seguimos: la página puede ir cargando */ }
  await sleep(1500);
}
async function openTab(ctx, url) {
  const page = await ctx.newPage();
  await goTo(page, url);
  return page;
}

// Pasa el lector por la página y espera su resultado
async function readPage(page, job, book) {
  await run(page, id => { window.__lolet_job = id; window.__lolet_fin = null; window.__lolet_snap = null; }, [job.id]);
  try { await page.evaluate(lectorCode()); } catch (e) { throw new Error('No se pudo ejecutar el lector: ' + e.message); }
  const fin = await until(page, () => window.__lolet_fin, [], 30000);
  if (!fin) throw new Error('El lector no ha terminado');
  if (fin.ok && fin.payload) {
    const r = await post('/odds', fin.payload);
    if (!r || !r.ok) throw new Error('La app no ha aceptado las cuotas');
    return fin.txt;
  }
  const snap = await run(page, () => window.__lolet_snap);
  if (snap) await post('/snapshot', { ...snap, motivo: 'lector: ' + fin.txt });
  throw new Error(fin.txt);
}

const snapshotOf = () => ({
  url: location.href, title: document.title, texto: document.body.innerText.slice(0, 300000),
  html: document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '').slice(0, 4000000)
});

// ---------- funciones que se ejecutan dentro de la página (copiadas de la extensión) ----------
function pageFind(teams, opts) {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const strip = s => norm(s).replace(/\b(e ?sports?|gaming|team|club|academy)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const al = t => [...new Set([t.name, t.code, ...(t.alt || [])].flatMap(x => [norm(x), strip(x)]).filter(x => x && x.length >= 2))];
  const A = al(teams[0]), B = al(teams[1]);
  const has = (txt, list) => { const n = ' ' + norm(txt) + ' '; return list.some(x => n.includes(' ' + x + ' ')); };
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cands = [...document.querySelectorAll(opts.selector || 'a,div,li,tr,section,article')]
    .filter(el => { const t = el.innerText || ''; return t.length < 400 && has(t, A) && has(t, B) && visible(el); })
    .sort((x, y) => (x.innerText || '').length - (y.innerText || '').length);
  const el = cands[0];
  if (!el) { if (opts.scroll) window.scrollBy(0, 1200); return null; }
  for (let c = el, i = 0; c && i < 6; c = c.parentElement, i++) {
    const a = c.closest(opts.href) || c.querySelector(opts.href);
    if (a) return a.href;
    const ev = c.closest('[data-eventid]') || c.querySelector('[data-eventid]');
    if (ev) return '/sports/event/' + ev.getAttribute('data-eventid');
  }
  return null;
}

// cfg: { cat } la categoría de LoL, o { sport, tours } un deporte y qué torneos mirar si no está en la portada
function winamaxFind(teams, cfg) {
  const s = window.PRELOADED_STATE;
  if (!s) return null;
  const norm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const strip = x => norm(x).replace(/\b(e ?sports?|gaming|team|club|academy|bc|bk|kk|fc|basket(ball)?)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const al = t => [...new Set([t.name, t.code, ...(t.alt || [])].flatMap(x => [norm(x), strip(x)]).filter(x => x && x.length >= 2))];
  const eq = (name, t) => { const n = norm(name), st = strip(name); return al(t).some(x => x === n || x === st || (x.length > 3 && (n.includes(x) || x.includes(n)))); };
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

// ---------- cada casa ----------
const BOOKS = {
  async winamax(job, ctx, say) {
    say('buscando', 'Buscando el partido…');
    let id = (String(job.urls.winamax || '').match(/match\/(\d+)/) || [])[1];
    const page = await openTab(ctx, id ? `https://www.winamax.es/apuestas-deportivas/match/${id}` : 'https://www.winamax.es/apuestas-deportivas/sports/9994/800000737');
    if (!id) {
      id = await until(page, winamaxFind, [[job.match.a, job.match.b], { cat: '800000737' }], 20000);
      if (!id || id === 'no') throw new Error('No encuentro el partido en Winamax');
      await goTo(page, `https://www.winamax.es/apuestas-deportivas/match/${id}`);
    }
    say('leyendo', 'Leyendo cuotas…');
    await sleep(1500);
    return readPage(page, job, 'winamax');
  },

  async betway(job, ctx, say) {
    say('buscando', 'Buscando el partido…');
    let ev = (String(job.urls.betway || '').match(/event\/(\d+)/) || [])[1], page;
    if (!ev) {
      const teams = [job.match.a, job.match.b];
      const opts = { href: 'a[href*="/sports/event/"]', selector: '[data-eventid],a[href*="/sports/event/"],div,li,article', scroll: true };
      const look = async ms => (String((await until(page, pageFind, [teams, opts], ms)) || '').match(/event\/(\d+)/) || [])[1];
      page = await openTab(ctx, 'https://betway.es/es/es/sports/cat/esports');
      ev = await look(10000);
      if (!ev) {
        const snap = await run(page, snapshotOf);
        if (snap) await post('/snapshot', { ...snap, book: 'betway', nombre: 'lista', motivo: 'lector: no encuentro el partido' });
        const comps = await run(page, () => {
          const lol = /league[- ]?of[- ]?legends|\blol\b|lck|lec|lpl|lcs|worlds|mundial|msi/i;
          const all = [...document.querySelectorAll('a[href]')].filter(a => /\/sports\/(grp|cat)\/e-?sports?\//i.test(a.getAttribute('href')));
          const seen = new Set(), out = [];
          for (const a of all) {
            const u = a.href.split('?')[0];
            if (seen.has(u)) continue;
            seen.add(u);
            const c = (a.closest('section,li,div') || a).innerText || '';
            out.push({ u, score: lol.test(a.getAttribute('href') + ' ' + a.textContent) ? 2 : lol.test(c.slice(0, 300)) ? 1 : 0 });
          }
          return out.sort((x, y) => y.score - x.score).map(x => x.u);
        }) || [];
        for (const u of comps.slice(0, 8)) {
          if (ev) break;
          say('buscando', 'Mirando ' + u.replace(/^https:\/\/betway\.es\/es\/es\/sports\//, '') + '…');
          await goTo(page, u);
          ev = await look(8000);
        }
      }
      if (!ev) throw new Error('No encuentro el partido en Betway (he guardado una foto de la lista)');
    }
    const base = `https://betway.es/es/es/sports/event/${ev}`;
    if (page) await goTo(page, base);
    else page = await openTab(ctx, base);
    const groups = await until(page, () => {
      const ids = [...document.querySelectorAll('[data-navitemid]')].map(e => e.getAttribute('data-navitemid')).filter(Boolean);
      return ids.length ? [...new Set(ids)] : null;
    }, [], 15000);
    if (!groups) throw new Error('Betway aún no tiene mercados para este partido');
    const hechos = [];
    for (const g of groups) {
      say('leyendo', `Leyendo ${g.replace(/---player-specials/, ' jugadores').replace('map-', 'mapa ').replace('main-markets', 'principales')}…`);
      await goTo(page, `${base}?marketGroup=${g}`);
      await until(page, () => document.querySelector('section[data-testid="market-table-section"] [data-testid="table-header-title"]'), [], 12000);
      try { hechos.push(await readPage(page, job, 'betway')); } catch (e) { if (groups.length === 1) throw e; }
    }
    if (!hechos.length) throw new Error('Sin cuotas');
    return hechos.join(' · ');
  }
};

// ---------- baloncesto ----------
// Torneos de Winamax que se miran si el partido no está en la portada de baloncesto, y lista de Betway de cada liga
const WINAMAX_TOURS = { nba: '^nba$', wnba: '^wnba$', euroleague: 'euroliga|euroleague', eurocup: 'eurocup|eurocopa' };
const BETWAY_LISTS = {
  nba: 'usa/nba', wnba: 'usa/wnba', euroleague: 'international-club/euroleague', eurocup: 'international-club/eurocup'
};

// Lee todas las pestañas de mercados de un partido de Betway (principales, jugadores, cuartos…)
async function betwayEvent(page, job, base, say, max = 10) {
  const groups = await until(page, () => {
    const ids = [...document.querySelectorAll('[data-navitemid]')].map(e => e.getAttribute('data-navitemid')).filter(Boolean);
    return ids.length ? [...new Set(ids)] : null;
  }, [], 15000) || [''];
  const hechos = [];
  for (const g of groups.slice(0, max)) {
    say('leyendo', `Leyendo ${g || 'mercados'}…`);
    if (g) await goTo(page, `${base}?marketGroup=${g}`);
    await until(page, () => document.querySelector('section[data-testid="market-table-section"] [data-testid="table-header-title"]'), [], 12000);
    try { hechos.push(await readPage(page, job, 'betway')); } catch (e) { if (groups.length === 1) throw e; }
  }
  if (!hechos.length) throw new Error('Sin cuotas');
  return hechos.join(' · ');
}

const BASKET_BOOKS = {
  async winamax(job, ctx, say) {
    say('buscando', 'Buscando el partido…');
    let id = (String(job.urls.winamax || '').match(/match\/(\d+)/) || [])[1];
    const page = await openTab(ctx, id ? `https://www.winamax.es/apuestas-deportivas/match/${id}` : 'https://www.winamax.es/apuestas-deportivas/sports/2');
    if (!id) {
      id = await until(page, winamaxFind, [[job.match.a, job.match.b], { sport: 2, tours: WINAMAX_TOURS[job.match.league] || 'nba|euro' }], 20000);
      if (!id || id === 'no') throw new Error('No encuentro el partido en Winamax');
      await goTo(page, `https://www.winamax.es/apuestas-deportivas/match/${id}`);
    }
    say('leyendo', 'Leyendo cuotas…');
    await sleep(1500);
    return readPage(page, job, 'winamax');
  },

  async betway(job, ctx, say) {
    say('buscando', 'Buscando el partido…');
    let ev = (String(job.urls.betway || '').match(/event\/(\d+)/) || [])[1], page;
    if (!ev) {
      const teams = [job.match.a, job.match.b];
      const opts = { href: 'a[href*="/sports/event/"]', selector: '[data-eventid],a[href*="/sports/event/"],div,li,article', scroll: true };
      const look = async ms => (String((await until(page, pageFind, [teams, opts], ms)) || '').match(/event\/(\d+)/) || [])[1];
      const list = BETWAY_LISTS[job.match.league];
      page = await openTab(ctx, `https://betway.es/es/es/sports/${list ? 'grp/basketball/' + list : 'cat/basketball'}`);
      ev = await look(12000);
      if (!ev && list) { await goTo(page, 'https://betway.es/es/es/sports/cat/basketball'); ev = await look(10000); }
      if (!ev) {
        const snap = await run(page, snapshotOf);
        if (snap) await post('/snapshot', { ...snap, book: 'betway', nombre: 'lista-basket', motivo: 'lector: no encuentro el partido de baloncesto' });
        throw new Error('No encuentro el partido en Betway (he guardado una foto de la lista)');
      }
    }
    const base = `https://betway.es/es/es/sports/event/${ev}`;
    if (page) await goTo(page, base);
    else page = await openTab(ctx, base);
    return betwayEvent(page, job, base, say);
  }
};

// ---------- trabajos ----------
async function runJob(job) {
  const say = (book, estado, msg) => post('/auto/progress', { id: job.id, book, estado, msg });
  const ctx = await (await getBrowser()).newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid', viewport: { width: 1366, height: 900 } });
  try {
    const flows = job.match.sport === 'basket' ? BASKET_BOOKS : BOOKS;
    await Promise.all(job.books.map(async book => {
      if (!flows[book]) return say(book, 'error', 'Casa no soportada');
      try { await say(book, 'ok', await flows[book](job, ctx, (estado, m) => say(book, estado, m))); }
      catch (e) { await say(book, 'error', (e && e.message) || String(e)); }
    }));
  } finally {
    await ctx.close().catch(() => {});
    await say(null, 'fin');
  }
}

async function loop() {
  for (;;) {
    let job = null;
    try {
      const r = await fetch(`${APP}/jobs/next?lector=docker`);
      if (r.status === 200) job = await r.json().catch(() => null);
    } catch (_) { /* el gateway aún no está */ }
    if (job && job.id) {
      console.log(`Trabajo ${job.id}: ${job.match.a.name} vs ${job.match.b.name} (${job.source})`);
      try { await runJob(job); } catch (e) { console.error('Trabajo', job.id, e.message); browser = null; }
      continue; // si hay más en cola, el siguiente sin esperar
    }
    await sleep(POLL);
  }
}

console.log('lector de cuotas en marcha (Winamax y Betway con Chromium)');
loop();
