'use strict';
// Lectura de los PDF de ProTennisLive (cuadro de la previa y orden de juego de los Challenger). Son páginas web impresas con
// Chrome (Skia): fuentes CID con ToUnicode, cada trozo de texto con su matriz y, en el orden de juego, cada partido en un
// formulario (XObject) con la suya. Aquí sólo se sacan los trozos de texto con su posición en la página (sin dependencias:
// zlib para descomprimir) y se interpretan el cuadro y el orden de juego. Nada de red ni de base de datos: se prueba con
// server/test/ptl.test.js.
const zlib = require('zlib');

// ---------- PDF → trozos de texto con posición ----------
const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const ID = [1, 0, 0, 1, 0, 0];

function pdfItems(buf) {
  const s = buf.toString('latin1');
  const at = new Map();
  for (const m of s.matchAll(/(\d+) 0 obj\b/g)) at.set(m[1], m.index + m[0].length);
  const body = id => { const i = at.get(String(id)); return i == null ? '' : s.slice(i, s.indexOf('endobj', i)); };
  const streamOf = id => {
    const i = at.get(String(id)); if (i == null) return '';
    const k = s.indexOf('stream', i), end = s.indexOf('endstream', k);
    let a = k + 6; if (s[a] === '\r') a++; if (s[a] === '\n') a++;
    let e = end; if (s[e - 1] === '\n') e--; if (s[e - 1] === '\r') e--;
    const raw = buf.subarray(a, e);
    if (!/\/FlateDecode/.test(s.slice(i, k))) return raw.toString('latin1');
    try { return zlib.inflateSync(raw).toString('latin1'); } catch { try { return zlib.inflateSync(buf.subarray(a, end)).toString('latin1'); } catch { return ''; } }
  };
  // Un diccionario dentro de otro (<< ... >> con anidados) a partir de la clave
  const sub = (txt, key) => {
    const k = txt.indexOf(`/${key}`); if (k < 0) return '';
    const rest = txt.slice(k + key.length + 1).trimStart();
    const ref = rest.match(/^(\d+) 0 R/); if (ref) return body(ref[1]);
    if (!rest.startsWith('<<')) return '';
    let depth = 0;
    for (let j = 0; j < rest.length; j++) {
      if (rest.startsWith('<<', j)) { depth++; j++; } else if (rest.startsWith('>>', j)) { depth--; j++; if (!depth) return rest.slice(0, j + 1); }
    }
    return rest;
  };
  const refs = txt => Object.fromEntries([...txt.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+) 0 R/g)].map(m => [m[1], m[2]]));
  // Ancho de cada glifo (en milésimas del cuerpo), de la fuente CID descendiente: /W [c [w1 w2…] c1 c2 w …] y /DW
  const widths = new Map();
  const widthsOf = fontId => {
    if (widths.has(fontId)) return widths.get(fontId);
    const desc = (body(fontId).match(/\/DescendantFonts\s*\[\s*(\d+) 0 R/) || [])[1];
    const d = desc ? body(desc) : '';
    const dw = Number((d.match(/\/DW\s+(\d+)/) || [])[1]) || 1000;
    let wtxt = (d.match(/\/W\s*\[([\s\S]*?)\]\s*(?:\/|>>)/) || [])[1] || '';
    const wref = d.match(/\/W\s+(\d+) 0 R/);
    if (wref) wtxt = body(wref[1]).replace(/^\s*\[|\]\s*$/g, '');
    const map = new Map();
    const toks = wtxt.match(/\[[^\]]*\]|[\d.]+/g) || [];
    for (let i = 0; i < toks.length;) {
      const c = Number(toks[i]);
      if (toks[i + 1]?.startsWith('[')) { toks[i + 1].slice(1, -1).trim().split(/\s+/).forEach((w, k) => map.set(c + k, Number(w))); i += 2; }
      else { const c2 = Number(toks[i + 1]), w = Number(toks[i + 2]); for (let k = c; k <= c2 && k - c < 5000; k++) map.set(k, w); i += 3; }
    }
    const r = { dw, map };
    widths.set(fontId, r);
    return r;
  };
  const cmaps = new Map();
  const cmapOf = fontId => {
    if (cmaps.has(fontId)) return cmaps.get(fontId);
    const tu = (body(fontId).match(/\/ToUnicode\s+(\d+) 0 R/) || [])[1], map = {};
    if (tu) {
      const cm = streamOf(tu);
      for (const b of cm.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map[parseInt(p[1], 16)] = hexText(p[2]);
      for (const b of cm.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
          const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16), u = parseInt(p[3], 16);
          for (let c = lo; c <= hi && c - lo < 5000; c++) map[c] = String.fromCodePoint(u + c - lo);
        }
      }
    }
    cmaps.set(fontId, map);
    return map;
  };
  const out = [];
  const run = (src, res, ctm0) => {
    const fonts = refs(sub(res, 'Font')), xobjs = refs(sub(res, 'XObject'));
    const stack = [];
    let ctm = ctm0, tm = ID, tlm = ID, font = null, size = 0;
    const ops = [];
    for (const t of tokens(src)) {
      if (t.op == null) { ops.push(t.v); continue; }
      const o = t.op, a = ops.splice(0);
      if (o === 'q') stack.push(ctm);
      else if (o === 'Q') ctm = stack.pop() || ctm0;
      else if (o === 'cm' && a.length >= 6) ctm = mul(a.slice(-6).map(Number), ctm);
      else if (o === 'BT') { tm = ID; tlm = ID; }
      else if (o === 'Tf') { font = fonts[String(a[0]).slice(1)] || null; size = Number(a[1]) || 0; }
      else if (o === 'Tm' && a.length >= 6) { tm = a.slice(-6).map(Number); tlm = tm; }
      else if ((o === 'Td' || o === 'TD') && a.length >= 2) { tlm = mul([1, 0, 0, 1, Number(a[0]), Number(a[1])], tlm); tm = tlm; }
      else if (o === 'Tj' || o === 'TJ' || o === "'" || o === '"') {
        const parts = (o === 'TJ' ? a[0] || [] : [a[a.length - 1]]).filter(x => x && x.hex != null);
        const map = font ? cmapOf(font) : {}, wd = font ? widthsOf(font) : { dw: 600, map: new Map() };
        let text = '', adv = 0;
        for (const p of parts) for (let i = 0; i + 4 <= p.hex.length; i += 4) { const g = parseInt(p.hex.slice(i, i + 4), 16); text += map[g] ?? ''; adv += wd.map.get(g) ?? wd.dw; }
        const m = mul(tm, ctm);
        // Ancho en la página: el avance de los glifos por el cuerpo y la escala horizontal de la matriz
        if (text.trim()) out.push({ text, x: m[4], y: m[5], size: Math.abs(size * m[3]) || size, w: (adv / 1000) * size * Math.hypot(m[0], m[1]) });
      } else if (o === 'Do') {
        const id = xobjs[String(a[0]).slice(1)], d = id && body(id);
        if (d && /\/Subtype\s*\/Form/.test(d.slice(0, d.indexOf('stream')))) {
          const head = d.slice(0, d.indexOf('stream'));
          const mx = (head.match(/\/Matrix\s*\[([^\]]+)\]/) || [])[1];
          run(streamOf(id), sub(head, 'Resources') || res, mul(mx ? mx.trim().split(/\s+/).map(Number) : ID, ctm));
        }
      }
    }
  };
  for (const m of s.matchAll(/\/Type\s*\/Page\b(?!s)/g)) {
    const start = s.lastIndexOf(' obj', m.index), dict = s.slice(start, s.indexOf('endobj', m.index));
    const contents = (dict.match(/\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/) || [])[1] || '';
    const src = [...contents.matchAll(/(\d+) 0 R/g)].map(r => streamOf(r[1])).join('\n');
    run(src, sub(dict, 'Resources'), ID);
  }
  return joinRuns(out);
}

