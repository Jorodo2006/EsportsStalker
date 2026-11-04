# 08 · Baloncesto

La segunda app: se elige arriba con el selector **League of Legends | Baloncesto** (acento naranja). Tiene sus
propias secciones *Partidos*, *Jugadores* y *Apuestas* (las apuestas con `sport: 'basket'`). Empezó como una
adaptación de *courtside-edge* (app de un amigo de Jordi, sólo NBA) y ahora cubre varias ligas.

Código: `server/services/basket/` (datos), `server/lector/runner.js` (`BASKET_BOOKS`, cuotas),
`server/services/odds/odds.js` (`winamaxBasketInto`, normalizador), `src/views/BasketMatches.tsx` y
`src/views/BasketPlayers.tsx` (pantallas), `src/components/BasketAnalyzer.tsx` y `src/components/BasketOdds.tsx`,
`src/lib/basket-model.ts` (modelo), `src/lib/value.ts` y `src/components/ValuePanel.tsx` (valor, fiabilidad y
veredicto, comunes con LoL).

## Datos (servicio `basket`, puerto 4004, esquema `basket`)

| Liga | Fuente | Qué hay |
|---|---|---|
| NBA, WNBA | API pública de ESPN | Partidos, plantillas, bajas (NBA), buscador, partidos de cada jugador |
| Euroliga (`E`), EuroCup (`U`) | API pública de la Euroliga (`api-live.euroleague.net`) | Calendario de la temporada, plantillas y box score de cada partido; los partidos de un jugador se montan con los box scores de su equipo (esta temporada y la anterior) |

La ACB no tiene fuente gratis conocida. La NCAA está en ESPN, pero tiene cientos de partidos al día y no se ha metido.
Sofascore bloquea las peticiones automáticas y no se usa.

Los días van en **hora de España**: un partido de la NBA a la 01:30 cuenta en el día siguiente (se piden a ESPN los
días de EE. UU. que tocan y se filtra por hora). Caché en memoria y en `basket.cache`; los box scores terminados no se
vuelven a pedir.

| Ruta | IPC | Qué devuelve |
|---|---|---|
| `GET /api/basket/leagues` | `basket:leagues` | Ligas con nombre, país y logo |
| `GET /api/basket/games?date=` | `basket:games` | Partidos de todas las ligas de un día de España (`id` = `liga:id`) |
| `GET /api/basket/days?from=&n=` | `basket:days` | Partidos y partidos en juego por día, para la tira de días |
| `GET /api/basket/live` | `basket:live` | Partidos en juego (aviso rojo del selector) |
| `GET /api/basket/roster/:league/:team` | `basket:roster` | Plantilla |
| `GET /api/basket/injuries` | `basket:injuries` | Bajas de la NBA |
| `GET /api/basket/boxscore/:id` | `basket:boxscore` | Estadísticas del partido: puntos por cuarto, jugadores, totales y enfrentamientos de la temporada |
| `GET /api/basket/search?q=` | `basket:search` | Jugadores de NBA, Euroliga y EuroCup |
| `GET /api/basket/gamelog/:league/:id?team=` | `basket:gamelog` | Partidos del jugador (en la Euroliga hace falta su equipo) |

## Cuotas

- El partido se guarda como **visitante (a) contra local (b)** con los nombres de la fuente y `alt` con los demás
  (la Euroliga da "Real" y las casas dicen "Real Madrid" o "R. Madrid"). Ver `matchOfGame` en `BasketOdds.tsx`.
- El lector busca en Winamax en el estado de la portada de baloncesto (deporte 2) y, si no está, en los torneos de la
  liga por su socket; en Betway, en la lista de la liga (`grp/basketball/usa/nba`, `international-club/euroleague`…).
  En Betway se leen todas las pestañas del partido (principales, mitades, cuartos, jugadores).
- Normalizador: ganador, hándicap, total y puntos de cada equipo, del partido (periodo 0), de cada mitad (1-2) y de cada
  cuarto (11-14). Las líneas de jugador van con la clave `player|<estadística>|<jugador>|<línea>`, con los nombres de
  `BASKET_MARKETS` (Puntos, Rebotes, Asistencias, Triples anotados, Pts + Reb + Ast…). El resto va como mercado propio.
- Lecturas programadas: el programador de `odds` también crea trabajos para los partidos de baloncesto que empiezan en
  las próximas N horas.

## Modelo (`src/lib/basket-model.ts`)

