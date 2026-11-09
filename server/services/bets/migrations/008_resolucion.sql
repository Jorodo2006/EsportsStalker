-- Resolución automática: a qué partido y mercado pertenece cada apuesta simple y cada selección de una combinada.
-- ref = { sport, match, start, key, out } con la clave del comparador de cuotas ("total|0||212.5", "player|Asistencias|naji marshall|2.5")
-- y la selección ("over", "a", "x"…). Al resolverse se le añade settled = { at, text } con lo que pasó en el partido.
-- Sin ref (apuestas a mano o de antes) se intenta reconocer por el texto; si no, se resuelven a mano como siempre.
ALTER TABLE bets.bets ADD COLUMN IF NOT EXISTS ref jsonb;
ALTER TABLE bets.bet_legs ADD COLUMN IF NOT EXISTS ref jsonb;
-- El resolvedor busca las pendientes con partido: que no tenga que recorrer todas
CREATE INDEX IF NOT EXISTS bets_pending_idx ON bets.bets (status) WHERE status = 'pending';
