-- Caché de las consultas a Leaguepedia (antes leaguepedia-cache.json). Fandom limita mucho las peticiones.
CREATE TABLE esports.cache (
  key   text PRIMARY KEY,
  value jsonb NOT NULL,
  t     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cache_t_idx ON esports.cache (t);
