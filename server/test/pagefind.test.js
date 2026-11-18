// pageFind (server/lector/pagefind.js) corre dentro de la página de la casa. Aquí se prueba con un DOM falso mínimo: lo justo
// que usa la función (selectores de etiqueta, [data-eventid] y a[href*=…]).
// Caso real: Betway tenía a la vez Utah–Clippers y Hornets–Lakers en la lista; buscando Utah–Lakers, el contenedor de las dos
// filas tenía "Utah Jazz" en una y "Lakers" en otra, y el lector leyó el evento del Clippers como si fuera el de los Lakers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pageFind } = require('../lector/pagefind');

class El {
  constructor(tag, attrs = {}, kids = []) {
    this.tag = tag; this.attrs = attrs; this.kids = kids.map(k => (typeof k === 'string' ? { text: k } : k));
    this.parentElement = null;
    for (const k of this.kids) if (k instanceof El) k.parentElement = this;
  }
  get innerText() { return this.kids.map(k => (k instanceof El ? k.innerText : k.text)).join(' '); }
  get href() { return this.attrs.href; }
  getAttribute(n) { return this.attrs[n] ?? null; }
  getBoundingClientRect() { return { width: 10, height: 10 }; }
  matches(sel) {
    return sel.split(',').map(x => x.trim()).some(s => {
      if (/^[a-z]+$/.test(s)) return this.tag === s;
      if (s === '[data-eventid]') return this.attrs['data-eventid'] != null;
      const m = /^a\[href\*="(.+)"\]$/.exec(s);
      return !!m && this.tag === 'a' && String(this.attrs.href || '').includes(m[1]);
    });
  }
  all() { return this.kids.flatMap(k => (k instanceof El ? [k, ...k.all()] : [])); }
  querySelectorAll(sel) { return this.all().filter(e => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let c = this; c; c = c.parentElement) if (c.matches(sel)) return c; return null; }
}
const el = (tag, attrs, ...kids) => new El(tag, attrs, kids);
const ev = (id, a, b, extra = []) => el('div', {}, el('a', { href: `/es/es/sports/event/${id}` }, el('span', {}, a), el('span', {}, b), ...extra));

const OPTS = { href: 'a[href*="/sports/event/"]', selector: '[data-eventid],a[href*="/sports/event/"],div,li,article', scroll: true };
const JAZZ = { name: 'Utah Jazz', code: 'UTAH', alt: ['Jazz'] }, LAKERS = { name: 'Los Angeles Lakers', code: 'LAL', alt: ['Lakers'] };

function find(rows, teams = [JAZZ, LAKERS]) {
  const body = el('div', {}, ...rows);
  let scrolled = 0;
  // El contenedor de la lista también es un candidato (en el DOM real es un descendiente del body)
  globalThis.document = { querySelectorAll: sel => [body, ...body.querySelectorAll(sel)].filter(e => e.matches(sel)) };
  globalThis.window = { scrollBy: () => { scrolled++; } };
  try { return { r: pageFind(teams, OPTS), scrolled }; } finally { delete globalThis.document; delete globalThis.window; }
}

test('encuentra el evento cuando están los dos equipos en la misma tarjeta', () => {
  const { r } = find([ev(1, 'Utah Jazz', 'Los Angeles Clippers'), ev(2, 'Utah Jazz', 'Los Angeles Lakers'), ev(3, 'Charlotte Hornets', 'Boston Celtics')]);
  assert.match(r, /event\/2$/);
});

test('no coge el evento de otro partido cuando cada equipo sale en una tarjeta distinta y contiguas', () => {
  const { r, scrolled } = find([ev(17497162, 'Utah Jazz', 'Los Angeles Clippers'), ev(17497100, 'Charlotte Hornets', 'Los Angeles Lakers')]);
  assert.equal(r, null);
  assert.ok(scrolled > 0, 'sigue desplazando la lista por si el partido aún no ha cargado');
});

test('tampoco aunque el otro partido vaya primero y el de los Lakers después', () => {
  const { r } = find([ev(1, 'Los Angeles Lakers', 'Charlotte Hornets'), ev(2, 'Utah Jazz', 'LA Clippers')]);
  assert.equal(r, null);
});

test('una tarjeta con dos enlaces al mismo evento (p. ej. «más mercados») sigue valiendo', () => {
  const card = el('div', {}, el('a', { href: '/es/es/sports/event/9' }, el('span', {}, 'Utah Jazz'), el('span', {}, 'Los Angeles Lakers')), el('a', { href: '/es/es/sports/event/9?marketGroup=main' }, el('span', {}, '+45')));
  const { r } = find([ev(1, 'Utah Jazz', 'Los Angeles Clippers'), card]);
  assert.match(r, /event\/9/);
});

test('si el enlace está fuera del texto de la tarjeta, lo busca subiendo sin salirse del partido', () => {
  const row = el('div', {}, el('div', {}, el('span', {}, 'Utah Jazz'), el('span', {}, 'Los Angeles Lakers')), el('a', { href: '/es/es/sports/event/5' }, 'Ver'));
  const { r } = find([ev(1, 'Utah Jazz', 'Los Angeles Clippers'), row]);
  assert.match(r, /event\/5$/);
});

test('con data-eventid también', () => {
  const card = el('div', { 'data-eventid': '77' }, el('span', {}, 'Utah Jazz'), el('span', {}, 'Los Angeles Lakers'));
  const other = el('div', { 'data-eventid': '78' }, el('span', {}, 'Charlotte Hornets'), el('span', {}, 'Boston Celtics'));
  const { r } = find([other, card]);
  assert.equal(r, '/sports/event/77');
});

test('con words encuentra "Rigas Zelli" por "Riga Zelli", y sigue sin cruzar partidos contiguos', () => {
  const ZELLI = { name: 'Riga Zelli', code: 'RZ', alt: [] }, OTHER = { name: 'Kalev Cramo', code: 'KAL', alt: [] };
  const run = (rows, words) => {
    const body = el('div', {}, ...rows);
    globalThis.document = { querySelectorAll: sel => [body, ...body.querySelectorAll(sel)].filter(e => e.matches(sel)) };
    globalThis.window = { scrollBy: () => {} };
    try { return pageFind([ZELLI, OTHER], { ...OPTS, words } ); } finally { delete globalThis.document; delete globalThis.window; }
  };
  assert.match(run([ev(1, 'Rigas Zelli', 'Kalev Cramo')], true), /event\/1$/);
  assert.equal(run([ev(1, 'Rigas Zelli', 'Otro Equipo'), ev(2, 'Alguien Mas', 'Kalev Cramo')], true), null);
});
