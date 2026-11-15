-- Mensajes entre amigos: el chat de cada pareja. Las apuestas que se pasan siguen en bets.shared_bets y la conversación
-- junta las dos cosas por fecha (friends.js). Sólo se puede escribir a un amigo aceptado; si dejan de serlo, no se borran
CREATE TABLE IF NOT EXISTS bets.messages (
  id         bigserial PRIMARY KEY,
  from_user  bigint NOT NULL REFERENCES bets.users(id) ON DELETE CASCADE,
  to_user    bigint NOT NULL REFERENCES bets.users(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  CHECK (from_user <> to_user)
);
CREATE INDEX IF NOT EXISTS messages_pair_idx ON bets.messages (from_user, to_user, created_at DESC);
-- Los sin leer de cada uno, para el número del menú
CREATE INDEX IF NOT EXISTS messages_unread_idx ON bets.messages (to_user) WHERE read_at IS NULL;
