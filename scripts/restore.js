// Restaura una copia: npm run db:restore -- backups/lolet-AAAAMMDD-HHMMSS.dump
// BORRA lo que haya en la base de datos y lo sustituye por la copia: pide confirmación escribiendo "si".
// Para no tocar la base de datos real, RESTORE_DB=otra_base restaura en una base distinta (se crea si no existe).
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Uso: npm run db:restore -- <copia.dump>'); process.exit(1); }
const compose = (process.env.COMPOSE_FILES || 'docker-compose.yml').split(',').flatMap(f => ['-f', f.trim()]);
const dc = (args, opts = {}) => spawnSync('docker', ['compose', ...compose, 'exec', '-T', 'db', ...args], { encoding: 'utf8', ...opts });
const target = process.env.RESTORE_DB;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question(`Se va a restaurar ${path.basename(file)} ${target ? `en la base "${target}"` : 'sobre la base de datos ACTUAL (se pierde lo que tenga)'}. Escribe "si" para seguir: `, answer => {
  rl.close();
  if (answer.trim().toLowerCase() !== 'si') { console.log('Cancelado.'); process.exit(1); }
  const db = target ? `'${target.replace(/[^\w]/g, '')}'` : '"$POSTGRES_DB"';
  if (target) dc(['sh', '-c', `psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE ${db.replace(/'/g, '')}"`]);
  const p = spawn('docker', ['compose', ...compose, 'exec', '-T', 'db', 'sh', '-c', `pg_restore -U "$POSTGRES_USER" -d ${db} --clean --if-exists --no-owner`], { stdio: ['pipe', 'inherit', 'inherit'] });
  fs.createReadStream(file).pipe(p.stdin);
  p.on('close', code => { console.log(code === 0 ? 'Restaurada.' : `pg_restore terminó con código ${code} (los avisos de "does not exist" al limpiar son normales).`); process.exit(0); });
});
