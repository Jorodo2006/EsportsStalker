// lector: hace en Docker, con Chromium sin cabeza, los trabajos de lectura de cuotas que antes hacía la extensión
// de Chrome. Pregunta al gateway cada pocos segundos (GET /jobs/next), abre Winamax y Betway, busca el partido,
// pasa el mismo lector del marcador (chrome/bookmarklet/marcador.js, montado en /lector-src) y manda las cuotas.
// Es el mismo flujo que chrome/extension/background.js, cambiando chrome.tabs/scripting por Playwright.
// No usa trucos anti-bot: si una casa bloquea el navegador, el trabajo termina con error y se ve en la app.
const fs = require('fs');
const { chromium } = require('playwright');

const APP = process.env.GATEWAY_URL || 'http://gateway:47365';
const { focusGroups } = require('./foco');
const { blocked } = require('./red');
const { pageFind } = require('./pagefind'); // se ejecuta dentro de la página: ver pagefind.js
const { winamaxFind } = require('./winamaxfind'); // ídem
const LECTOR = process.env.LECTOR_FILE || '/lector-src/marcador.js';
const POLL = 5e3; // en local no cuesta nada, y así un "Actualizar cuotas" empieza enseguida
const JOB_MAX = 4 * 60e3; // una lectura normal tarda de 10 a 40 s
const sleep = ms => new Promise(r => setTimeout(r, ms));

// El lector se vuelve a leer en cada trabajo: si cambias marcador.js no hace falta reconstruir la imagen
const lectorCode = () => fs.readFileSync(LECTOR, 'utf8').replace(/__PORT__/g, '47365');

let browser = null;
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  return browser;
}

// Con LECTOR_TOKEN (producción) el gateway sólo atiende al lector si manda este token
const AUTH = process.env.LECTOR_TOKEN ? { 'x-lector-token': process.env.LECTOR_TOKEN } : {};

// Con tiempo máximo: sin él, un aviso que no contesta (la red cambia a mitad) dejaba la lectura esperando para siempre
const post = (p, body) => fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'text/plain', ...AUTH }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
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
    if (!r || !r.ok) throw new Error((r && r.error) || 'La app no ha aceptado las cuotas');
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

// Las funciones que se ejecutan dentro de la página (copiadas de la extensión) están en winamaxfind.js y pagefind.js

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
// NBL: Winamax la llama "NBL" (en Australia; la checa también se llama así, pero el partido se busca por los equipos).
// La lista de Betway no se ha podido ver: si no existe, se busca en la de baloncesto
const WINAMAX_TOURS = { nba: '^nba$', wnba: '^wnba$', euroleague: 'euroliga|euroleague', eurocup: 'eurocup|eurocopa', nbl: '\\bnbl\\b' };
const BETWAY_LISTS = {
  nba: 'usa/nba', wnba: 'usa/wnba', euroleague: 'international-club/euroleague', eurocup: 'international-club/eurocup', nbl: 'australia/nbl'
};

