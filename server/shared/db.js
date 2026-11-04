// Conexión a PostgreSQL compartida por los servicios. Cada servicio tiene su propio esquema
// (bets, esports, odds, basket, tennis) y sus migraciones; ninguno toca las tablas de otro.
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// DATE como 'YYYY-MM-DD' (no como Date con zona horaria) y bigint como número
types.setTypeParser(1082, v => v);
types.setTypeParser(20, v => Number(v));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', e => console.error('Error en la conexión con PostgreSQL:', e.message));

const query = (text, params) => pool.query(text, params);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Transacción: fn recibe el cliente; si lanza, se deshace todo
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Aplica en orden los ficheros .sql de la carpeta que aún no estén en <esquema>.migraciones.
// El bloqueo evita que dos copias del mismo servicio migren a la vez.
async function migrate(schema, dir) {
  for (let i = 0; ; i++) {
    try { await query('SELECT 1'); break; }
    catch (e) {
      if (i >= 30) throw e;
      console.log(`Esperando a PostgreSQL… (${e.message})`);
      await sleep(2000);
    }
  }
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [schema]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.migraciones (nombre text PRIMARY KEY, fecha timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query(`SELECT nombre FROM ${schema}.migraciones`)).rows.map(r => r.nombre));
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        await client.query(`INSERT INTO ${schema}.migraciones (nombre) VALUES ($1)`, [f]);
        await client.query('COMMIT');
        console.log(`Migración aplicada: ${schema}/${f}`);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migración ${schema}/${f}: ${e.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [schema]).catch(() => {});
    client.release();
  }
}

// Aviso para el gateway (LISTEN lolet), que lo reenvía a la app por SSE
const notify = (type, data) => query('SELECT pg_notify($1, $2)', ['lolet', JSON.stringify({ type, data })]).catch(e => console.error('pg_notify:', e.message));

module.exports = { pool, query, tx, migrate, notify };
