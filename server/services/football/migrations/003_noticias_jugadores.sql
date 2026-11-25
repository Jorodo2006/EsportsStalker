-- Los jugadores de los que habla cada noticia y cómo están (shared/news.js, playerStatuses): [{ name, team, status }],
-- status: out, doubt, injured, suspended o back
ALTER TABLE football.news ADD COLUMN outs jsonb NOT NULL DEFAULT '[]'::jsonb;
