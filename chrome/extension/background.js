// Extensión de Statex. Hace los trabajos de lectura de cuotas del backend: abre las casas en
// pestañas de fondo, busca el partido por el nombre de los equipos, lee las cuotas con el mismo lector del
// marcador (lector.js) y se las manda al gateway. Los trabajos llegan de dos formas:
//  - al pulsar "Actualizar cuotas", la app abre una página suya en Chrome (pagina.js la ve y avisa);
//  - cada 30 s pregunta al backend si hay lecturas programadas (chrome.alarms), y las hace de una en una.
const APP = 'http://127.0.0.1:__PORT__';
const running = new Set();
const pages = new Map(); // trabajo → pestaña de la página /auto, que se cierra al acabar
const sleep = ms => new Promise(r => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'lolet-job' && msg.id) {
    if (sender.tab) pages.set(msg.id, sender.tab.id);
    runJob(msg.id);
  }
});

// Programador: una alarma cada 30 s (lo mínimo que deja Chrome) que despierta al service worker
const ALARM = 'lolet-poll';
const ensureAlarm = () => chrome.alarms.get(ALARM, a => { if (!a) chrome.alarms.create(ALARM, { periodInMinutes: 0.5, delayInMinutes: 0.1 }); });
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) poll(); });

async function poll() {
  if (running.size) return; // de uno en uno: no se abren decenas de pestañas de las casas a la vez
  let r = null;
  try { r = await fetch(`${APP}/jobs/next`); } catch (_) { return; } // la app (Docker) no está encendida
  if (r.status !== 200) return;
  const job = await r.json().catch(() => null);
  if (job && job.id) runJob(job.id);
}

const post = (p, body) => fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => null);

async function runJob(id) {
  if (running.has(id)) return;
  running.add(id);
  let job = null;
  try { job = await (await fetch(`${APP}/auto/job?id=${id}`)).json(); } catch (_) {}
  if (!job || !job.id) { running.delete(id); return; }
  const say = (book, estado, msg) => post('/auto/progress', { id, book, estado, msg });
  await Promise.all(job.books.map(async book => {
    const tabs = [];
    try {
      const msg = await BOOKS[book](job, tabs, (estado, m) => say(book, estado, m));
      await say(book, 'ok', msg);
    } catch (e) {
      await say(book, 'error', (e && e.message) || String(e));
    } finally {
      for (const t of tabs) chrome.tabs.remove(t).catch(() => {});
    }
  }));
  await say(null, 'fin');
  running.delete(id);
  const pageTab = pages.get(id);
  pages.delete(id);
  if (pageTab) setTimeout(() => chrome.tabs.remove(pageTab).catch(() => {}), 4000);
  poll(); // si hay más en cola, el siguiente
}

// ---------- utilidades de pestañas ----------
async function openTab(url, tabs) {
  const t = await chrome.tabs.create({ url, active: false });
  tabs.push(t.id);
  await waitLoad(t.id);
  return t.id;
}
async function goTo(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await sleep(300);
  await waitLoad(tabId);
}
async function waitLoad(tabId, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new Error('Se ha cerrado la pestaña');
    if (t.status === 'complete') return;
    await sleep(400);
  }
}
async function run(tabId, func, args = [], world = 'ISOLATED') {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world });
    return r ? r.result : undefined;
  } catch (_) { return undefined; } // la página está cambiando
}
async function until(tabId, func, args, ms, world) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await run(tabId, func, args, world);
    if (r) return r;
    await sleep(700);
  }
  return null;
}

// Pasa el lector (lector.js) por la página y espera su resultado; las cuotas las envía la extensión
async function readPage(tabId, job, book) {
  await run(tabId, (id) => { window.__lolet_job = id; window.__lolet_fin = null; window.__lolet_snap = null; }, [job.id], 'MAIN');
  await chrome.scripting.executeScript({ target: { tabId }, files: ['lector.js'], world: 'MAIN' });
  const fin = await until(tabId, () => window.__lolet_fin, [], 30000, 'MAIN');
  if (!fin) throw new Error('El lector no ha terminado');
  if (fin.ok && fin.payload) {
    const r = await post('/odds', fin.payload);
    if (!r || !r.ok) throw new Error('La app no ha aceptado las cuotas');
    return fin.txt;
  }
  const snap = await run(tabId, () => window.__lolet_snap, [], 'MAIN');
  if (snap) await post('/snapshot', { ...snap, motivo: 'auto: ' + fin.txt });
  throw new Error(fin.txt);
}

