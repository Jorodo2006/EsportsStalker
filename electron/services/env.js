// Credenciales en un fichero .env (fuera del repo) en vez de guardarlas desde Ajustes.
// Se busca en la carpeta del proyecto (desarrollo), junto al .exe y en la carpeta de datos del usuario;
// gana el primero que exista. Lo que venga del .env manda sobre lo guardado en Ajustes.
const fs = require('fs');
const path = require('path');

// Variable del .env → ajuste de la app
const MAP = {
  LEAGUEPEDIA_USER: 'leaguepediaUser',
  LEAGUEPEDIA_PASSWORD: 'leaguepediaPassword',
  LOLESPORTS_KEY: 'lolesportsKey'
};

let loadedFrom = null;

function parse(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, ''); // comentario al final de la línea
    out[m[1]] = v;
  }
  return out;
}

// Carga el primer .env que encuentre; las variables ya definidas en el sistema no se pisan
function load(dirs) {
  for (const dir of dirs.filter(Boolean)) {
    const file = path.join(dir, '.env');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    for (const [k, v] of Object.entries(parse(text))) if (process.env[k] === undefined) process.env[k] = v;
    loadedFrom = file;
    break;
  }
  return loadedFrom;
}

// Ajustes que vienen del .env (sólo los que tienen valor)
function settings() {
  const out = {};
  for (const [k, key] of Object.entries(MAP)) if (process.env[k]) out[key] = process.env[k];
  return out;
}

module.exports = { load, settings, file: () => loadedFrom };