- Mercados: PTS, REB, AST, 3PM, PRA, P+R, P+A, R+A, STL, BLK, S+B, TOV.
- Proyección: media ponderada (vida media de 10 partidos; esta temporada ×1,6, playoffs ×0,85, pretemporada fuera
  salvo que no haya otra cosa). Mitad media directa, mitad ritmo por minuto × minutos previstos (60 % últimos 5, 40 %
  media). Ajuste en casa / fuera (±6 %) y contra el rival (±10 %), encogidos hacia 1 según la muestra.
- Probabilidad: binomial negativa (o Poisson) si la media es menor de 12; normal con corrección de continuidad si no.
  Se mezcla con la frecuencia ponderada de superar la línea (el modelo cuenta como 10 partidos).
- Fiabilidad: muestra de esta temporada (25), historial (15), regularidad (20), minutos estables (15), margen sobre la
  línea (15), modelo frente a histórico (10). Resta 20 si está lesionado o en duda, 8 si cambió de rol (minutos ±18 %)
  y 15 si la muestra tiene pretemporada.
- ESPN numera la temporada por el año en que acaba (2027 = 26-27) y la Euroliga por el año en que empieza (2026 = 26-27).

## Valor común con LoL (`src/lib/value.ts`)

- `devig`: con las dos cuotas quita el margen exacto; con una, lo estima (7 %).
- `sideValue`: EV = p × cuota + nula − 1; ventaja = probabilidad estimada − probabilidad de la casa sin margen;
  stake = ¼ de Kelly con un tope del 3 % del bank.
- `reliability`: suma los factores de cada deporte, reescala a 100 y resta las penalizaciones.
- `verdict`: *Apostar* (EV ≥ 4 %, ventaja ≥ 3 %, fiabilidad ≥ 55), *Valor ligero* (EV ≥ 1,5 %, fiabilidad ≥ 45) o
  *No apostar*.

## Interfaz

- *Partidos* (`BasketMatches`): igual que en LoL. Tira de días con el número de partidos, filtro En juego / Próximos /
  Terminados, interruptor de cuotas de ganador y partidos agrupados por competición (se pueden plegar). Al pulsar un
  partido se abre su ficha a página completa (*Volver a partidos* para salir): marcador grande, botón *Apuesta* y
  pestañas *Estadísticas*, *Cuotas* (si no ha terminado), *Plantillas* y *Valor de jugador*.
- *Estadísticas* (`GET /api/basket/boxscore/:id`, se refresca cada 20 s en juego): puntos por cuarto, comparación de
  equipo (tiros, rebotes, asistencias, robos, tapones, pérdidas), tabla de cada equipo con titulares (pulsar un jugador
  abre su valor) y enfrentamientos de la temporada.
- *Cuotas* (`BasketOdds`): estado de cada casa, botón *Actualizar cuotas* y mercados por Partido / Jugadores /
  Mitades / Cuartos / Otros. En hándicaps y totales salen primero las tres líneas más igualadas. Clic: apuesta; clic
  derecho: combinada.
- *Valor de jugador* (`BasketAnalyzer`): si las casas tienen líneas de ese jugador y mercado, se rellenan solas (la más
  igualada) y salen como botones. Si no, se propone la proyección redondeada a x,5 y las cuotas se ponen a mano.
- *Jugadores* (`BasketPlayers`): buscador de las tres ligas y el mismo analizador.

## Pendiente

- Flechas de subida y bajada de las cuotas (el histórico ya se guarda en `odds.price_history`; falta la ruta).
- Clasificaciones por liga.
- No ajusta por bajas de compañeros, partidos seguidos, ritmo del rival ni defensa por posición.

## Equipos

*Jugadores → Equipos*: clasificación de cada liga, y al pulsar un equipo su ficha (`src/components/BasketTeamSheet.tsx`).
La ficha de un partido tiene además la pestaña *Equipos*, con los dos frente a frente.

| Ruta | IPC | Qué devuelve |
|---|---|---|
| `GET /api/basket/standings/:league` | `basket:standings` | Grupos con cada equipo: puesto, balance, casa, fuera, últimos 10, racha y puntos por partido |
| `GET /api/basket/team/:league/:team` | `basket:team` | Clasificación, estadísticas, líderes, resultados, próximos partidos y plantilla con bajas |

- **NBA y WNBA** (ESPN): los promedios de la plantilla salen de los líderes del equipo; la NBA añade salarios y bajas.
  Las estadísticas se piden con `seasontype=2`, porque fuera de temporada ESPN daría sólo las del playoff.
- **Euroliga y EuroCup** (API de la Euroliga): la clasificación se pide por jornada y la jornada en curso puede dar 404, así
  que se usa la última que responda. Añaden aforo, ciudad, país y presidente; la API no da bajas.
