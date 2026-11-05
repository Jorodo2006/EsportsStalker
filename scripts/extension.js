// npm run extension: prepara extension-chrome/ (plantillas + lector del marcador), la carpeta que se carga en
// chrome://extensions. Es la reserva por si una casa bloquea al lector de Docker. Manda las cuotas al gateway.
const fs = require('fs');
const path = require('path');

const PORT = '47365';
const root = path.join(__dirname, '..');
const src = path.join(root, 'chrome', 'extension');
const target = path.join(root, 'extension-chrome');
const withPort = file => fs.readFileSync(file, 'utf8').replace(/__PORT__/g, PORT);

fs.mkdirSync(target, { recursive: true });
for (const f of fs.readdirSync(src)) fs.writeFileSync(path.join(target, f), withPort(path.join(src, f)));
fs.writeFileSync(path.join(target, 'lector.js'), withPort(path.join(root, 'chrome', 'bookmarklet', 'marcador.js')));
console.log(`Extensión preparada en ${target}`);