// Fútbol por competición de la app: torneo de Winamax (su nombre; "LaLiga " lleva un espacio al final) y lista de Betway.
// Hay ligas con el mismo nombre en otros países ("Serie A" de Brasil, "Bundesliga" de Austria): se miran los primeros que salen
const FOOTBALL_TOURS = {
  laliga: '^\\s*laliga\\s*$', segunda: '^segunda divisi[oó]n$', copa: '^copa del rey$', premier: '^premier league$',
  seriea: '^serie a$', bundesliga: '^bundesliga$', ligue1: '^ligue 1', champions: '^champions league$', europa: '^europa league$',
  conference: '^conference league$',
  // Australia: Winamax la llama «A-League» (o «A-League Men»); se busca por los equipos igualmente
  aleague: '^a-?league( men)?\\b|^a-?liga\\b',
  // Selecciones. Winamax tiene otra "Nations League " (con espacio) en MultiFútbol, que son combinadas: no la coge el ^…$
  nations: '^nations league$', amistosos: '^partidos amistosos internacionales$',
  // Femenino: Winamax lo marca con "(F)". La Liga F y la WSL no salían en los parones; los nombres son los más probables
  // (la de Escocia también se llama "Primera División (F)": se mira de más, pero el partido se busca por los equipos)
  wchampions: '^champions league \\(f\\)$', ligaf: '^liga f\\b|^primera divisi[oó]n \\(f\\)$', wsl: '^(women.?s )?super league( \\(f\\))?$|^wsl\\b'
};
const FOOTBALL_LISTS = {
  laliga: 'spain/la-liga', segunda: 'spain/la-liga-2', copa: 'spain/copa-del-rey', premier: 'england/premier-league',
  seriea: 'italy/serie-a', bundesliga: 'germany/bundesliga', ligue1: 'france/ligue-1', champions: 'european-cups/uefa-champions-league',
  europa: 'european-cups/uefa-europa-league', conference: 'european-cups/uefa-conference-league', aleague: 'australia/a-league',
  nations: 'uefa-international-competitions/uefa-nations-league', amistosos: 'international/friendlies'
  // Femenino: Betway no tiene una lista fija que se haya podido ver; se busca en la portada de fútbol
};

