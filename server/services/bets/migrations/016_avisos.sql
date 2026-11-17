-- Avisos de cuotas de cada usuario (alerts.js): caídas y subidas fuertes en lo suyo (favoritos, apuestas pendientes y cupón) y
-- recomendaciones nuevas con valor. dedupe: qué es (partido, mercado, selección y tipo), para no avisar dos veces de lo mismo.
-- open: cómo abrir el partido desde el aviso ({ sport, id, date } si se conoce)
CREATE TABLE IF NOT EXISTS bets.alerts (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES bets.users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('drop', 'rise', 'value')),
  dedupe     text NOT NULL,
  sport      text NOT NULL DEFAULT '',
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  open       jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX IF NOT EXISTS alerts_user_idx ON bets.alerts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_dedupe_idx ON bets.alerts (user_id, dedupe, created_at DESC);

-- Dónde mandar las notificaciones con la app cerrada (Web Push): una fila por navegador o móvil que lo ha permitido. keys son las
-- del navegador para cifrar el aviso; el servicio de push (de Google, Mozilla o Apple) sólo ve el aviso cifrado
CREATE TABLE IF NOT EXISTS bets.push_subs (
  endpoint   text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES bets.users(id) ON DELETE CASCADE,
  keys       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subs_user_idx ON bets.push_subs (user_id);

-- Claves VAPID con las que el servidor firma las notificaciones (push.js). Si no están en el .env se generan la primera vez y se
-- guardan aquí: sin ellas, cada reinicio dejaría sin servir las suscripciones de todos. Nunca salen por una ruta (sólo la pública)
CREATE TABLE IF NOT EXISTS bets.vapid (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_key  text NOT NULL,
  private_key text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
