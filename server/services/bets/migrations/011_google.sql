-- Entrar con Google. google_sub es el identificador de la cuenta de Google (no cambia aunque cambie su correo); google_email
-- es sólo para enseñarlo en «Tu cuenta». Quien entra sólo con Google no tiene contraseña (se la puede poner en «Tu cuenta»)
ALTER TABLE bets.users ADD COLUMN google_sub text, ADD COLUMN google_email text;
CREATE UNIQUE INDEX users_google_idx ON bets.users (google_sub) WHERE google_sub IS NOT NULL;
ALTER TABLE bets.users ALTER COLUMN password_hash DROP NOT NULL;
