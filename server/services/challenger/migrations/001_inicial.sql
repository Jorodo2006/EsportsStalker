-- Historial de picks del motor de Challengers (server/sharpex-tenis/src/ledger.js). Es uno para todos (lo escribe el
-- administrador) y sólo se añade: cada registro lleva el hash del anterior, así que cambiar o borrar uno rompe la cadena
-- y GET /api/challenger/historial lo dice. Aquí, además, la base de datos no deja hacerlo.
CREATE TABLE challenger.historial (
  n        bigserial PRIMARY KEY,
  hash     text NOT NULL UNIQUE,
  prev     text NOT NULL UNIQUE, -- dos registros no pueden colgar del mismo: la cadena no se bifurca
  tipo     text NOT NULL CHECK (tipo IN ('pick', 'close', 'settle')),
  pick_id  text NOT NULL,
  registro text NOT NULL -- el registro tal cual (JSON): es lo que firma el hash, por eso no va en jsonb
);
CREATE INDEX historial_pick_idx ON challenger.historial (pick_id);

CREATE FUNCTION challenger.solo_anadir() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El historial de picks no se puede cambiar ni borrar: se corrige añadiendo un registro';
END $$;

CREATE TRIGGER historial_solo_anadir BEFORE UPDATE OR DELETE ON challenger.historial
  FOR EACH ROW EXECUTE FUNCTION challenger.solo_anadir();
CREATE TRIGGER historial_sin_vaciar BEFORE TRUNCATE ON challenger.historial
  FOR EACH STATEMENT EXECUTE FUNCTION challenger.solo_anadir();
