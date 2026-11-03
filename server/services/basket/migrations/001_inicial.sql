-- Caché de las fuentes de baloncesto (ESPN y la API de la Euroliga). Los box scores de partidos terminados no cambian,
-- así que se guardan mucho tiempo; el resto se refresca a los pocos minutos y sólo se usa si la fuente no responde.
CREATE TABLE basket.cache (
  key   text PRIMARY KEY,
  value jsonb NOT NULL,
  t     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cache_t_idx ON basket.cache (t);
