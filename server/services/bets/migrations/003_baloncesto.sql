-- La sección NBA pasa a ser de baloncesto en general (NBA, Euroliga, EuroCup…): el deporte 'nba' se llama 'basket'
ALTER TABLE bets.bets DROP CONSTRAINT IF EXISTS bets_sport_check;
ALTER TABLE bets.bet_legs DROP CONSTRAINT IF EXISTS bet_legs_sport_check;
UPDATE bets.bets SET sport = 'basket' WHERE sport = 'nba';
UPDATE bets.bet_legs SET sport = 'basket' WHERE sport = 'nba';
ALTER TABLE bets.bets ADD CONSTRAINT bets_sport_check CHECK (sport IN ('lol', 'basket', 'mix'));
ALTER TABLE bets.bet_legs ADD CONSTRAINT bet_legs_sport_check CHECK (sport IN ('lol', 'basket'));
