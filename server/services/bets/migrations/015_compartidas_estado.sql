-- Apuestas pasadas a un amigo: de qué apuesta salió cada copia, para enseñar su estado de ahora (ganada, perdida, pendiente…) y
-- no dejar copiar una ya resuelta (friends.js). Si quien la pasó la borra, se queda en NULL y se enseña sin estado.
ALTER TABLE bets.shared_bets ADD COLUMN IF NOT EXISTS bet_id text REFERENCES bets.bets (id) ON DELETE SET NULL;

-- Las pasadas antes de esta migración: la apuesta de quien la envió con el mismo partido, mercado, selección y fecha, sólo si
-- hay una. Si hay varias iguales o ninguna, se queda sin estado (como hasta ahora: se puede copiar)
UPDATE bets.shared_bets s SET bet_id = m.id
FROM (
  SELECT s2.id AS share_id, min(b.id) AS id
  FROM bets.shared_bets s2
  JOIN bets.bets b ON b.user_id = s2.from_user AND b.event = s2.bet->>'event' AND b.market = s2.bet->>'market'
    AND b.selection = s2.bet->>'selection' AND b.date::text = s2.bet->>'date'
  WHERE s2.bet_id IS NULL
  GROUP BY s2.id
  HAVING count(*) = 1
) m
WHERE s.id = m.share_id;
