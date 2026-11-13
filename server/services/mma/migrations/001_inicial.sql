-- Caché de las respuestas de ESPN y de wowmma.com (MMA): se usa si la fuente no responde
CREATE TABLE mma.cache (
  key   text PRIMARY KEY,
  value jsonb NOT NULL,
  t     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cache_t_idx ON mma.cache (t);
