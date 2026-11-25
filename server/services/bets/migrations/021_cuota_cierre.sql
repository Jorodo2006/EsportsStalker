-- Cuota de cierre (la última de la casa antes de empezar el partido, del histórico de odds) de cada apuesta y de cada
-- recomendación, para el CLV: apostar a mejor cuota que la de cierre es la mejor señal de que se gana a la larga.
-- La escribe sólo el servidor (bets/closing.js): va en su tabla y no en el ref de la apuesta, que lo manda el navegador al guardar
-- y así nadie puede poner la suya. pos: -1 la apuesta simple; 0, 1… la selección de la combinada. match, key y out: la selección
-- a la que corresponde (si se edita la apuesta y cambia, no se enseña y se vuelve a buscar). price null: se buscó y no la hay
-- (el partido no se leyó cerca del inicio).
CREATE TABLE IF NOT EXISTS bets.closing (
  bet_id     text NOT NULL REFERENCES bets.bets (id) ON DELETE CASCADE,
  pos        int NOT NULL,
  match      text NOT NULL,
  key        text NOT NULL,
  out        text NOT NULL,
  price      double precision,
  book       text NOT NULL DEFAULT '',
  at         timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bet_id, pos)
);

-- Lo mismo de las recomendaciones del modelo. close_checked: ya se buscó (con o sin cuota de cierre)
ALTER TABLE bets.predictions ADD COLUMN IF NOT EXISTS close_price numeric;
ALTER TABLE bets.predictions ADD COLUMN IF NOT EXISTS close_book text;
ALTER TABLE bets.predictions ADD COLUMN IF NOT EXISTS close_at timestamptz;
ALTER TABLE bets.predictions ADD COLUMN IF NOT EXISTS close_checked boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS predictions_close_idx ON bets.predictions (start) WHERE NOT close_checked;
