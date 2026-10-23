// Marcador (bookmarklet) y extensión de Chrome: se generan aquí, en local, porque el usuario los instala
// desde la carpeta de la app. Los dos mandan las cuotas al gateway del backend (127.0.0.1:47365).
const fs = require('fs');
const path = require('path');

const PORT = 47365;

function bookmarkletUrl() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'bookmarklet', 'marcador.js'), 'utf8')
    .replace(/__PORT__/g, String(PORT))
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  return 'javascript:' + encodeURIComponent(code);
}

// Lector para la extensión: el mismo código del marcador, con el puerto puesto
const lectorCode = () => fs.readFileSync(path.join(__dirname, '..', 'bookmarklet', 'marcador.js'), 'utf8').replace(/__PORT__/g, String(PORT));

// Copia la extensión de Chrome (plantillas + lector) a una carpeta que el usuario carga en chrome://extensions
function writeExtension(target) {
  const src = path.join(__dirname, '..', 'extension');
  fs.mkdirSync(target, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const out = fs.readFileSync(path.join(src, f), 'utf8').replace(/__PORT__/g, String(PORT));
    const dest = path.join(target, f);
    let prev = null; try { prev = fs.readFileSync(dest, 'utf8'); } catch (_) {}
    if (prev !== out) fs.writeFileSync(dest, out);
  }
  const lector = lectorCode(), dest = path.join(target, 'lector.js');
  let prev = null; try { prev = fs.readFileSync(dest, 'utf8'); } catch (_) {}
  if (prev !== lector) fs.writeFileSync(dest, lector);
  return target;
}

module.exports = { bookmarkletUrl, writeExtension, PORT };
