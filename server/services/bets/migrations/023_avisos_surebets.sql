-- Avisos de surebets (alerts.fromSurebets): odds encuentra un mercado en el que Winamax y Betway juntas pagan más de lo apostado
ALTER TABLE bets.alerts DROP CONSTRAINT IF EXISTS alerts_kind_check;
ALTER TABLE bets.alerts ADD CONSTRAINT alerts_kind_check CHECK (kind IN ('drop', 'rise', 'value', 'news', 'sure'));
