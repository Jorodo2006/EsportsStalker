-- Reajuste diario del modelo de baloncesto con los resultados (tuning.js): cuánto pesa el modelo frente a la casa en las líneas de
-- jugador (player) y en los totales y puntos de equipo (team). Cada día se guarda un intento, aplicado o no, con lo que dio en los
-- días de prueba (que no se usaron para ajustar): así se ve qué ha aprendido y por qué no cambió cuando no cambió
CREATE TABLE IF NOT EXISTS bets.model_tuning (
  id          bigserial PRIMARY KEY,
  day         date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('player', 'team')),
  prev_w      numeric NOT NULL,
  fit_w       numeric NOT NULL,
  w           numeric NOT NULL,
  applied     boolean NOT NULL,
  reason      text NOT NULL,
  n_fit       integer NOT NULL,
  n_test      integer NOT NULL,
  ll_prev     numeric,
  ll_new      numeric,
  ll_market   numeric,
  ll_model    numeric,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, kind)
);
