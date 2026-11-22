'use strict';
// Subir la captura de un ticket (POST /api/bets/scan): OCR (ocr.js) → qué dice (ticket.js) → los partidos de esos días de cada
// deporte, pedidos a su servicio por su API → borrador de apuesta enlazado. No guarda nada: el usuario lo revisa y lo guarda
// con la ruta de siempre (POST /api/bets).
const client = require('../../shared/client');
const { fail } = require('../../shared/service');
const ocr = require('./ocr');
const { parseTicket, linkTicket, gameOf } = require('./ticket');
const { limiter } = require('./auth');

// Cada lectura cuesta ~1 s de CPU: 30 por hora y usuario
const perUser = limiter(30, 60 * 60e3);
const SPORTS = [['basket', '/api/basket/games'], ['football', '/api/football/games'], ['tennis', '/api/tennis/games'], ['mma', '/api/mma/games']];
const madridDay = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Los partidos del día de la apuesta, el anterior y el siguiente (se apuesta antes del partido, y la hora de España cruza días).
// Si el ticket no trae fecha (bet365), desde 4 días antes de hoy: la captura se puede subir días después
async function gamesAround(at, dated) {
  const day = madridDay(at);
  const days = (dated ? [-1, 0, 1] : [-4, -3, -2, -1, 0, 1]).map(n => addDays(day, n));
  const lists = await Promise.all(SPORTS.flatMap(([sport, path]) => days.map(d =>
    client.call(sport, 'GET', `${path}?date=${d}`).then(list => (Array.isArray(list) ? list : []).map(g => gameOf(sport, g)).filter(Boolean)).catch(() => []))));
  const seen = new Set();
  return lists.flat().filter(g => !seen.has(`${g.sport}|${g.id}`) && seen.add(`${g.sport}|${g.id}`));
}

async function scan(userId, image) {
  if (perUser.blocked(userId)) throw fail('Has subido muchos tickets seguidos: espera un rato', 429);
  perUser.add(userId);
  const text = await ocr.read(image);
  const t = parseTicket(text);
  if (!t.legs.length) throw fail('No encuentro ninguna apuesta en la imagen. Sube la captura del ticket entero, sin recortar, con el importe y las selecciones.', 422);
  const games = await gamesAround(t.placedAt ?? Date.now(), t.placedAt != null);
  return linkTicket(t, games);
}

module.exports = { scan };