// Lee todas las pestañas de mercados de un partido de Betway (principales, jugadores, cuartos…)
async function betwayEvent(page, job, base, say, max = 10) {
  const all = await until(page, () => {
    const ids = [...document.querySelectorAll('[data-navitemid]')].map(e => e.getAttribute('data-navitemid')).filter(Boolean);
    return ids.length ? [...new Set(ids)] : null;
  }, [], 15000) || [''];
  // Pestañas que repiten lo de otras (en fútbol "Crea tu apuesta", "Tiempo completo" y "1er Tiempo")
  const skip = cfgOf(job).skip;
  // Con foco (un mercado concreto), sólo sus pestañas: foco.js
  const groups = focusGroups(skip ? all.filter(g => !skip.test(g)) : all, job.match.focus, job.match.sport);
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

// Cada deporte: id del deporte en Winamax, qué torneos mirar si no está en la portada y lista de Betway
const SPORT_CFG = {
  basket: {
    wm: 2, tours: job => WINAMAX_TOURS[job.match.league] || 'nba|euro',
    bw: job => (BETWAY_LISTS[job.match.league] ? 'grp/basketball/' + BETWAY_LISTS[job.match.league] : null), bwCat: 'cat/basketball'
  },
  // Tenis: el torneo va en league ("Rolex Paris Masters"); se buscan sus torneos por la palabra más larga del nombre. Los dobles
  // tienen sus propios torneos en Winamax ("CH75 Sydney, Dobles", "ATP - Finals, Dobles"): la ciudad (antes de la coma, "Sydney,
  // Australia") o la palabra más larga, y "dobles"
  tennis: {
    wm: 5, tours: job => {
      const league = String(job.match.league || '');
      const word = (job.match.doubles ? league.split(',')[0] : league).split(/[^A-Za-z]+/).sort((a, b) => b.length - a.length)[0];
      return job.match.doubles ? `(${word || 'atp|wta'}).*dobles` : word || 'atp|wta';
    },
    bw: () => null, bwCat: 'cat/tennis'
  },
  // Fútbol: la competición va en league con el id de la app ("laliga", "premier"…)
  football: {
    wm: 1, tours: job => FOOTBALL_TOURS[job.match.league] || '^\\s*laliga\\s*$|^premier league$|^champions league$',
    bw: job => (FOOTBALL_LISTS[job.match.league] ? 'grp/soccer/' + FOOTBALL_LISTS[job.match.league] : null), bwCat: 'cat/soccer',
    skip: /^(SGP|marketGroup\.fullTime|1st half)$/
  },
  // MMA: Winamax tiene el deporte 117 (torneos "UFC 334: …", "PFL Dubai"). Betway agrupa por cartel: "ufc-334", "ufc-fight-night", "pfl"
  mma: {
    wm: 117, tours: job => ({ ufc: 'ufc', pfl: 'pfl', wow: 'wow' })[job.match.league] || 'ufc|pfl',
    bw: job => {
      const ev = String(job.match.event || '');
      const n = /^UFC (\d+)/i.exec(ev);
      const base = 'grp/ufc---martial-arts/upcoming-fights/';
      return job.match.league === 'pfl' ? base + 'pfl' : n ? `${base}ufc-${n[1]}` : /fight night/i.test(ev) ? base + 'ufc-fight-night' : null;
    },
    bwCat: 'cat/ufc---martial-arts'
  }
};
const cfgOf = job => SPORT_CFG[job.match.sport] || SPORT_CFG.basket;

// Betway cambió su portada de tenis (noviembre de 2026): ya sólo enseña tres "Eventos populares", y el resto de partidos están en
// la página de cada torneo ("Ligas principales": grp/tennis/wta/wta-finals, grp/tennis/challenger/sydney---australia…). Se
// prueban los torneos de esa portada, primero los que más se parecen al del partido ("FAGE WTA Finals Indian Wells" → WTA Finals),
// sin los de dobles y como mucho 4: si no, en 3 días encontró 1 de 35 partidos. Para un dobles, al revés: sólo los de dobles (en los
// Challenger Betway no los tiene: en la página de Sídney, en noviembre de 2026, sólo estaban los individuales)
const tennisGroupLinks = () => [...document.querySelectorAll('a[href*="/sports/grp/tennis/"]')]
  .map(a => ({ href: a.getAttribute('href'), text: a.innerText || '' }));
function rankTennisGroups(links, league, doubles = false) {
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = new Set(norm(league).split(/[^a-z]+/).filter(w => w.length >= 4 && !['open', 'tour', 'tennis', 'presented'].includes(w)));
  const score = l => norm(`${l.text} ${l.href}`).split(/[^a-z]+/).filter(w => words.has(w)).length;
  const isDoubles = l => /dobles|doubles/i.test(l.href + l.text);
  const unique = [...new Map((links || []).filter(l => l.href && isDoubles(l) === !!doubles).map(l => [l.href, l])).values()];
  return unique.map(l => ({ href: l.href, s: score(l) })).sort((a, b) => b.s - a.s).slice(0, 4).map(l => l.href);
}

const BASKET_BOOKS = {
  async winamax(job, ctx, say) {
    say('buscando', 'Buscando el partido…');
    let id = (String(job.urls.winamax || '').match(/match\/(\d+)/) || [])[1];
    const page = await openTab(ctx, id ? `https://www.winamax.es/apuestas-deportivas/match/${id}` : `https://www.winamax.es/apuestas-deportivas/sports/${cfgOf(job).wm}`);
    if (!id) {
      id = await until(page, winamaxFind, [[job.match.a, job.match.b], { sport: cfgOf(job).wm, tours: cfgOf(job).tours(job), doubles: !!job.match.doubles }], 20000);
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
      const opts = { href: 'a[href*="/sports/event/"]', selector: '[data-eventid],a[href*="/sports/event/"],div,li,article', scroll: true, words: (job.match.sport || 'basket') === 'basket', doubles: !!job.match.doubles };
      const look = async ms => (String((await until(page, pageFind, [teams, opts], ms)) || '').match(/event\/(\d+)/) || [])[1];
      const list = cfgOf(job).bw(job);
      page = await openTab(ctx, `https://betway.es/es/es/sports/${list || cfgOf(job).bwCat}`);
      ev = await look(12000);
      if (!ev && list) { await goTo(page, `https://betway.es/es/es/sports/${cfgOf(job).bwCat}`); ev = await look(10000); }
      if (!ev && job.match.sport === 'tennis') {
        for (const href of rankTennisGroups(await run(page, tennisGroupLinks), job.match.league, !!job.match.doubles)) {
          say('buscando', 'Buscando en los torneos…');
          await goTo(page, `https://betway.es${href}`);
          ev = await look(8000);
          if (ev) break;
        }
      }
      if (!ev) {
        const snap = await run(page, snapshotOf);
        if (snap) await post('/snapshot', { ...snap, book: 'betway', nombre: `lista-${job.match.sport || 'lol'}`, motivo: 'lector: no encuentro el partido' });
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
// done: cómo ha acabado cada casa, para saber cuáles cerrar si la lectura se cuelga
async function runJob(job, done = {}) {
  const say = (book, estado, msg) => { if (book && (estado === 'ok' || estado === 'error')) done[book] = estado; return post('/auto/progress', { id: job.id, book, estado, msg }); };
  const ctx = await (await getBrowser()).newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid', viewport: { width: 1366, height: 900 } });
  try {
    // Baloncesto y tenis van por el mismo camino (con su configuración); LoL por el suyo
    const flows = SPORT_CFG[job.match.sport] ? BASKET_BOOKS : BOOKS;
    await Promise.all(job.books.map(async book => {
      if (!flows[book]) return say(book, 'error', 'Casa no soportada');
      // Si la red no deja llegar a la casa, decirlo en vez de buscar en una página de bloqueo y acabar en "No encuentro el partido"
      const why = await blocked(book).catch(() => null);
      if (why) return say(book, 'error', why);
      const read = j => flows[book](j, ctx, (estado, m) => say(book, estado, m));
      try {
        let msg;
        try { msg = await read(job); } catch (e) {
          // La dirección guardada puede ser de otro partido entre los mismos equipos (se repiten: NBA, tenis, LoL) o de uno que ya
          // no existe: se busca el partido otra vez desde la lista, en la misma lectura
          if (!job.urls?.[book]) throw e;
          await say(book, 'buscando', 'La dirección guardada no vale: buscando el partido…');
          msg = await read({ ...job, urls: { ...job.urls, [book]: '' } });
        }
        await say(book, 'ok', msg);
      } catch (e) { await say(book, 'error', (e && e.message) || String(e)); }
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
      const r = await fetch(`${APP}/jobs/next?lector=docker`, { headers: AUTH, signal: AbortSignal.timeout(15000) });
      if (r.status === 200) job = await r.json().catch(() => null);
    } catch (_) { /* el gateway aún no está */ }
    if (job && job.id) {
      console.log(`Trabajo ${job.id}: ${job.match.a.name} vs ${job.match.b.name} (${job.source})`);
      // Una lectura que no acaba (una página que no responde, la red que cambia a mitad) no puede parar al lector: antes se quedaba
      // esperándola para siempre y ninguna otra, tampoco «Actualizar cuotas», se hacía hasta reiniciar el contenedor
      const done = {};
      let timer;
      const hung = new Promise((_, no) => { timer = setTimeout(() => no(new Error('colgada')), JOB_MAX); });
      try { await Promise.race([runJob(job, done), hung]); } catch (e) {
        console.error('Trabajo', job.id, e.message);
        const b = browser; browser = null;
        // Al cerrar el navegador, lo que esperaba la lectura falla y la siguiente abre uno nuevo
        if (b) b.close().catch(() => {});
        if (e.message === 'colgada') {
          for (const book of job.books || []) if (!done[book]) await post('/auto/progress', { id: job.id, book, estado: 'error', msg: `La lectura de ${book === 'winamax' ? 'Winamax' : 'Betway'} no ha terminado en ${JOB_MAX / 60e3} min y se ha cancelado` });
          await post('/auto/progress', { id: job.id, book: null, estado: 'fin' });
        }
      } finally { clearTimeout(timer); }
      continue; // si hay más en cola, el siguiente sin esperar
    }
    await sleep(POLL);
  }
}

console.log('lector de cuotas en marcha (Winamax y Betway con Chromium)');
loop();
