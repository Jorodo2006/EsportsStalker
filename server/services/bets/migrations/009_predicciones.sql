-- Registro de las recomendaciones del modelo (baloncesto y tenis), se apuesten o no, para medir si acierta: lo que dijo
-- (p, la probabilidad que enseña la app, y sus dos partes, la del modelo y la de la casa sin margen) frente a lo que pasó.
-- No es de ningún usuario: la recomendación es la misma para todos. Se guarda la última opinión antes de empezar el
-- partido (y la cuota de la primera vez, para ver hacia dónde se movió). El resolvedor de apuestas las cierra con el
-- mismo ref = { sport, match, key, out } que las apuestas.
CREATE TABLE IF NOT EXISTS bets.predictions (
  id bigserial PRIMARY KEY,
  sport text NOT NULL,
  match text NOT NULL,
  key text NOT NULL,
  out text NOT NULL,
  start timestamptz,
  grp text NOT NULL,          -- mercado para agrupar: "Puntos", "Total del partido", "Ganador"…
  title text NOT NULL,
  event text NOT NULL DEFAULT '',
  league text NOT NULL DEFAULT '',
  book text NOT NULL DEFAULT '',
  price numeric NOT NULL,
  first_price numeric NOT NULL,
  p numeric NOT NULL,
  p_model numeric,
  p_market numeric,
  ev numeric NOT NULL,
  rel integer,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending', -- pending | won | lost | void | unknown (no se pudo resolver sola)
  result text,
  settled_at timestamptz,
  UNIQUE (match, key, out)
);
CREATE INDEX IF NOT EXISTS predictions_pending_idx ON bets.predictions (start) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS predictions_settled_idx ON bets.predictions (start DESC) WHERE status <> 'pending';
