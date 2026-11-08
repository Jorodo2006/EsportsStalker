-- Caché de las respuestas de ESPN (fútbol): se usa si ESPN no responde
CREATE TABLE football.cache (
  key   text PRIMARY KEY,
  value jsonb NOT NULL,
  t     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cache_t_idx ON football.cache (t);
