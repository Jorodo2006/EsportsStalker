-- Usuarios y sesiones: cada uno tiene su cartera. El primero en registrarse es el administrador y se queda con
-- las apuestas y las preferencias que ya había (user_id NULL hasta entonces)
CREATE TABLE bets.users (
  id            bigserial PRIMARY KEY,
  username      text NOT NULL,
  password_hash text NOT NULL,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_name_idx ON bets.users (lower(username));

-- Sólo se guarda el hash del token: quien lea la base de datos no puede entrar con él
CREATE TABLE bets.sessions (
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES bets.users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expires_idx ON bets.sessions (expires_at);

-- Preferencias de cada usuario (banca inicial, moneda…). En bets.settings quedan los ajustes comunes
CREATE TABLE bets.user_settings (
  user_id    bigint NOT NULL REFERENCES bets.users (id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE bets.bets ADD COLUMN user_id bigint REFERENCES bets.users (id) ON DELETE CASCADE;
CREATE INDEX bets_user_idx ON bets.bets (user_id, seq);
