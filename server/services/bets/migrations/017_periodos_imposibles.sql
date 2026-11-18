-- Baloncesto: líneas del partido entero que se guardaron como de una mitad o un cuarto ("1.er cuarto: menos de 188,5 puntos").
-- Betway devuelve la página del partido cuando se le pide una pestaña que el partido no tiene (en la NBL), y desde las lecturas
-- ligeras esa copia dejó de descartarse (isPeriodCopy en odds/odds.js, ya arreglado). Se resolvían con los puntos del periodo
-- ("ganada" con 56 puntos) y falseaban el acierto del modelo: se borran.
-- Mismo criterio que dropImpossiblePeriods (odds.js): el total de una mitad no pasa del 75 % del del partido, ni el de un cuarto
-- del 45 %; el de un equipo, del 42 % y el 30 %. En las predicciones guardadas lo más alto de verdad fue el 54 % (mitad) y el
-- 26 % (cuarto), y las copias, del 94 % para arriba. El total del partido es la mediana de las líneas guardadas del partido entero;
-- un partido sin ellas no se toca.
WITH full_total AS (
  SELECT match, percentile_cont(0.5) WITHIN GROUP (ORDER BY split_part(key, '|', 4)::numeric) AS m
  FROM bets.predictions
  WHERE sport = 'basket' AND key ~ '^total\|0\|\|[0-9.]+$'
  GROUP BY match
)
DELETE FROM bets.predictions p
USING full_total f
WHERE p.match = f.match AND p.sport = 'basket'
  AND p.key ~ '^(total|team_total)\|(1|2|11|12|13|14)\|[ab]?\|[0-9.]+$'
  AND split_part(p.key, '|', 4)::numeric > f.m * CASE
    WHEN p.key LIKE 'total|%' AND split_part(p.key, '|', 2) IN ('1', '2') THEN 0.75
    WHEN p.key LIKE 'total|%' THEN 0.45
    WHEN split_part(p.key, '|', 2) IN ('1', '2') THEN 0.42
    ELSE 0.3
  END;
