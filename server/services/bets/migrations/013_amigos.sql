-- Amigos: cada usuario puede añadir a otro por su nombre (una solicitud que el otro acepta) y enviarle apuestas suyas.
-- Una fila por pareja: quien la pide (user_id) y a quién (friend_id); al aceptarla son amigos los dos
CREATE TABLE IF NOT EXISTS bets.friends (
  user_id     bigint NOT NULL REFERENCES bets.users(id) ON DELETE CASCADE,
  friend_id   bigint NOT NULL REFERENCES bets.users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);
CREATE INDEX IF NOT EXISTS friends_friend_idx ON bets.friends (friend_id);

-- Apuestas enviadas a un amigo: una copia de lo que se apuesta (partido, mercado, selección, cuota, casa y, si es combinada,
-- sus selecciones), sin el importe ni el resultado de quien la envía. Si quien la envía la cambia después, la copia no cambia
CREATE TABLE IF NOT EXISTS bets.shared_bets (
  id         bigserial PRIMARY KEY,
  from_user  bigint NOT NULL REFERENCES bets.users(id) ON DELETE CASCADE,
  to_user    bigint NOT NULL REFERENCES bets.users(id) ON DELETE CASCADE,
  bet        jsonb NOT NULL,
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at    timestamptz,
  copied_at  timestamptz,
  hidden_at  timestamptz
);
CREATE INDEX IF NOT EXISTS shared_bets_to_idx ON bets.shared_bets (to_user, created_at DESC);