// Chrome parte el texto donde ajusta el espacio entre letras ("MORIY" + "A, Hiroki"): se juntan los trozos seguidos de la misma
// línea que empiezan justo donde acaba el anterior (con los anchos de la fuente). Lo que va separado con " | " en un solo trozo (la
// cabecera) se parte
function joinRuns(items) {
  const out = [];
  for (const it of items) {
    const p = out[out.length - 1];
    const gap = p ? it.x - (p.x + p.w) : Infinity;
    if (p && Math.abs(it.y - p.y) < 0.8 && Math.abs(it.size - p.size) < 0.6 && Math.abs(gap) < p.size * 0.2) {
      p.text += it.text; p.w = it.x + it.w - p.x;
    } else out.push({ ...it });
  }
  return out.flatMap(({ w: _, ...it }) => (it.text.includes(' | ') ? it.text.split(' | ').map(text => ({ ...it, text })) : [it]));
}

function hexText(h) { let r = ''; for (let i = 0; i + 4 <= h.length; i += 4) r += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return r; }

// Operandos y operadores del contenido de una página. Los diccionarios en línea (<</MCID 3>> BDC) se saltan
function* tokens(src) {
  const n = src.length;
  let i = 0;
  const arr = [];
  let inArr = 0;
  const push = v => (inArr ? arr[arr.length - 1].push(v) : null);
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f') { i++; continue; }
    if (c === '%') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '<' && src[i + 1] === '<') {
      let depth = 0;
      for (; i < n; i++) { if (src.startsWith('<<', i)) { depth++; i++; } else if (src.startsWith('>>', i)) { depth--; i++; if (!depth) { i++; break; } } }
      if (!inArr) yield { v: null };
      continue;
    }
    if (c === '<') { const e = src.indexOf('>', i); const v = { hex: src.slice(i + 1, e).replace(/\s+/g, '') }; i = e + 1; if (inArr) push(v); else yield { v }; continue; }
    if (c === '(') {
      let depth = 0, j = i;
      for (; j < n; j++) { if (src[j] === '\\') { j++; continue; } if (src[j] === '(') depth++; else if (src[j] === ')' && !--depth) break; }
      i = j + 1; if (!inArr) yield { v: { lit: true } }; continue;
    }
    if (c === '[') { inArr++; arr.push([]); i++; continue; }
    if (c === ']') { inArr--; const v = arr.pop(); i++; if (inArr) push(v); else yield { v }; continue; }
    let j = i;
    while (j < n && !/[\s<>[\]()/%]/.test(src[j])) j++;
    if (c === '/') { j = i + 1; while (j < n && !/[\s<>[\]()/%]/.test(src[j])) j++; }
    const w = src.slice(i, j || i + 1); i = j > i ? j : i + 1;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w) || w[0] === '/') { if (inArr) push(w); else yield { v: w }; } else if (!inArr) yield { op: w };
  }
}

