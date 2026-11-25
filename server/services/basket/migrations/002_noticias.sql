-- Noticias de baloncesto (news.js): de ESPN y de RSS de prensa, unidas a los equipos de los próximos partidos.
-- seen_at: cuándo la vio Sharpex por primera vez (para saber cuánto nos adelantamos a la cuota)
CREATE TABLE basket.news (
  id        text PRIMARY KEY,
  source    text NOT NULL,
  url       text NOT NULL,
  title     text NOT NULL,
  summary   text NOT NULL DEFAULT '',
  published timestamptz NOT NULL,
  seen_at   timestamptz NOT NULL DEFAULT now(),
  teams     text[] NOT NULL DEFAULT '{}',
  players   text[] NOT NULL DEFAULT '{}',
  tags      text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX news_teams_idx ON basket.news USING gin (teams);
CREATE INDEX news_published_idx ON basket.news (published);
