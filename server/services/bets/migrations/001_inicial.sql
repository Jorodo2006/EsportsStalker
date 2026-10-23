-- Apuestas (simples y combinadas) y ajustes de la app
CREATE TABLE bets.bets (
  id         text PRIMARY KEY,
  seq        bigserial NOT NULL,            -- orden de alta (la interfaz ordena por su cuenta)
  date       date NOT NULL,
  league     text NOT NULL DEFAULT '',
  event      text NOT NULL DEFAULT '',
  market     text NOT NULL DEFAULT '',
  selection  text NOT NULL DEFAULT '',
  bookmaker  text NOT NULL DEFAULT '',
  odds       double precision NOT NULL DEFAULT 0,
  stake      double precision NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'won', 'lost', 'void', 'cashout', 'halfwon', 'halflost')),
  cashout    double precision NOT NULL DEFAULT 0,
  notes      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bets_date_idx ON bets.bets (date);

-- Selecciones de una combinada (2 o más); la cuota y el estado de la apuesta salen de aquí
CREATE TABLE bets.bet_legs (
  bet_id    text NOT NULL REFERENCES bets.bets (id) ON DELETE CASCADE,
  pos       int NOT NULL,
  event     text NOT NULL DEFAULT '',
  league    text NOT NULL DEFAULT '',
  market    text NOT NULL DEFAULT '',
  selection text NOT NULL DEFAULT '',
  odds      double precision NOT NULL DEFAULT 0,
  status    text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'void')),
  PRIMARY KEY (bet_id, pos)
);

-- Ajustes clave/valor (las credenciales del .env nunca se guardan aquí)
CREATE TABLE bets.settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
