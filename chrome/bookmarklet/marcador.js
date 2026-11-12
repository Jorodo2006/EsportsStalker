// Marcador (bookmarklet) de cuotas para Bet365, Winamax y Betway. Se ejecuta en tu Chrome
// normal sobre la página de un partido de LoL, lee sus cuotas y las manda a la app por http://127.0.0.1:__PORT__.
// Si Chrome no deja enviarlas, las copia al portapapeles para pegarlas en la app.
//  - Winamax: pide el partido a su propio socket (el mismo que usa la web) y manda todos sus mercados.
//  - Betway: despliega los mercados de jugador cerrados y lee cada tabla (título + botones Más/Menos).
//  - Bet365: lee la página (títulos de sección + texto agrupado por filas), como EDGE ANALYST.
// La extensión de Chrome usa este mismo lector en modo automático (window.__lolet_job): entonces no envía
// nada, deja el resultado en window.__lolet_fin y la extensión lo manda a la app.
(function () {
  var PORT = __PORT__, APP = 'http://127.0.0.1:' + PORT;
  var AUTO = window.__lolet_job || null;
  var old = document.getElementById('_lolet_ov');
  if (old) { old.remove(); if (!AUTO) return; }
  var fin = function (ok, txt, payload) { window.__lolet_fin = { ok: ok, txt: txt, payload: payload || null }; };
  var host = location.hostname;
  var BOOK = /bet365/.test(host) ? 'bet365' : /winamax/.test(host) ? 'winamax' : /betway/.test(host) ? 'betway' : null;
  var NAMES = { bet365: 'Bet365', winamax: 'Winamax', betway: 'Betway' };

  var ov = document.createElement('div');
  ov.id = '_lolet_ov';
  ov.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#18181b;color:#e4e4e7;border:1px solid #3f3f46;border-left:3px solid #f59e0b;border-radius:10px;padding:14px 16px;font:13px system-ui,sans-serif;max-width:380px;box-shadow:0 10px 40px rgba(0,0,0,.6);line-height:1.5';
  var say = function (html) { ov.innerHTML = '<div style="font-weight:700;color:#fbbf24;margin-bottom:6px">Sharpex' + (BOOK ? ' · ' + NAMES[BOOK] : '') + '</div>' + html + '<div style="margin-top:8px;color:#71717a;font-size:11px">Pulsa el marcador otra vez para cerrar</div>'; };
  document.body.appendChild(ov);
  if (!BOOK) { say('Esta página no es de Bet365, Winamax ni Betway.'); fin(false, 'página equivocada'); return; }

  function post(path, data) {
    return fetch(APP + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(data) }).then(function (r) { return r.json(); });
  }
  function deliver(payload, resumen) {
    payload.job = AUTO;
    if (AUTO) { say('Leído: ' + resumen + '.'); fin(true, resumen, payload); return; }
    say('Enviando ' + resumen + '…');
    post('/odds', payload)
      .then(function (r) { say('✅ Enviado a la app: ' + resumen + '.' + (r.partido ? '<br>Partido: <b>' + r.partido + '</b>' : '<br>Se asignan al partido que tengas abierto en la app.')); })
      .catch(function () {
        navigator.clipboard.writeText(JSON.stringify(payload)).then(function () {
          say('No he podido hablar con la app (¿está abierta?). He copiado las cuotas: en el partido de la app pulsa <b>Pegar cuotas del marcador</b>.');
        }, function () { say('No he podido enviar ni copiar las cuotas. ¿Está la app abierta?'); });
      });
  }
  // Foto de la página (texto y HTML sin scripts) para poder ajustar el lector de cada casa
  function snapshot(motivo) {
    var data = null, html = document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '');
    data = { book: BOOK, url: location.href, title: document.title, motivo: motivo, texto: document.body.innerText.slice(0, 500000), html: html.slice(0, 4000000) };
    if (AUTO) { window.__lolet_snap = data; return; }
    return post('/snapshot', data).catch(function () {});
  }

  // ---------- Winamax ----------
  if (BOOK === 'winamax') {
    var mm = location.pathname.match(/match\/(\d+)/);
    if (!mm) { say('Entra en la página de un partido de LoL en Winamax (la dirección tiene que acabar en /match/número) y pulsa otra vez.'); fin(false, 'no es la página de un partido'); return; }
    var id = mm[1], state = {}, sent = false, done = false, quiet = null;
    var merge = function (t, s) {
      for (var k in s) {
        var v = s[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) { if (!t[k] || typeof t[k] !== 'object' || Array.isArray(t[k])) t[k] = {}; merge(t[k], v); } else t[k] = v;
      }
    };
    say('Leyendo el partido de Winamax…');
    var ws = new WebSocket('wss://sports-eu-west-3.winamax.es/uof-sports-server/socket.io/?language=ES&version=3.72.0&embed=false&EIO=3&transport=websocket');
    var finish = function () {
      if (done) return; done = true;
      try { ws.close(); } catch (e) {}
      var m = state.matches && state.matches[id];
      if (!m || !m.bets || !m.bets.length) { say('Winamax no ha devuelto cuotas para este partido.'); snapshot('winamax sin cuotas'); fin(false, 'Winamax no tiene cuotas de este partido'); return; }
      // Sólo lo de este partido, para que el envío sea pequeño
      var bets = {}, outs = {}, odds = {};
      m.bets.forEach(function (b) {
        var bet = state.bets && state.bets[b]; if (!bet) return; bets[b] = bet;
        (bet.outcomes || []).forEach(function (o) { if (state.outcomes[o]) outs[o] = state.outcomes[o]; if (state.odds[o] != null) odds[o] = state.odds[o]; });
      });
      var st = { matches: {}, bets: bets, outcomes: outs, odds: odds, players: state.players || {} };
      st.matches[id] = m;
      deliver({ type: 'LOL_ET', book: 'winamax', url: location.href, matchId: +id, home: m.competitor1Name, away: m.competitor2Name, title: m.title, ts: Date.now(), state: st },
        Object.keys(bets).length + ' mercados de ' + m.title);
    };
    var send = function () { if (sent) return; sent = true; ws.send('42' + JSON.stringify(['m', { route: 'match:' + id }])); };
    setTimeout(finish, 10000);
    ws.onmessage = function (ev) {
      var d = String(ev.data);
      if (d.charAt(0) === '0') setTimeout(send, 800);
      else if (d === '40') send();
      else if (d.slice(0, 2) === '42') {
        try { var x = JSON.parse(d.slice(2)); if (x[0] === 'm' && x[1]) merge(state, x[1]); } catch (e) {}
        if (sent && state.matches && state.matches[id] && state.matches[id].bets) { clearTimeout(quiet); quiet = setTimeout(finish, 1200); }
      }
    };
    ws.onerror = function () { say('No he podido conectar con Winamax.'); fin(false, 'no conecta con Winamax'); };
    return;
  }

  // ---------- Betway: tablas de mercado ("Mapa 1 - Total de kills - Duro" con botones O 0.5 / U 0.5) ----------
  if (BOOK === 'betway') {
    var ALIAS = { gobernante: 'Ruler' }; // Betway traduce algunos nicks
    var BW_TITLE = /mapa\s*(\d)\s*-\s*total\s+de\s+(kills|asesinatos|v[ií]ctimas|asistencias|muertes)\s*-\s*(.+)$/i;
    var bwSecs = function () { return [].slice.call(document.querySelectorAll('section[data-testid="market-table-section"]')); };
    var titleOf = function (sec) { var t = sec.querySelector('[data-testid="table-header-title"]'); return t ? t.textContent.trim() : ''; };
    var opened = 0;
    bwSecs().forEach(function (sec) {
      var hd = sec.querySelector('header[data-testid="table-header"]');
      if (hd && hd.getAttribute('aria-expanded') !== 'true' && titleOf(sec)) { hd.click(); opened++; }
    });
    say(opened ? 'Abriendo ' + opened + ' mercados de Betway…' : 'Leyendo Betway…');
    // Pestaña "map-N" → los mercados sin "Mapa N" en el título son de ese mapa
    var evEl = document.querySelector('[data-testid="event-name"]');
    var evName = ((evEl ? evEl.textContent : document.title.split(',')[0]) || '').toLowerCase();
    var groupMap = +((location.search.match(/marketGroup=map-(\d)/) || [])[1] || 0);
    var priceOf = function (b) { var pv = b.querySelector('[data-testid="outcome-price-value"]'); return pv ? parseFloat(pv.textContent.replace(',', '.')) : NaN; };
    var tries = 0;
    var readBw = function () {
      var groups = {}, pending = 0, otros = [];
      bwSecs().forEach(function (sec) {
        var btns = sec.querySelectorAll('button[data-testid="outcome"]');
        // En fútbol el 1-X-2 del partido va arriba, sin cabecera: tres selecciones y una es el empate
        var untitled1x2 = btns.length === 3 && [].some.call(btns, function (b) { return /^empate$/i.test((b.getAttribute('data-outcomename') || '').trim()); });
        var title = titleOf(sec) || (untitled1x2 ? '1-X-2' : ''); if (!title) return;
        if (!btns.length) { pending++; return; }
        var m = title.match(BW_TITLE);
        // "Total de kills - Gen G" es de un equipo, no de un jugador: va con los demás mercados
        if (m && evName.indexOf(m[3].trim().toLowerCase()) >= 0) m = null;
        if (!m) { // cualquier otro mercado: título + selecciones (nombre, línea, cuota)
          var hl = sec.querySelector('header [data-testid="outcome-handicap-value"]');
          var outs = [].map.call(btns, function (b) {
            var hv = b.querySelector('[data-testid="outcome-handicap-value"]');
            return { name: (b.getAttribute('data-outcomename') || '').trim(), hcap: hv ? hv.textContent.trim() : '', price: priceOf(b) };
          }).filter(function (o) { return o.name && o.price > 1; });
          var tm = title.match(/^mapa\s*(\d)/i);
          if (outs.length) otros.push({ title: title, map: tm ? +tm[1] : groupMap, line: hl ? hl.textContent.replace(/[()\s]/g, '') : '', outcomes: outs });
          return;
        }
        var raw = m[3].trim(), name = ALIAS[raw.toLowerCase()] || raw, lo2 = m[2].toLowerCase(), mk = /asistencias/.test(lo2) ? 'a' : /muertes/.test(lo2) ? 'd' : 'k', map = +m[1];
        var lines = {};
        [].forEach.call(btns, function (b) {
          var hv = b.querySelector('[data-testid="outcome-handicap-value"]'), pv = b.querySelector('[data-testid="outcome-price-value"]');
          var hs = hv ? hv.textContent.trim() : '', odd = pv ? parseFloat(pv.textContent.replace(',', '.')) : NaN;
          var lm = hs.match(/(\d+(?:[.,]\d+)?)/); if (!lm || !(odd > 1)) return;
          var ln = parseFloat(lm[1].replace(',', '.')), on = b.getAttribute('data-outcomename') || '', side = /^(m[aá]s|over)/i.test(on) || /^o\b/i.test(hs) ? 'over' : 'under';
          lines[ln] = lines[ln] || { name: name, line: ln };
          lines[ln][side] = odd;
        });
        var gk = mk + '|' + map;
        groups[gk] = groups[gk] || { mkt: mk, h2h: false, map: map, title: 'Mapa ' + map + ' - ' + ({ k: 'Kills', a: 'Asistencias', d: 'Muertes' })[mk], entries: [] };
        Object.keys(lines).forEach(function (k) {
          var e = lines[k];
          if (e.over > 1 && e.under > 1 && !groups[gk].entries.some(function (x) { return x.name === e.name && x.line === e.line; })) groups[gk].entries.push(e);
        });
      });
      if (pending && tries++ < 6) { setTimeout(readBw, 700); return; }
      var secs = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.entries.length; });
      var tot = secs.reduce(function (a, g) { return a + g.entries.length; }, 0);
      snapshot(tot || otros.length ? 'ok' : 'sin cuotas');
      if (!tot && !otros.length) { say('No encuentro cuotas en esta página de Betway.<br>Entra en el partido y pulsa otra vez.'); fin(false, 'sin cuotas en la página'); return; }
      deliver({ type: 'LOL_ET', book: 'betway', url: location.href, page: location.pathname + location.search, title: document.title, map: secs.length ? secs[0].map : groupMap || 1, ts: Date.now(),
        header: (document.body.innerText || '').slice(0, 800), sections: secs, markets: otros },
        [otros.length ? otros.length + ' mercados' : '', tot ? tot + ' líneas de jugador' : ''].filter(Boolean).join(' y '));
    };
    setTimeout(readBw, opened ? 1200 : 50);
    return;
  }

  // ---------- Bet365: lectura de la página ----------
  var frac = function (a, b) { return Math.round((1 + a / b) * 100) / 100; };
  var nums = function (s) {
    var r = [], m, re = /(\d{1,3})\/(\d{1,3})(?!\/)|(\d{1,3}[.,]\d{1,3}|\d{1,3})(?![\d/])/g;
    s = String(s).replace(/(\d\.\d{1,2})(\d\.\d)/g, '$1 $2').replace(/\b(evs|evens|ev)\b/gi, ' 2.00 '); // "Evs" = cuota par
    while ((m = re.exec(s)) !== null) {
      if (m[1]) r.push(frac(+m[1], +m[2])); // cuotas fraccionarias (5/6 → 1.83)
      else { var n = parseFloat(m[3].replace(',', '.')); if (!isNaN(n)) r.push(n); }
    }
    return r;
  };
  var isHalf = function (v) { return Math.abs(v * 2 - Math.round(v * 2)) < 1e-9 && Math.round(v * 2) % 2 === 1; };
  var STAT = /v[ií]ctimas|kills|asesinatos|eliminaciones|bajas|asistencias|assists|muertes|deaths/i;
  var statOf = function (lo) { return /asistencias|assists/.test(lo) ? 'a' : /muertes|deaths/.test(lo) ? 'd' : 'k'; };
  var mapOf = function (s) { var t = String(s).match(/(\d)\s*º\s*mapa|mapa\s*(\d)|map\s*(\d)|game\s*(\d)/i); return t ? +(t[1] || t[2] || t[3] || t[4]) : null; };
  var pageMap = mapOf(document.body.innerText.slice(0, 20000)) || 1;

  function findSections() {
    var found = [], all = document.querySelectorAll('div,span,h1,h2,h3,h4,h5,p,button,header');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length > 6) continue;
      var txt = (el.innerText || '').trim();
      if (!txt || txt.length > 90 || txt.length < 4 || txt.indexOf('\n') >= 0) continue;
      var lo = txt.toLowerCase();
      if (!STAT.test(lo)) continue;
      // "Hándicap de víctimas" o "Total de víctimas" a secas son del partido, no de un jugador
      if (/h[aá]ndicap|ganar/.test(lo) || /^(\d\s*º\s*mapa\s*[-·:]?\s*)?total de (v[ií]ctimas|kills|asesinatos)$/.test(lo)) continue;
      var h2h = /comparac|cara a cara|head to head|\s(v|vs)\s/.test(' ' + lo + ' '), mkt = statOf(lo);
      var c = el;
      for (var up = 0; up < 8 && c.parentElement; up++) { c = c.parentElement; if (nums(c.innerText || '').length >= 4) break; }
      if (found.some(function (f) { return f.container === c || (f.mkt === mkt && f.h2h === h2h && (f.container.contains(c) || c.contains(f.container))); })) continue;
      found.push({ title: txt, mkt: mkt, h2h: h2h, map: mapOf(txt) || pageMap, container: c });
    }
    return found;
  }

  // Textos de la sección agrupados por filas según su posición en pantalla (con su x, para las rejillas)
  function leafRows(container) {
    var leaves = [];
    (function walk(n) {
      if (n.nodeType === 3) {
        var t = n.textContent.trim();
        if (t && n.parentElement) { var r = n.parentElement.getBoundingClientRect(); if (r.width > 0 && r.height > 0) leaves.push({ text: t, y: r.top + r.height / 2, x: r.left, cx: r.left + r.width / 2 }); }
        return;
      }
      if (n.id === '_lolet_ov' || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
      for (var i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
    })(container);
    var rows = [];
    leaves.forEach(function (l) {
      for (var i = 0; i < rows.length; i++) if (Math.abs(l.y - rows[i].y) <= 8) { rows[i].items.push(l); return; }
      rows.push({ y: l.y, items: [l] });
    });
    rows.sort(function (a, b) { return a.y - b.y; });
    return rows.map(function (r) { return r.items.sort(function (a, b) { return a.x - b.x; }); });
  }
  function rowsOf(container) {
    return leafRows(container).map(function (r) { return r.map(function (i) { return i.text; }); });
  }

  // Nombre de jugador a partir del título ("Ruler - Total de kills" → Ruler), por si las filas no lo llevan
  var nameFromTitle = function (t) {
    return t.replace(STAT, '').replace(/total(es)?|de|del|jugador|player|mapa\s*\d|\d\s*º\s*mapa|map\s*\d|más|menos|over|under|[-–:()·]/gi, ' ').replace(/\s+/g, ' ').trim();
  };

  function playerRows(sec) {
    var out = [], fallback = nameFromTitle(sec.title), half = {};
    rowsOf(sec.container).forEach(function (texts) {
      // Filas sueltas "Más de 4.5  1.83" / "Menos de 4.5  1.90" (el jugador va en el título)
      var one = texts.join(' ').match(/^(m[aá]s de|over|menos de|under)\s*(\d{1,2}[.,]5)\s+(\d{1,3}[.,]\d{1,3}|\d{1,3}\/\d{1,3}|evs|evens)\s*$/i);
      if (one && fallback) {
        var o = nums(one[3])[0], l = parseFloat(one[2].replace(',', '.')), k = fallback + '|' + l;
        half[k] = half[k] || { name: fallback, line: l };
        half[k][/^(m[aá]s|over)/i.test(one[1]) ? 'over' : 'under'] = o;
        return;
      }
      // Si la fila empieza por "Más de / Menos de" no lleva el nombre: va en el título de la sección
      var MM = /^(m[aá]s|menos|over|under)/i;
      var nameTxt = MM.test(texts.join(' ')) ? '' : (texts.filter(function (t) { return /[a-zA-Z]{2}/.test(t) && !MM.test(t) && !/^(de|o|evs|evens)$/i.test(t) && !STAT.test(t); })[0] || '');
      var name = nameTxt || fallback;
      var n = nums(texts.filter(function (t) { return t !== nameTxt; }).join(' '));
      if (!name || n.length < 3 || name.length > 30) return;
      var ln = null, over = null, under = null;
      if (n.length >= 4 && n[0] === n[2] && isHalf(n[0])) { ln = n[0]; over = n[1]; under = n[3]; }
      else if (isHalf(n[0])) { ln = n[0]; over = n[1]; under = n[2]; }
      if (ln === null || !(over > 1) || !(under > 1)) return;
      if (!out.some(function (e) { return e.name === name && e.line === ln; })) out.push({ name: name, line: ln, over: over, under: under });
    });
    Object.keys(half).forEach(function (k) { var e = half[k]; if (e.over > 1 && e.under > 1 && !out.some(function (x) { return x.name === e.name && x.line === e.line; })) out.push(e); });
    return out;
  }

  function h2hRows(sec) {
    var out = [];
    rowsOf(sec.container).forEach(function (texts) {
      var line = texts.join(' ');
      var m = line.match(/^(.+?)\s+(?:v|vs|-)\s+(.+?)\s+[-+]?\d/i);
      var n = nums(line);
      if (!m || n.length < 2) return;
      var hm = line.match(/([+\-]\d{1,2}[.,]5)/);
      var odds = n.filter(function (v) { return v > 1.01 && !(hm && Math.abs(v) === Math.abs(parseFloat(hm[1].replace(',', '.')))); });
      var o1 = odds[odds.length - 2], o2 = odds[odds.length - 1];
      if (!(o1 > 1) || !(o2 > 1)) return;
      out.push({ p1: m[1].trim(), p2: m[2].trim(), handicap: hm ? parseFloat(hm[1].replace(',', '.')) : null, odds1: o1, odds2: o2 });
    });
    return out;
  }

  // ---------- Bet365: mercados generales (pestañas "Mercados principales", "1º mapa"…) ----------
  // Cada bloque tiene un título y debajo, o una rejilla con los dos equipos de columnas y una fila por mercado
  // ("Ganará", "Hándicap de víctimas", "Total de víctimas"), o selecciones sueltas "Nombre  cuota".
  // Salen en `markets`, con el mismo formato que Betway, y odds.js los junta con las demás casas.
  var ODDTXT = /^(\d{1,3}[.,]\d{1,3}|\d{1,3}|\d{1,3}\/\d{1,3}|evs|evens)$/i;
  var isOdd = function (t) { return ODDTXT.test(String(t).trim()); };
  var navTab = function () { var b = document.querySelector('nav button[aria-selected="true"]'); return b ? (b.innerText || '').trim() : ''; };
  // "Gen.G -1.5" → { name: 'Gen.G', hcap: '-1.5' }; "M 24.5" / "Más de 24.5" → { name: 'Más de', hcap: '24.5' }
  var splitSel = function (txt) {
    var t = String(txt).replace(/\s+/g, ' ').trim(), m = t.match(/^(.*?)(?:\s+|(?=[+-])|^)([+-]?\d{1,3}(?:[.,]\d{1,2})?)$/);
    var name = m ? m[1].trim() : t, hcap = m ? m[2] : '';
    if (/^(o|over|m[aá]s( de)?)$/i.test(name)) name = 'Más de';
    else if (/^(u|under|menos( de)?)$/i.test(name)) name = 'Menos de';
    return { name: name, hcap: hcap };
  };
  // Parte una fila en selecciones: el texto acumulado hasta cada cuota es su nombre. Un número seguido de
  // otro número es la línea ("24.5  1.83"), no la cuota.
  var segments = function (items) {
    var out = [], acc = [];
    items.forEach(function (it, i) {
      if (isOdd(it.text) && !(items[i + 1] && isOdd(items[i + 1].text))) { out.push({ text: acc.join(' '), price: nums(it.text)[0], cx: it.cx }); acc = []; }
      else acc.push(it.text);
    });
    return out.filter(function (s) { return s.price > 1; });
  };

  function findMarketBlocks(skip) {
    var found = [], tab = navTab(), all = document.querySelectorAll('div,span,h2,h3,h4,header,button');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length > 3 || (el.textContent || '').length > 70 || el.closest('nav') || el.closest('#_lolet_ov')) continue;
      var txt = (el.innerText || '').trim();
      if (txt.length < 3 || txt.indexOf('\n') >= 0 || !/[a-zA-Záéíóú]{2}/.test(txt) || isOdd(txt) || txt === tab) continue;
      // El título es la primera línea de su bloque, y el bloque tiene cuotas pero no es media página
      var c = el, ok = false;
      for (var up = 0; up < 7 && c.parentElement; up++) {
        c = c.parentElement;
        var it = (c.innerText || '').trim();
        if (it.split('\n')[0].trim() !== txt) break;
        if (nums(it).length >= 2) { ok = it.length < 2500 && nums(it).length <= 40; break; }
      }
      if (!ok || found.some(function (f) { return f.container === c; })) continue;
      if (skip.some(function (s) { return s.contains(c) || c.contains(s); })) continue;
      found.push({ title: txt, container: c });
    }
    // Las cabeceras de columna y las etiquetas de fila también parecen títulos: se quedan los bloques de fuera
    return found.filter(function (f) { return !found.some(function (g) { return g !== f && g.container.contains(f.container); }); });
  }

  function blockMarkets(blk, map) {
    var out = [], rows = leafRows(blk.container).map(function (r) { return r.filter(function (i) { return i.text !== blk.title; }); }).filter(function (r) { return r.length; });
    var named = function (label) {
      var l = label.trim();
      if (/^total$/i.test(l)) l = map ? 'Total de víctimas' : 'Total de mapas';
      else if (/^h[aá]ndicap$/i.test(l)) l = map ? 'Hándicap de víctimas' : 'Hándicap de mapas';
      return l ? blk.title + ' - ' + l : blk.title;
    };
    var push = function (title, sels) {
      // En la rejilla la selección es el equipo de la columna, salvo en los totales (Más de / Menos de)
      var outs = sels.map(function (s) {
        var x = splitSel(s.text), ou = /^(m[aá]s|menos) de$/i.test(x.name);
        return { name: ou ? x.name : s.col || x.name, hcap: x.hcap, price: s.price };
      }).filter(function (o) { return o.name && o.price > 1; });
      if (outs.length) out.push({ title: title, map: map, line: '', outcomes: outs });
    };
    // Rejilla: una fila de cabecera con 2-3 nombres sin cuotas (los equipos) y filas "Etiqueta  celda  celda"
    var hi = -1;
    for (var i = 0; i < rows.length - 1 && hi < 0; i++) {
      var r = rows[i];
      if (r.length >= 2 && r.length <= 3 && r.every(function (x) { return !isOdd(x.text) && !/^[+-]?\d/.test(x.text) && /[a-z]/i.test(x.text); }) && segments(rows[i + 1]).length) hi = i;
    }
    if (hi >= 0) {
      var cols = rows[hi], left = cols[0].x - 10;
      rows.slice(hi + 1).forEach(function (r) {
        var label = r.filter(function (x) { return x.cx < left && !isOdd(x.text); }).map(function (x) { return x.text; }).join(' ');
        var cells = cols.map(function () { return []; });
        r.filter(function (x) { return x.cx >= left; }).forEach(function (x) {
          var best = 0;
          cols.forEach(function (c, k) { if (Math.abs(c.cx - x.cx) < Math.abs(cols[best].cx - x.cx)) best = k; });
          cells[best].push(x);
        });
        var sels = [];
        cells.forEach(function (cell, k) { segments(cell).forEach(function (s) { s.col = cols[k].text; sels.push(s); }); });
        if (sels.length >= 2) push(named(label), sels);
      });
      return out;
    }
    // Lista: cada fila son una o varias selecciones "Nombre  cuota"; una fila con texto y sin cuotas abre submercado
    var sub = '', acc = [];
    rows.forEach(function (r) {
      var segs = segments(r);
      if (!segs.length) { if (acc.length) push(named(sub), acc); acc = []; sub = r.map(function (x) { return x.text; }).join(' '); return; }
      acc = acc.concat(segs);
    });
    if (acc.length) push(named(sub), acc);
    return out;
  }

  var sections = findSections().map(function (s) {
    return { mkt: s.mkt, h2h: s.h2h, map: s.map, title: s.title, entries: s.h2h ? h2hRows(s) : playerRows(s), container: s.container };
  }).filter(function (s) { return s.entries.length; });
  var markets = [];
  // bet365 a veces sirve la página en inglés ("Player", "Main Markets") aunque sea bet365.es
  if (!/jugador|player/i.test(navTab())) {
    var tabMap = mapOf(navTab()) || 0, seen = {};
    findMarketBlocks(sections.map(function (s) { return s.container; })).forEach(function (b) {
      blockMarkets(b, mapOf(b.title) || tabMap).forEach(function (m) {
        var k = m.title + '|' + m.outcomes.map(function (o) { return o.name + o.hcap; }).join('|');
        if (!seen[k]) { seen[k] = 1; markets.push(m); }
      });
    });
  }
  sections.forEach(function (s) { delete s.container; });
  var total = sections.reduce(function (a, s) { return a + s.entries.length; }, 0);
  snapshot(total || markets.length ? 'ok' : 'sin cuotas'); // la foto ayuda a mejorar el lector de cada casa
  if (!total && !markets.length) {
    say('No encuentro cuotas en esta página.<br>Abre el partido en bet365 (mercados principales o la pestaña <b>Jugador</b>) y pulsa otra vez.<br><br>He mandado una foto de la página a la app para poder ajustar el lector.');
    fin(false, 'sin cuotas en la página');
    return;
  }
  var resumen = [markets.length ? markets.length + ' mercados' : '',
    total ? total + ' líneas de jugador (' + sections.map(function (s) { return (s.h2h ? 'comparación ' : '') + ({ k: 'kills', a: 'asistencias', d: 'muertes' })[s.mkt] + ' ' + s.entries.length; }).join(', ') + ')' : ''].filter(Boolean).join(' y ');
  deliver({ type: 'LOL_ET', book: BOOK, url: location.href, page: location.pathname + location.hash, title: document.title, map: pageMap, ts: Date.now(),
    header: (document.body.innerText || '').slice(0, 800), sections: sections, markets: markets }, resumen);
})();
