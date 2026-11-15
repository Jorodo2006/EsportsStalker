// Todos los ficheros del servidor se pueden cargar: sin errores de sintaxis (una variable declarada dos veces dejó el servicio de
// cuotas sin arrancar, y ninguna otra prueba carga el programador). node --check no ejecuta nada: no hace falta base de datos
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'test', 'datos', 'demo']);

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (SKIP.has(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(c?js)$/.test(e.name) ? [p] : [];
  });
}

test('todos los .js del servidor tienen la sintaxis bien', () => {
  const list = files(ROOT);
  assert.ok(list.length > 20, 'no encuentro los ficheros del servidor');
  const bad = [];
  for (const f of list) {
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
    catch (e) { bad.push(`${path.relative(ROOT, f)}: ${String(e.stderr).split('\n').find(l => /Error/.test(l)) || e.message}`); }
  }
  assert.deepEqual(bad, []);
});
