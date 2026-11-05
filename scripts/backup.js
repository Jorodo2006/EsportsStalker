// Copia de seguridad de PostgreSQL: npm run db:backup [carpeta]
// Guarda backups/lolet-AAAAMMDD-HHMMSS.dump (formato de pg_dump -Fc, comprimido) y borra las más antiguas
// (BACKUP_KEEP, 14 por defecto). Usa el contenedor `db` de Docker Compose, así que el backend tiene que estar encendido.
// Para producción: programa este mismo comando (cron o el programador de tareas) y copia la carpeta fuera del servidor.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const dir = path.resolve(process.argv[2] || 'backups');
const keep = Number(process.env.BACKUP_KEEP) || 14;
const compose = (process.env.COMPOSE_FILES || 'docker-compose.yml').split(',').flatMap(f => ['-f', f.trim()]);
const pad = n => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const file = path.join(dir, `lolet-${stamp}.dump`);

fs.mkdirSync(dir, { recursive: true });
const out = fs.createWriteStream(file);
// Se ejecuta dentro del contenedor, que ya tiene POSTGRES_USER y POSTGRES_DB
const p = spawn('docker', ['compose', ...compose, 'exec', '-T', 'db', 'sh', '-c', 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'], { stdio: ['ignore', 'pipe', 'inherit'] });
p.stdout.pipe(out);
p.on('error', e => fail(`No se pudo ejecutar docker: ${e.message}`));
p.on('close', code => {
  out.end(() => {
    if (code !== 0 || fs.statSync(file).size < 1000) return fail(`pg_dump terminó con código ${code}. ¿Está encendido el backend (npm run backend)?`);
    console.log(`Copia guardada: ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
    const old = fs.readdirSync(dir).filter(f => /^lolet-.*\.dump$/.test(f)).sort().slice(0, -keep);
    for (const f of old) { fs.unlinkSync(path.join(dir, f)); console.log(`Borrada la más antigua: ${f}`); }
  });
});

function fail(msg) {
  console.error(msg);
  try { fs.unlinkSync(file); } catch (_) { /* no se llegó a crear */ }
  process.exit(1);
}
