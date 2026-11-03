-- Deporte de cada apuesta (LoL o NBA) para separar las estadísticas; las combinadas que mezclan son 'mix'
ALTER TABLE bets.bets ADD COLUMN sport text NOT NULL DEFAULT 'lol' CHECK (sport IN ('lol', 'nba', 'mix'));
ALTER TABLE bets.bet_legs ADD COLUMN sport text NOT NULL DEFAULT 'lol' CHECK (sport IN ('lol', 'nba'));