// ---------- funciones que se ejecutan dentro de la página ----------
// Busca en la página el elemento más pequeño que contiene los dos equipos. Devuelve el enlace o hace clic.
function pageFind(teams, opts) {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const strip = s => norm(s).replace(/\b(e ?sports?|gaming|team|club|academy)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const al = t => [...new Set([norm(t.name), strip(t.name), norm(t.code)].filter(x => x && x.length >= 2))];
  const A = al(teams[0]), B = al(teams[1]);
  const has = (txt, list) => { const n = ' ' + norm(txt) + ' '; return list.some(x => n.includes(' ' + x + ' ')); };
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cands = [...document.querySelectorAll(opts.selector || 'a,div,li,tr,section,article')]
    .filter(el => { const t = el.innerText || ''; return t.length < 400 && has(t, A) && has(t, B) && visible(el); })
    .sort((x, y) => (x.innerText || '').length - (y.innerText || '').length);
  const el = cands[0];
  if (!el) { if (opts.scroll) window.scrollBy(0, 1200); return null; } // listas que cargan al bajar
  if (opts.href) { // buscamos el enlace del partido en la fila o un poco más arriba
    for (let c = el, i = 0; c && i < 6; c = c.parentElement, i++) {
      const a = c.closest(opts.href) || c.querySelector(opts.href);
      if (a) return a.href;
      // Betway marca la fila del partido con data-eventid (no siempre hay enlace)
      const ev = c.closest('[data-eventid]') || c.querySelector('[data-eventid]');
      if (ev) return '/sports/event/' + ev.getAttribute('data-eventid');
    }
    return null;
  }
  // Clic en el nombre del primer equipo dentro de la fila (es donde las casas suelen escuchar)
  const target = [...el.querySelectorAll('*')].filter(c => c.children.length === 0 && has(c.textContent, A))[0] || el;
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
  return 'clic';
}

// Hace clic en el elemento (hoja) cuyo texto encaja con la expresión
function pageClickText(re, flags, skip) {
  const rx = new RegExp(re, flags);
  const els = [...document.querySelectorAll('div,span,a,li,button,h2,h3,h4')]
    .filter(el => el.children.length <= 1 && rx.test((el.textContent || '').trim()) && el.getBoundingClientRect().width > 0);
  const el = els[skip || 0];
  if (!el) return null;
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
  return (el.textContent || '').trim().slice(0, 60) || 'clic';
}

// ---------- cada casa ----------
const BOOKS = {
  // Winamax: la lista de LoL viene en el estado de la página y en su socket; luego el lector del partido
  async winamax(job, tabs, say) {
    say('buscando', 'Buscando el partido…');
    let id = (String(job.urls.winamax || '').match(/match\/(\d+)/) || [])[1];
    const tab = await openTab(id ? `https://www.winamax.es/apuestas-deportivas/match/${id}` : 'https://www.winamax.es/apuestas-deportivas/sports/9994/800000737', tabs);
    if (!id) {
      id = await until(tab, winamaxFind, [[job.match.a, job.match.b]], 20000, 'MAIN');
      if (!id || id === 'no') throw new Error('No encuentro el partido en Winamax');
      await goTo(tab, `https://www.winamax.es/apuestas-deportivas/match/${id}`);
    }
    say('leyendo', 'Leyendo cuotas…');
    await sleep(1500);
    return readPage(tab, job, 'winamax');
  },

  // Betway: lista de esports → evento → una pestaña "Especiales de Jugadores" por mapa
  async betway(job, tabs, say) {
    say('buscando', 'Buscando el partido…');
    let ev = (String(job.urls.betway || '').match(/event\/(\d+)/) || [])[1], tab;
    if (!ev) {
      const teams = [job.match.a, job.match.b];
      const opts = { href: 'a[href*="/sports/event/"]', selector: '[data-eventid],a[href*="/sports/event/"],div,li,article', scroll: true };
      const look = async ms => (String((await until(tab, pageFind, [teams, opts], ms)) || '').match(/event\/(\d+)/) || [])[1];
      tab = await openTab('https://betway.es/es/es/sports/cat/esports', tabs);
      ev = await look(10000);
      // Foto de la página (para poder ajustar la búsqueda si Betway cambia)
      const foto = async nombre => {
        const snap = await run(tab, () => ({ url: location.href, title: document.title, texto: document.body.innerText.slice(0, 300000),
          html: document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '').slice(0, 4000000) }));
        if (snap) await post('/snapshot', { ...snap, book: 'betway', nombre, motivo: 'auto: no encuentro el partido' });
      };
      // Si no está en la portada de esports, miramos las competiciones de esports (primero las de LoL)
      if (!ev) {
        await foto('lista');
        const comps = await run(tab, () => {
          const lol = /league[- ]?of[- ]?legends|\blol\b|lck|lec|lpl|lcs|worlds|mundial|msi/i;
          const all = [...document.querySelectorAll('a[href]')].filter(a => /\/sports\/(grp|cat)\/e-?sports?\//i.test(a.getAttribute('href')));
          const seen = new Set(), out = [];
          for (const a of all) {
            const u = a.href.split('?')[0];
            if (seen.has(u)) continue;
            seen.add(u);
            const ctx = (a.closest('section,li,div') || a).innerText || '';
            out.push({ u, score: lol.test(a.getAttribute('href') + ' ' + a.textContent) ? 2 : lol.test(ctx.slice(0, 300)) ? 1 : 0 });
          }
          return out.sort((x, y) => y.score - x.score).map(x => x.u);
        }) || [];
        for (const u of comps.slice(0, 8)) {
          if (ev) break;
          say('buscando', 'Mirando ' + u.replace(/^https:\/\/betway\.es\/es\/es\/sports\//, '') + '…');
          await goTo(tab, u);
          ev = await look(8000);
        }
      }
      if (!ev) throw new Error('No encuentro el partido en Betway (he guardado una foto de la lista)');
    }
    const base = `https://betway.es/es/es/sports/event/${ev}`;
    if (tab) await goTo(tab, base);
    else tab = await openTab(base, tabs);
    // Todas las pestañas del partido: principales, cada mapa y los especiales de jugadores
    const groups = await until(tab, () => {
      const ids = [...document.querySelectorAll('[data-navitemid]')].map(e => e.getAttribute('data-navitemid')).filter(Boolean);
      return ids.length ? [...new Set(ids)] : null;
    }, [], 15000);
    if (!groups) throw new Error('Betway aún no tiene mercados para este partido');
    const hechos = [];
    for (const g of groups) {
      say('leyendo', `Leyendo ${g.replace(/---player-specials/, ' jugadores').replace('map-', 'mapa ').replace('main-markets', 'principales')}…`);
      await goTo(tab, `${base}?marketGroup=${g}`);
      await until(tab, () => document.querySelector('section[data-testid="market-table-section"] [data-testid="table-header-title"]'), [], 12000);
      try { hechos.push(await readPage(tab, job, 'betway')); } catch (e) { if (groups.length === 1) throw e; }
    }
    if (!hechos.length) throw new Error('Sin cuotas');
    return hechos.join(' · ');
  },

  // Bet365: portada de eSports → competición de LoL → partido → pestaña "Jugador"
  async bet365(job, tabs, say) {
    say('buscando', 'Buscando el partido…');
    const known = job.urls.bet365 && /#\/AC\//.test(job.urls.bet365) ? job.urls.bet365.replace(/\?[^#]*/, '') : null;
    const tab = await openTab(known || 'https://www.bet365.es/#/AS/B151/', tabs);
    const teams = [job.match.a, job.match.b];
    // Página del partido: dirección .../E<id>/ y ya pintadas sus pestañas. No se exige la pestaña "Jugador":
    // muchos partidos (otras ligas, o con días de antelación) sólo traen "Mercados principales" y "1º mapa"
    const onMatch = () => /#\/AC\/B151\/.*\/E\d+/.test(location.hash) &&
      (document.querySelector('nav button[aria-selected]') !== null || /mercados principales|apuestas al encuentro|main markets/i.test(document.body.innerText || ''));
    if (!known || !(await until(tab, onMatch, [], 15000))) {
      await until(tab, () => /league of legends|\blol\b/i.test(document.body.innerText || ''), [], 20000);
      let ok = await until(tab, pageFind, [teams, {}], 5000);
      // El partido no está en la portada: probamos las competiciones de LoL una a una
      for (let i = 0; !ok && i < 6; i++) {
        const comp = await run(tab, pageClickText, ['^(lol|league of legends)\\b', 'i', i]);
        if (!comp) break;
        say('buscando', `Mirando ${comp}…`);
        ok = await until(tab, pageFind, [teams, {}], 8000);
        if (!ok) { await run(tab, () => history.back()); await sleep(2500); }
      }
      if (!ok) throw new Error('No encuentro el partido en bet365');
      if (!(await until(tab, onMatch, [], 15000))) {
        // Foto de dónde se ha quedado, para ver si el clic no llevó al partido o la página es otra
        const snap = await run(tab, () => ({ url: location.href, title: document.title, texto: document.body.innerText.slice(0, 300000) }));
        if (snap) await post('/snapshot', { ...snap, book: 'bet365', nombre: 'no-abre', motivo: 'auto: no ha abierto el partido' });
        throw new Error('bet365 no ha abierto el partido');
      }
    }
    // Pestañas del partido (Mercados principales, Jugador, 1º mapa…): se leen todas y se guarda una foto de cada
    // una para ir ampliando el lector de bet365
    const names = await until(tab, () => {
      const t = [...document.querySelectorAll('nav button[aria-selected]')].map(b => (b.querySelector('span') || b).textContent.trim()).filter(Boolean);
      return t.length ? [...new Set(t)] : null;
    }, [], 8000) || ['Jugador'];
    const hechos = [];
    for (let i = 0; i < names.length && i < 8; i++) {
      say('leyendo', `Leyendo ${names[i]}…`);
      const clickTab = name => run(tab, (n) => {
        const b = [...document.querySelectorAll('nav button[aria-selected]')].find(x => (x.querySelector('span') || x).textContent.trim() === n);
        if (b) b.click();
      }, [name]);
      const blocked = () => run(tab, () => /no se puede mostrar este contenido/i.test(document.body.innerText || ''));
      await clickTab(names[i]);
      await sleep(3000);
      // bet365 dice "No se puede mostrar este contenido" cuando la pestaña se abre con un clic simulado,
      // pero la primera carga de la página sí se pinta. Como la dirección ya lleva la pestaña (/I11/, /I2/…)
      // se recarga la página entera; la última vez con la pestaña delante un momento
      for (let r = 0; r < 2 && await blocked(); r++) {
        say('leyendo', `Reintentando ${names[i]}…`);
        let back = null;
        // En las lecturas programadas no se pone delante: no se le quita la pestaña al usuario cada pocos minutos
        if (r === 1 && job.source !== 'auto') {
          const [cur] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          back = cur && cur.id;
          await chrome.tabs.update(tab, { active: true });
        }
        await chrome.tabs.reload(tab);
        await sleep(300);
        await waitLoad(tab);
        await sleep(4000);
        if (back) await chrome.tabs.update(back, { active: true }).catch(() => {});
      }
      const snap = await run(tab, () => ({ url: location.href, title: document.title, texto: document.body.innerText.slice(0, 300000),
        html: document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '').slice(0, 4000000) }));
      if (snap) await post('/snapshot', { ...snap, book: 'bet365', nombre: 'pestana-' + (i + 1), motivo: 'auto: ' + names[i] });
      try { hechos.push(await readPage(tab, job, 'bet365')); } catch (_) {}
    }
    if (!hechos.length) throw new Error('bet365 no muestra cuotas en este partido');
    return hechos.join(' · ');
  }
};

// Dentro de la página de LoL de Winamax: torneos del estado de la página → sus partidos por el socket
function winamaxFind(teams) {
  const s = window.PRELOADED_STATE;
  if (!s) return null;
  const norm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const strip = x => norm(x).replace(/\b(e ?sports?|gaming|team|club|academy)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const al = t => [...new Set([norm(t.name), strip(t.name), norm(t.code)].filter(x => x && x.length >= 2))];
  const eq = (name, t) => { const n = norm(name), st = strip(name); return al(t).some(x => x === n || x === st || (x.length > 3 && (n.includes(x) || x.includes(n)))); };
  const pick = matches => {
    for (const m of Object.values(matches || {})) {
      if (!m || !m.competitor1Name) continue;
      const a = m.competitor1Name, b = m.competitor2Name;
      if ((eq(a, teams[0]) && eq(b, teams[1])) || (eq(a, teams[1]) && eq(b, teams[0]))) return String(m.matchId);
    }
    return null;
  };
  const hit = pick(s.matches);
  if (hit) return hit;
  const tours = (s.categories && s.categories['800000737'] && s.categories['800000737'].tournaments) || [];
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