// ---------- Utilidades ----------
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
// "MORIYA, Hiroki" → { first: 'Hiroki', last: 'Moriya' }; "RYAN ZIEGANN, Sam" → Sam Ryan Ziegann
const titled = w => w.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\bMc(\p{L})/gu, (m, b) => `Mc${b.toUpperCase()}`);
const nameOf = (last, first) => ({ first: first.trim(), last: titled(last.trim()), name: `${first.trim()} ${titled(last.trim())}`.trim() });

// Un set: "62" (6-2), "76" (7-6). Las cifras van del lado del que gana el partido
const okSet = (a, b) => (Math.max(a, b) === 6 && Math.abs(a - b) >= 2) || (Math.max(a, b) === 7 && Math.abs(a - b) <= 2 && Math.min(a, b) >= 5);
// Los trozos del resultado de un ganador ("62 67", "6", "62") → sets desde su lado, desempates del que pierde cada uno y si fue
// retirada o W.O. Lo que no se entiende se deja fuera (un resultado a medias es mejor que uno inventado)
function parseScore(parts) {
  const toks = parts.join(' ').replace(/[()[\]]/g, ' ').split(/\s+/).filter(Boolean);
  const sets = [], tb = [];
  let ret = false, wo = false;
  for (const t of toks) {
    if (/^(ret|ret\.|retired|rtd)$/i.test(t)) { ret = true; continue; }
    if (/^(w\/?o|wo\.?|walkover)$/i.test(t)) { wo = true; continue; }
    if (!/^\d{1,2}$/.test(t)) continue;
    const last = sets[sets.length - 1];
    const tbTurn = last && Math.max(...last) === 7 && Math.min(...last) === 6 && tb[sets.length - 1] == null;
    if (t.length === 2 && okSet(+t[0], +t[1]) && !(tbTurn && !okSet(+t[0], +t[1]))) { sets.push([+t[0], +t[1]]); continue; }
    if (tbTurn) { tb[sets.length - 1] = +t; continue; }
    // Un set a medias al retirarse ("32 ret.")
    if (t.length === 2) sets.push([+t[0], +t[1]]);
  }
  return { sets, tb: sets.map((_, i) => tb[i] ?? null), ret, wo };
}

