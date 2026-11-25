-- Avisos de noticias (alerts.fromNews): un jugador de una apuesta pendiente o de un favorito no juega, duda, está lesionado,
-- sancionado o vuelve, según una noticia que se acaba de ver (shared/news.js)
ALTER TABLE bets.alerts DROP CONSTRAINT IF EXISTS alerts_kind_check;
ALTER TABLE bets.alerts ADD CONSTRAINT alerts_kind_check CHECK (kind IN ('drop', 'rise', 'value', 'news'));
