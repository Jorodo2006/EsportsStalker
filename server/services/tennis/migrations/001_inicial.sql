-- Caché de las respuestas de ESPN (tenis): se usa si ESPN no responde
CREATE TABLE tennis.cache (
  key   text PRIMARY KEY,
  value jsonb NOT NULL,
  t     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cache_t_idx ON tennis.cache (t);
