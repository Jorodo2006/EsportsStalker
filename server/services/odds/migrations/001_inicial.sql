-- Partidos abiertos en la app o programados (sirven para saber a qué partido van las cuotas recibidas)
CREATE TABLE odds.matches (
  key     text PRIMARY KEY,               -- "Equipo A|Equipo B" con los nombres de lolesports
  a       jsonb NOT NULL,
  b       jsonb NOT NULL,
  start   timestamptz,
  seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matches_seen_idx ON odds.matches (seen_at DESC);

-- Lo que manda el lector (marcador o extensión), tal cual. Vale 3 horas; luego se borra.
CREATE TABLE odds.imports (
  id        bigserial PRIMARY KEY,
  match_key text,
  book      text NOT NULL CHECK (book IN ('bet365', 'winamax', 'betway')),
  page      text,
  map       int NOT NULL DEFAULT 1,
  payload   jsonb NOT NULL,
  ml        jsonb,                         -- cuota de ganador { a, b } para las tarjetas del calendario
  ts        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX imports_match_idx ON odds.imports (match_key, ts DESC);

-- Histórico de cuotas: una fila cada vez que cambia una cuota de una casa
CREATE TABLE odds.price_history (
  id         bigserial PRIMARY KEY,
  match_key  text NOT NULL,
  book       text NOT NULL,
  market_key text NOT NULL,
  market     text NOT NULL,
  outcome_id text NOT NULL,
  outcome    text NOT NULL,
  line       double precision,
  price      double precision NOT NULL,
  ts         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_history_idx ON odds.price_history (match_key, book, market_key, outcome_id, ts DESC);

-- Trabajos de lectura de la extensión: los del botón "Actualizar cuotas" (manual) y los programados (auto)
CREATE TABLE odds.jobs (
  id        text PRIMARY KEY,
  match_key text NOT NULL,
  match     jsonb NOT NULL,
  source    text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  books     text[] NOT NULL,
  steps     jsonb NOT NULL,
  created   timestamptz NOT NULL DEFAULT now(),
  picked_at timestamptz,
  done_at   timestamptz,
  error     text
);
CREATE INDEX jobs_match_idx ON odds.jobs (match_key, created DESC);
CREATE INDEX jobs_open_idx ON odds.jobs (created) WHERE done_at IS NULL;

-- Dirección de cada partido en cada casa (antes casas-urls.json), para ir directo la próxima vez
CREATE TABLE odds.book_urls (
  match_key  text NOT NULL,
  book       text NOT NULL,
  url        text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_key, book)
);
