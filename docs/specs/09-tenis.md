# 09 · Tenis

La tercera app (acento verde). Funciona igual que el baloncesto: *Partidos*, *Jugadores* (rankings) y *Apuestas*
(con `sport: 'tennis'`), la cartera común y el cupón.

Código: `server/services/tennis/index.js` (datos), `src/views/TennisMatches.tsx` y `src/views/TennisPlayers.tsx`
(pantallas). Las cuotas usan el lector (`SPORT_CFG.tennis` en `server/lector/runner.js`), el normalizador por periodos
de `server/services/odds/odds.js` y el comparador `SportOdds` (`src/components/BasketOdds.tsx`).

## Datos (servicio `tennis`, puerto 4005, esquema `tennis`)

API pública de ESPN (`sports/tennis/atp` y `wta`). El marcador trae todos los partidos individuales de los torneos en
juego. Se filtran por **día de España**, se traducen ronda y estado ("1.ª ronda", "2.º set") y se cruzan con el ranking.
Cada jugador lleva `alt` con los nombres que usan las casas ("Sinner", "J. Sinner", "Sinner J").

| Ruta | IPC | Qué devuelve |
|---|---|---|
| `GET /api/tennis/games?date=` | `tennis:games` | Partidos de ATP y WTA de ese día (`id` = `atp:123`): sets, tie-breaks, cabeza de serie, ranking, pista |
| `GET /api/tennis/days?from=&n=` | `tennis:days` | Partidos y partidos en juego por día, para la tira de días |
| `GET /api/tennis/live` | `tennis:live` | Partidos en juego (aviso rojo del selector) |
| `GET /api/tennis/rankings/:tour` | `tennis:rankings` | Ranking ATP o WTA (puesto, anterior, puntos) |
| `GET /api/tennis/player/:tour/:id` | `tennis:player` | Partidos del jugador en los torneos de los últimos días |

## Cuotas

- Winamax: deporte 5; si el partido no está en la portada, se buscan los torneos por la palabra más larga del nombre del
  torneo. Betway: `sports/cat/tennis`.
- Normalizador: ganador, hándicap de juegos, total de juegos y juegos de cada jugador, del partido y de cada set
  (periodos 21-25). "Ganará un set", el hándicap de sets y "Victoria y total de juegos" no se confunden con ellos: van
  como mercados propios.
- Lecturas programadas: sólo los partidos del cuadro final (no la previa) que empiezan en las próximas 3 horas, porque
  hay decenas al día.

## Interfaz

- *Partidos*: tira de días, filtro por estado, interruptores *Previa* (oculta la previa por defecto) y *Cuotas*,
  partidos agrupados por torneo (los Grand Slam primero). La ficha tiene marcador grande (sets ganados) y las pestañas
  *Marcador* (set a set con tie-breaks), *Cuotas* y *Forma de los jugadores* (ranking y últimos partidos).
- *Jugadores*: rankings de la ATP y la WTA con buscador por nombre o país y la subida o bajada de cada jugador.

## Pendiente

- No hay modelo de valor para el tenis (habría que estimar la probabilidad de ganar con el ranking o un Elo).
- Dobles: no se muestran.