const rowsBy = (items, tol = 2) => {
  const rows = [];
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    const r = rows.find(r => Math.abs(r.y - it.y) <= tol);
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
};

// Cabecera común: "NSW Open | Sydney, Australia | 16 November — 22 November 2026 | USD 107 000 | Hard | Challenger 75"
function headerOf(items) {
  const texts = items.map(i => i.text.trim());
  const di = texts.findIndex(t => /^\d{1,2} [A-Za-z]+ — \d{1,2} [A-Za-z]+ \d{4}$/.test(t));
  if (di < 0) return null;
  const [, d1, m1, d2, m2, y] = texts[di].match(/^(\d{1,2}) ([A-Za-z]+) — (\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  const mo1 = MONTHS[m1.toLowerCase()], mo2 = MONTHS[m2.toLowerCase()];
  const y1 = mo1 > mo2 ? +y - 1 : +y;
  const iso = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return {
    name: texts[di - 2] || '', city: texts[di - 1] || '', start: iso(y1, mo1, +d1), end: iso(+y, mo2, +d2),
    surface: texts.find(t => /^(Hard|Clay|Grass|Carpet)\b/i.test(t)) || '', category: texts.find(t => /^Challenger \d+/i.test(t)) || ''
  };
}

// ---------- Cuadro de la previa (qs.pdf) ----------
// Cada fila del cuadro: posición, siembra, entrada (WC, Alt…), "APELLIDO, Nombre" y país. Los ganadores van a la derecha, en la
// columna de la ronda siguiente ("Qualifying Round 2" son los que ganaron la 1.ª; "Qualifier", los que ganaron la última), a
// media altura entre los dos de los que salen: por eso cada ganador se asigna a su partido por la altura, no por el orden.
const ENTRY = /^(WC|Alt|Q|LL|SE|PR|JE|ITF|ALT)$/;
// "MORIYA, Hiroki"; si no cabe, cortado y sin nombre de pila: "HUERTAS DEL PINO CORD…"
const DRAW_NAME = /^([A-Z][A-Z'’\-. ]+?)(?:, (\S.*)|\s*…)$/;
const WIN_NAME = /^\p{Lu}\.(?:\s?\p{Lu}\.)?\s+\S/u;

function parseDraw(items) {
  const head = headerOf(items);
  const heads = items.filter(i => /^Qualifying Round \d$/.test(i.text.trim()) || /^Qualifiers?$/.test(i.text.trim()));
  const rounds = heads.filter(h => /Round/.test(h.text)).length;
  if (!head || !rounds) return null;
  const qual = heads.find(h => /^Qualifiers?$/.test(h.text.trim()));
  // Las del cuadro están en la columna de la izquierda (la de "Siembra", más abajo, va en minúsculas: "Moriya, Hiroki"). La columna
  // sale sólo de los nombres: hay un "Bye" suelto en la leyenda, más a la izquierda
  const minX = Math.min(...items.filter(i => DRAW_NAME.test(i.text.trim())).map(i => i.x));
  const drawNames = items.filter(i => (DRAW_NAME.test(i.text.trim()) || /^Bye$/i.test(i.text.trim())) && i.x >= minX - 2 && i.x < minX + 30);
  const rows = rowsBy(items.filter(i => i.y >= Math.min(...drawNames.map(n => n.y)) - 3 && i.x < (heads.length ? Math.min(...heads.map(h => h.x)) + 120 : Infinity)), 2.5);
  const draw = [];
  for (const nm of drawNames) {
    const row = rows.find(r => r.items.includes(nm));
    const left = row.items.filter(i => i.x < nm.x).map(i => i.text.trim());
    const right = row.items.filter(i => i.x > nm.x).map(i => i.text.trim());
    const pos = Number(left.find(t => /^\d{1,3}$/.test(t)));
    if (!pos) continue;
    const nums = left.filter(t => /^\d{1,2}$/.test(t)).map(Number);
    const seed = nums.length > 1 ? nums[nums.length - 1] : null;
    const entry = left.find(t => ENTRY.test(t)) || null;
    const bye = /^Bye$/i.test(nm.text.trim());
    const m = nm.text.trim().match(DRAW_NAME);
    draw.push({ pos, y: nm.y, bye, seed: bye ? null : seed, entry, ...(bye ? { first: '', last: '', name: 'Bye' } : nameOf(m[1], m[2] || '')), country: right.find(t => /^[A-Z]{3}$/.test(t)) || '' });
  }
  draw.sort((a, b) => a.pos - b.pos);
  if (draw.length < 2) return null;
  // Columnas de ganadores: la de cada encabezado de ronda a partir de la 2.ª y la de "Qualifier"
  const cols = heads.filter(h => !/Round 1$/.test(h.text.trim())).sort((a, b) => a.x - b.x).map(h => h.x);
  const colOf = x => { let best = 0, d = Infinity; cols.forEach((c, k) => { const dd = Math.abs(c - x); if (dd < d) { d = dd; best = k; } }); return best + 1; };
  // Cada ganador con los trozos que le siguen en el documento (su siembra y su resultado) hasta el siguiente nombre
  const winners = [];
  const all = items.map(i => ({ ...i, text: i.text.trim() }));
  const firstWin = all.findIndex(i => WIN_NAME.test(i.text) && i.x > minX + 40);
  for (let k = Math.max(firstWin, 0); firstWin >= 0 && k < all.length; k++) {
    const it = all[k];
    if (!WIN_NAME.test(it.text) || it.x <= minX + 40) continue;
    const tail = [];
    for (let j = k + 1; j < all.length && !WIN_NAME.test(all[j].text); j++) { if (/^[\d\s.()/A-Za-z]{1,20}$/.test(all[j].text) && !/[a-z]{4,}/i.test(all[j].text.replace(/ret|retired|walkover/i, ''))) tail.push(all[j].text); else break; }
    winners.push({ name: it.text, x: it.x, y: it.y, round: colOf(it.x), tail });
  }
  const ys = draw.map(d => d.y);
  const rowH = Math.abs(ys[0] - ys[ys.length - 1]) / Math.max(1, ys.length - 1) / 2;
  const span = (r, i) => { const a = (i - 1) * 2 ** r, b = Math.min(i * 2 ** r, draw.length) - 1; return [Math.min(ys[a], ys[b]), Math.max(ys[a], ys[b])]; };
  const matches = [];
  const won = new Map(); // r-i → jugador
  // "H. Moriya" con "Moriya"; "C. Huertas Del Pino" con "Huertas Del Pino Cord" (cortado): un apellido en común
  const same = (short, p) => {
    if (!p || p.bye) return false;
    const w = norm(short.replace(/^(\p{Lu}\.\s?)+/u, '')).split(' ').filter(x => x.length > 2), mine = new Set(norm(p.last).split(' '));
    return w.some(x => mine.has(x)) || norm(short).split(' ').pop() === norm(p.last).split(' ').pop();
  };
  for (let r = 1; r <= rounds; r++) {
    const count = Math.ceil(draw.length / 2 ** r);
    for (let i = 1; i <= count; i++) {
      const a = r === 1 ? draw[2 * i - 2] : won.get(`${r - 1}-${2 * i - 1}`) || null;
      const b = r === 1 ? draw[2 * i - 1] : won.get(`${r - 1}-${2 * i}`) || null;
      if (r === 1 && (a?.bye || b?.bye)) { won.set(`${r}-${i}`, a?.bye ? b : a); continue; }
      // El ganador va a media altura entre los dos de los que sale; el de un partido de la 1.ª ronda, algo por encima del primero
      const [lo, hi] = span(r, i);
      const w = winners.find(x => x.round === r && x.y >= lo - rowH && x.y <= hi + rowH && (same(x.name, a) || same(x.name, b)));
      let winner = null, score = null;
      if (w) {
        winner = same(w.name, a) ? 'a' : 'b';
        const p = winner === 'a' ? a : b;
        const tail = w.tail.slice(p?.seed != null && w.tail[0] === String(p.seed) ? 1 : 0);
        score = parseScore(tail);
        won.set(`${r}-${i}`, p);
      }
      matches.push({ round: r, index: i, a, b, winner, score });
    }
  }
  void qual;
  return { ...head, rounds, draw, matches };
}

// ---------- Cuadro final (mds.pdf): sólo cómo entró cada uno ----------
// Del cuadro final del torneo sólo hace falta la columna de la izquierda: posición, entrada (PR ranking protegido, WC, Q, LL, SE…),
// siembra, "APELLIDO, Nombre" y país. Lo usa el motor de los Challenger para el aviso de ranking protegido (riesgo de retirada).
// Los ganadores y las rondas no se leen: los da LiveScore
function parseEntries(items) {
  const head = headerOf(items);
  const names = items.filter(i => DRAW_NAME.test(i.text.trim()));
  if (!head || names.length < 8) return null;
  const minX = Math.min(...names.map(i => i.x));
  const col = items.filter(i => (DRAW_NAME.test(i.text.trim()) || /^Bye$/i.test(i.text.trim())) && i.x >= minX - 2 && i.x < minX + 30);
  const rows = rowsBy(items.filter(i => i.y >= Math.min(...col.map(n => n.y)) - 3 && i.x < minX + 100), 2.5);
  const entries = [];
  for (const nm of col) {
    if (/^Bye$/i.test(nm.text.trim())) continue;
    const row = rows.find(r => r.items.includes(nm));
    const left = row.items.filter(i => i.x < nm.x).map(i => i.text.trim());
    const pos = Number(left.find(t => /^\d{1,3}$/.test(t)));
    if (!pos) continue;
    const nums = left.filter(t => /^\d{1,2}$/.test(t)).map(Number);
    const m = nm.text.trim().match(DRAW_NAME);
    entries.push({ pos, seed: nums.length > 1 ? nums[nums.length - 1] : null, entry: left.find(t => ENTRY.test(t)) || null, ...nameOf(m[1], m[2] || ''),
      country: row.items.filter(i => i.x > nm.x).map(i => i.text.trim()).find(t => /^[A-Z]{3}$/.test(t)) || '' });
  }
  entries.sort((a, b) => a.pos - b.pos);
  return entries.length >= 8 ? { ...head, entries } : null;
}

// ---------- Orden de juego (op.pdf) ----------
// "ORDER OF PLAY - TUESDAY, NOVEMBER 17, 2026". Arriba, una fila con las pistas ("COURT" y "2" van en trozos distintos); debajo,
// por pista, filas con "Starts At 10:00", "Not Before 11:30" o "Followed By" y en cada una un partido: la línea de un jugador
// ("[WC] Casey HOOLE (AUS)"), "vs" y la del otro debajo. La pista es la columna en que cae el "vs"; la hora, la etiqueta de su fila.
// Los "Followed By" no tienen hora: la del turno anterior de la pista + 1 h 30 (y se avisa de que es aproximada)
const PLAYER = /^(?:\[([^\]]+)\]\s*)?(.*?)\s*\(([A-Z]{3})\)$/;
function playerOfLine(txt) {
  const m = txt.match(PLAYER);
  if (!m) return { placeholder: txt.trim() };
  const words = m[2].trim().split(/\s+/);
  // El apellido son las palabras en mayúsculas del final ("Carl Emil OVERBECK", "Mustafa Ege SIK", "Li TU")
  let k = words.length;
  while (k > 1 && /^[A-Z'’\-]{2,}$/.test(words[k - 1].replace(/[.]/g, ''))) k--;
  if (k === words.length) k = words.length - 1;
  return { ...nameOf(words.slice(k).join(' '), words.slice(0, k).join(' ')), country: m[3], tag: m[1] || null };
}

function parseOrder(items) {
  const head = headerOf(items);
  const dl = items.find(i => /^ORDER OF PLAY - [A-Z]+, ([A-Z]+) (\d{1,2}), (\d{4})$/i.test(i.text.trim()));
  if (!head || !dl) return null;
  const [, mon, dd, yy] = dl.text.trim().match(/([A-Z]+) (\d{1,2}), (\d{4})$/i);
  const day = `${yy}-${String(MONTHS[mon.toLowerCase()]).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const t = items.map(i => ({ ...i, text: i.text.trim() }));
  // Pistas: la fila del primer "COURT"/"CENTRE"…, juntando los trozos cercanos ("COURT" + "2")
  const first = t.find(i => /^(COURT|CENTRE|CENTER|STADIUM|CANCHA|PISTA)\b/i.test(i.text) && i.text.length < 30);
  const courts = [];
  if (first) {
    for (const it of t.filter(i => Math.abs(i.y - first.y) < 2).sort((a, b) => a.x - b.x)) {
      const c = courts[courts.length - 1];
      if (c && it.x - c.end < 40) { c.name += ` ${it.text}`; c.end = it.x + (it.w || it.text.length * it.size * 0.6); }
      else courts.push({ name: it.text, x: it.x, end: it.x + it.text.length * it.size * 0.6 });
    }
  }
  if (!courts.length) return { ...head, day, matches: [] };
  const colOf = x => courts.reduce((b, c) => (Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b), courts[0]);
  // Turnos de cada pista, de arriba abajo, con su hora
  const slots = t.filter(i => /^(Starts At|Not Before|Followed By|After Rest)\b/i.test(i.text) && i.y < first.y);
  const byCourt = new Map(courts.map(c => [c.name, []]));
  for (const s of slots) byCourt.get(colOf(s.x).name).push(s);
  const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const hm = n => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  for (const list of byCourt.values()) {
    list.sort((a, b) => b.y - a.y);
    let prev = null;
    list.forEach((s, k) => {
      s.order = k + 1;
      const own = (s.text.match(/(\d{1,2}):(\d{2})/) || [])[0];
      if (own) { s.time = own; s.approx = /^Not Before/i.test(s.text) ? 'no antes de' : false; prev = toMin(own); }
      else { s.time = prev != null ? hm(prev + 90) : null; s.approx = 'a continuación'; if (prev != null) prev += 90; }
    });
  }
  const out = [];
  for (const v of t.filter(i => i.text === 'vs' && i.y < first.y)) {
    const court = colOf(v.x);
    const near = i => colOf(i.x) === court && i !== v && !/^(Starts At|Not Before|Followed By|After Rest|\d+\.?)$/i.test(i.text) && !/^\d+\.$/.test(i.text);
    const line = (lo, hi) => t.filter(i => near(i) && i.y > lo && i.y < hi).sort((a, b) => b.y - a.y || a.x - b.x);
    const above = line(v.y, v.y + 18), below = line(v.y - 18, v.y);
    const pick = list => { if (!list.length) return { placeholder: '' }; const y0 = list[0].y; return playerOfLine(list.filter(i => Math.abs(i.y - y0) < 1.5).map(i => i.text).join(' ')); };
    const slot = (byCourt.get(court.name) || []).filter(s => s.y > v.y).sort((a, b) => a.y - b.y)[0];
    out.push({ a: pick(above.reverse().sort((a, b) => a.y - b.y)), b: pick(below), court: court.name, order: slot?.order ?? null, time: slot?.time ?? null, approx: slot?.approx ?? 'a continuación', label: slot?.text || '' });
  }
  out.sort((x, y) => x.court.localeCompare(y.court) || (x.order ?? 99) - (y.order ?? 99));
  return { ...head, day, matches: out };
}

module.exports = { pdfItems, parseDraw, parseEntries, parseOrder, parseScore, headerOf };
