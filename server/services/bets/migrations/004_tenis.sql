-- Tercera app: tenis ('tennis'); las combinadas que mezclan deportes siguen siendo 'mix'
ALTER TABLE bets.bets DROP CONSTRAINT IF EXISTS bets_sport_check;
ALTER TABLE bets.bet_legs DROP CONSTRAINT IF EXISTS bet_legs_sport_check;
ALTER TABLE bets.bets ADD CONSTRAINT bets_sport_check CHECK (sport IN ('lol', 'basket', 'tennis', 'mix'));
ALTER TABLE bets.bet_legs ADD CONSTRAINT bet_legs_sport_check CHECK (sport IN ('lol', 'basket', 'tennis'));
