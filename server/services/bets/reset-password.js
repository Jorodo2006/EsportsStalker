// Contraseña olvidada: docker compose exec bets node services/bets/reset-password.js <usuario> <nueva>
const { query } = require('../../shared/db');
const { hashPassword } = require('./auth');

(async () => {
  const [username, password] = process.argv.slice(2);
  if (!username || !password || password.length < 8) throw new Error('Uso: reset-password.js <usuario> <contraseña de al menos 8 caracteres>');
  const { rows } = await query('UPDATE bets.users SET password_hash = $2 WHERE lower(username) = lower($1) RETURNING id', [username, await hashPassword(password)]);
  if (!rows[0]) throw new Error(`No existe el usuario ${username}`);
  await query('DELETE FROM bets.sessions WHERE user_id = $1', [rows[0].id]);
  console.log(`Contraseña cambiada y sesiones cerradas de ${username}`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
