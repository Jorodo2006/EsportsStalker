'use strict';
// Colores de los equipos de la Euroliga y la EuroCup: su API no los da, así que salen del propio escudo. Se hace aquí y no en el
// navegador porque sus servidores no permiten leer los píxeles desde otra web (CORS). Sin dependencias: PNG con zlib.
const zlib = require('node:zlib');
const { remember, bulk } = require('./cache');

const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
const SAMPLES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

// Llama a emit(r, g, b, a) con cada píxel, en cualquier orden. false si no es un PNG que se sepa leer.
// La mayoría de estos escudos están entrelazados y alguno usa paleta o 16 bits: hay que soportarlos todos
function eachPixel(buf, emit) {
  if (buf.length < 33 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return false;
  let width = 0, height = 0, depth = 0, type = 0, interlaced = false, palette = null, trns = null;
  const idat = [];
  for (let pos = 8; pos + 8 <= buf.length;) {
    const len = buf.readUInt32BE(pos), name = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlaced = body[12] === 1; }
    else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') trns = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  const samples = SAMPLES[type];
  if (!samples || !width || !height || !idat.length) return false;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bits = samples * depth, bpp = Math.max(1, bits >> 3);
  const read = (row, x, i) => {
    if (depth === 8) return row[x * samples + i];
    if (depth === 16) return row[(x * samples + i) * 2];
    const bit = x * samples * depth, v = (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  let pos = 0;
  for (const [x0, y0, dx, dy] of interlaced ? ADAM7 : [[0, 0, 1, 1]]) {
    const w = Math.ceil((width - x0) / dx), h = Math.ceil((height - y0) / dy);
    if (w <= 0 || h <= 0) continue;
    const size = Math.ceil((w * bits) / 8);
    let prev = Buffer.alloc(size);
    for (let y = 0; y < h; y++) {
      const filter = raw[pos++], row = Buffer.from(raw.subarray(pos, pos + size));
      pos += size;
      for (let i = 0; i < size; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        row[i] = (row[i] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0)) & 255;
      }
      for (let x = 0; x < w; x++) {
        if (type === 6) emit(read(row, x, 0), read(row, x, 1), read(row, x, 2), read(row, x, 3));
        else if (type === 2) emit(read(row, x, 0), read(row, x, 1), read(row, x, 2), 255);
        else if (type === 3) { const n = read(row, x, 0); emit(palette[n * 3], palette[n * 3 + 1], palette[n * 3 + 2], trns && n < trns.length ? trns[n] : 255); }
        else { const g = read(row, x, 0); emit(g, g, g, type === 4 ? read(row, x, 1) : 255); }
      }
      prev = row;
    }
  }
  return true;
}

const hex = (r, g, b) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const BINS = 24; // 15° cada uno
const MIN_SHARE = 0.04; // menos que esto del escudo es un detalle, no un color del equipo
const MIN_SATURATION = 0.3; // por debajo, los dorados metálicos con sombras dan un marrón que no es el color de nadie

// Clubes en los que el escudo engaña: Partizán, Besiktas y Virtus son blanco y negro, y un detalle rojo o dorado ganaba; el Barça y el
// Fenerbahçe tienen sus colores muy repartidos entre otros. Sólo los que se sabe seguro: el resto sale del escudo.
const KNOWN = {
  PAR: { color: '#000000', alt: '#ffffff' }, BES: { color: '#000000', alt: '#ffffff' }, VIR: { color: '#000000', alt: '#ffffff' },
  BAR: { color: '#004d98', alt: '#a50044' }, ULK: { color: '#002d72', alt: '#ffed00' }
};

// El color que más ocupa y el segundo, por tono, y cuanto más vivo más cuenta. El blanco, el negro y el gris se cuentan aparte porque la
// mayoría de los escudos llevan borde blanco o negro sin ser su color: sólo mandan si no hay ningún otro.
function crestColors(buf) {
  const bins = Array.from({ length: BINS }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
  let total = 0, dark = 0, light = 0;
  const ok = eachPixel(buf, (r, g, b, a) => {
    if (a < 128) return;
    total++;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), v = max / 255, s = max ? (max - min) / max : 0;
    if (v < 0.18) { dark++; return; }
    if (s < MIN_SATURATION) { if (v > 0.75) light++; return; }
    const d = max - min, h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
    const bin = bins[Math.floor(h / (360 / BINS)) % BINS];
    bin.n += s; bin.r += r * s; bin.g += g * s; bin.b += b * s;
  });
  if (!ok || !total) return null;
  // Un mismo color cae a menudo entre dos cajas vecinas: se mira cada una con las de al lado
  const around = i => [(i + BINS - 1) % BINS, i, (i + 1) % BINS];
  const peak = skip => {
    let best = -1, bestN = 0;
    for (let i = 0; i < BINS; i++) {
      if (skip.has(i)) continue;
      const n = around(i).reduce((t, j) => t + (skip.has(j) ? 0 : bins[j].n), 0);
      if (n > bestN) { best = i; bestN = n; }
    }
    if (best < 0 || bestN < total * MIN_SHARE) return null;
    const on = around(best).filter(j => !skip.has(j)), sum = k => on.reduce((t, j) => t + bins[j][k], 0), n = on.reduce((t, j) => t + bins[j].n, 0);
    return { i: best, color: hex(sum('r') / n, sum('g') / n, sum('b') / n) };
  };
  const first = peak(new Set());
  const neutral = () => (light >= total * MIN_SHARE && light >= dark ? '#ffffff' : dark >= total * MIN_SHARE ? '#000000' : null);
  if (!first) return dark >= light ? { color: '#000000', alt: light >= total * MIN_SHARE ? '#ffffff' : null } : { color: '#ffffff', alt: dark >= total * MIN_SHARE ? '#000000' : null };
  // El segundo, a más de 45° del primero: dos azules no son dos colores
  const near = new Set(); for (let k = -3; k <= 3; k++) near.add((first.i + k + BINS) % BINS);
  const second = peak(near);
  return { color: first.color, alt: second?.color ?? neutral() };
}

// Por dirección del escudo: si cambia, se vuelve a calcular. Si la imagen no se puede leer, el equipo sale con el color de la app.
const colorsOfCrest = url => remember(`keep:escudo2:${url}`, 0, async () => {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`respondió ${res.status}`);
  return crestColors(Buffer.from(await res.arrayBuffer()));
}, { keep: true });

const fromCrests = async clubs => Object.fromEntries((await Promise.all(clubs.map(async c => [c.id, KNOWN[c.id] ?? await bulk(() => colorsOfCrest(c.crest)).catch(e => { console.error(`[basket] escudo de ${c.id}:`, e.message); return null; })]))).filter(([, v]) => v));

module.exports = { crestColors, fromCrests };
