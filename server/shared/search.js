'use strict';
// Buscador: cómo se compara lo que escribe el usuario con los nombres de equipos, jugadores y competiciones. Sin tildes ni
// mayúsculas, y cada palabra tiene que estar al principio de alguna palabra del nombre ("barc" encuentra "FC Barcelona",
// "real mad" encuentra "Real Madrid", pero "drid" no). Lo usan los servicios en su ruta /api/<servicio>/search.

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// q ya normalizado; names: todos los nombres por los que se puede encontrar algo (el oficial, la abreviatura, otros)
function hits(q, names) {
  const words = q.split(' ').filter(Boolean);
  if (!words.length) return false;
  return names.some(n => {
    const parts = norm(n).split(' ');
    return words.every(w => parts.some(p => p.startsWith(w)));
  });
}

// La consulta de la ruta, o null si es demasiado corta para buscar
const queryOf = q => { const v = norm(String(q || '').slice(0, 60)); return v.length >= 2 ? v : null; };

module.exports = { norm, hits, queryOf };
