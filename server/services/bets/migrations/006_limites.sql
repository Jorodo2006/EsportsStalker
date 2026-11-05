-- Límites de las apuestas, los mismos que valida la aplicación (normalizeBet). NOT VALID: no se comprueban las filas
-- que ya existían (podrían tener datos antiguos fuera de rango), pero sí toda inserción y modificación nueva.
ALTER TABLE bets.bets
  ADD CONSTRAINT bets_stake_range   CHECK (stake >= 0 AND stake <= 1000000) NOT VALID,
  ADD CONSTRAINT bets_cashout_range CHECK (cashout >= 0 AND cashout <= 1000000) NOT VALID,
  ADD CONSTRAINT bets_odds_range    CHECK (odds = 0 OR (odds >= 1 AND odds <= 1000)) NOT VALID,
  ADD CONSTRAINT bets_text_len      CHECK (char_length(league) <= 120 AND char_length(market) <= 120 AND char_length(bookmaker) <= 60
                                           AND char_length(notes) <= 2000) NOT VALID;
ALTER TABLE bets.bet_legs
  ADD CONSTRAINT bet_legs_odds_range CHECK (odds = 0 OR (odds >= 1 AND odds <= 1000)) NOT VALID;
