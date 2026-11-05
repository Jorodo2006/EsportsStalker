-- De qué deporte y competición es cada partido, para poder consultar el histórico por deporte
ALTER TABLE odds.matches ADD COLUMN sport text NOT NULL DEFAULT 'lol';
ALTER TABLE odds.matches ADD COLUMN league text;

-- Cada fila del histórico es un tramo: la cuota valió `price` desde `ts` hasta `last_seen`, la última lectura que la vio.
-- `match_start` separa las revanchas: dos partidos entre los mismos equipos comparten match_key.
ALTER TABLE odds.price_history ADD COLUMN last_seen timestamptz;
ALTER TABLE odds.price_history ADD COLUMN match_start timestamptz;
UPDATE odds.price_history SET last_seen = ts;
ALTER TABLE odds.price_history ALTER COLUMN last_seen SET NOT NULL;
ALTER TABLE odds.price_history ALTER COLUMN last_seen SET DEFAULT now();
UPDATE odds.price_history h SET match_start = m.start FROM odds.matches m
  WHERE m.key = h.match_key AND h.ts <= m.start AND h.ts > m.start - interval '3 days';
CREATE INDEX price_history_ts_idx ON odds.price_history (ts);

-- La cola de lecturas va por cercanía: primero los partidos que empiezan antes
ALTER TABLE odds.jobs ADD COLUMN start timestamptz;
