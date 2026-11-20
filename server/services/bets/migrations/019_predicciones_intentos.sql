-- Recomendaciones del modelo: cuándo se intentó resolver cada una por última vez sin conseguirlo. El resolvedor cogía siempre las
-- 800 pendientes más antiguas; si no se podían resolver todavía (un resultado que no llega, la línea de un jugador que no jugó), eran
-- las mismas en cada pasada y tapaban a todas las demás hasta darlas por perdidas a los 4 días. Con tried_at, las ya intentadas
-- esperan su turno detrás de las nuevas (predictions.settle)
ALTER TABLE bets.predictions ADD COLUMN IF NOT EXISTS tried_at timestamptz;
DROP INDEX IF EXISTS bets.predictions_pending_idx;
CREATE INDEX IF NOT EXISTS predictions_pending_idx ON bets.predictions (tried_at NULLS FIRST, start) WHERE status = 'pending';
