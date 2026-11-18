-- Panel de administración: cuentas suspendidas, último acceso, registro de lo que hacen los administradores y de los accesos.
-- suspended_at: la cuenta no puede abrir sesión y sus sesiones se cierran. last_seen_at: última petición con sesión (como mucho
-- una escritura cada 5 min por usuario, ver seenStale en admin-rules.js)
ALTER TABLE bets.users ADD COLUMN suspended_at timestamptz, ADD COLUMN last_seen_at timestamptz;

-- Qué hizo cada administrador. Sin clave foránea a propósito: el registro tiene que sobrevivir a que se borre la cuenta del
-- administrador o la de la persona afectada (por eso también guarda sus nombres). Se conserva 365 días
CREATE TABLE bets.admin_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  admin_id    bigint,
  admin_name  text NOT NULL,
  action      text NOT NULL,
  target_id   bigint,
  target_name text,
  detail      jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX admin_log_at_idx ON bets.admin_log (at DESC);

-- Entradas, intentos fallidos y altas, con la IP: sirve para detectar abusos. Datos personales: se conservan 90 días
-- (authEvents.purge) y se dice en la política de privacidad. username sólo se guarda si la cuenta existe
CREATE TABLE bets.auth_events (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  kind     text NOT NULL CHECK (kind IN ('login_ok', 'login_fail', 'register', 'register_blocked')),
  user_id  bigint REFERENCES bets.users (id) ON DELETE SET NULL,
  username text,
  ip       text
);
CREATE INDEX auth_events_at_idx ON bets.auth_events (at DESC);
CREATE INDEX auth_events_kind_idx ON bets.auth_events (kind, at DESC);
