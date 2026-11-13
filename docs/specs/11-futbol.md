# 11 · Fútbol

Cuarta app, con el acento azul (`data-app="football"`). Como baloncesto y tenis: partidos por día con el directo, la ficha
de cada partido y el registro de apuestas (`sport = 'football'`, migración `bets/007_futbol.sql`).

## Datos: ESPN

El servicio `football` (`server/services/football/index.js`, puerto 4006, esquema `football`) lee la API pública de ESPN,
gratuita y sin clave, la misma que usan la NBA y el tenis.

| Competición | Id de la app | Id de ESPN |
|---|---|---|
| LaLiga | `laliga` | `esp.1` |
| Champions League | `champions` | `uefa.champions` |
| Premier League | `premier` | `eng.1` |
| Serie A | `seriea` | `ita.1` |
| Bundesliga | `bundesliga` | `ger.1` |
| Ligue 1 | `ligue1` | `fra.1` |
| Europa League | `europa` | `uefa.europa` |
| Conference League | `conference` | `uefa.europa.conf` |
| Segunda División | `segunda` | `esp.2` |
| Copa del Rey | `copa` | `esp.copa_del_rey` |
| Nations League | `nations` | `uefa.nations` |
| Amistosos internacionales | `amistosos` | `fifa.friendly` |
| Champions League Femenina | `wchampions` | `uefa.wchampions` |
| Liga F | `ligaf` | `esp.w.1` |
| Women's Super League | `wsl` | `eng.w.1` |

El orden de la tabla es el de la lista de partidos. Para añadir una liga basta con una fila en `LEAGUES` (servicio), en
`FootballLeagueId` (`src/lib/types.ts`) y, si tiene tabla, en `src/views/FootballStandings.tsx`.

- **Marcadores**: `scoreboard?dates=AAAAMMDD` da un día; `dates=AAAAMM`, el mes entero de una liga en una sola
  petición. Cerca de hoy (de ayer a mañana) se pide cada día con 30 s de caché, para el directo; lejos, el mes (15 min,
  o 6 h si ya pasó). Así la tira de días cuesta 10 peticiones y no 80. Un rango `AAAAMMDD-AAAAMMDD` devuelve 400.
- **Días en hora de España**: como en baloncesto y tenis, se pide también el día anterior de ESPN y se filtra por el día
  de Madrid.
- **Ficha** (`summary?event=`): `keyEvents` (goles con asistencia, penaltis, en propia, tarjetas y cambios con quién sale),
  `boxscore` (posesión, tiros, córners, faltas, tarjetas, pases…), `rosters` (formación, once, banquillo, cambios),
  `lastFiveGames` y `headToHeadGames`. ESPN da el marcador de los partidos anteriores sin decir de quién es cada número: se
  ordena según el resultado (G, E o P) para que vayan primero los goles del equipo.
- **Clasificaciones** (`/apis/v2/sports/soccer/<liga>/standings`): con las zonas (Champions, descenso…) y su color. Las
  competiciones europeas tienen una sola tabla, la fase de liga; la Copa no tiene.
- **Colores de los equipos**: ESPN los da en cada partido; la interfaz los pasa por `teamTheme` (`src/lib/team-colors.ts`),
  igual que los de baloncesto, para teñir cada mitad del marcador grande y las barras de estadísticas.
- **Cuotas de ESPN**: la ficha trae cuotas de casas americanas. No se usan: las cuotas sólo salen del lector (regla 1).

## Rutas

| Ruta | Qué devuelve |
|---|---|
| `GET /api/football/leagues` | Las competiciones con su escudo |
| `GET /api/football/games?date=` | Partidos de un día de España |
| `GET /api/football/days?from=&n=` | Partidos y en juego por día, para la tira |
| `GET /api/football/live` | Partidos en juego |
| `GET /api/football/match?id=<liga>:<evento>` | Ficha del partido |
| `GET /api/football/player-stats?match=<liga>:<evento>&team=&player=` | Estadísticas de un jugador en el partido (API core de ESPN: `sports.core.api.espn.com/…/competitors/<equipo>/roster/<jugador>/statistics/0`), `{ nombre: valor }`. La ficha (`summary`) sólo trae goles, tiros y tarjetas; la core trae entradas, intercepciones, regates, duelos, pases, xG y paradas. 404 si no jugó |
| `GET /api/football/standings/:league` | Clasificación (grupos y filas) |

## Interfaz

- `src/views/FootballMatches.tsx`: lista (en juego arriba, el resto por competición, con la cuota 1X2 en cada tarjeta y el
  interruptor Cuotas) y ficha del partido con el marcador grande, los goleadores y las rojas debajo, y las pestañas Resumen,
  Cuotas (hasta que acaba), Estadísticas, Alineaciones, Forma (últimos cinco y cara a cara) y Clasificación. Antes de
  empezar se abre en Forma. La ficha se carga por su id, así que también abre los partidos de otro día que llegan desde la
  columna de directo.
- Alineaciones: el campo entero con los dos onces (horizontal desde `lg`, vertical por debajo), colocados por la
  formación y la posición de ESPN (`linesOf`, `spotsOf`), con goles, tarjetas y minuto del cambio sacados del resumen.
  Campo verde con franjas (`PITCH_LINEUP`, `PitchLines bright`) y cada jugador un círculo relleno del color del equipo con
  el dorsal en blanco y borde blanco, sin fotos (se probaron fotos en el campo y no gustaron). Al pulsar un
  jugador (o un suplente que entró) se abre `PlayerStatsDialog`: cabecera con su foto (si la hay), las cifras principales,
  su mapa de tiros (`HalfPitchShots`) y Ataque, Regate y duelos, Defensa, Pase y, si es el portero, Portería (`STAT_GROUPS`).
- Mapas de tiros: los tiros salen del comentario de la ficha de ESPN (`commentary[].play`, con `fieldPositionX/Y` desde
  donde se tiró y `fieldPosition2X/Y` hasta donde llegó; x hacia la portería rival, y de 0 a 100 con lo bajo a la derecha
  del que tira) y van en `shots` del detalle. En Estadísticas, `MatchShotMap`: el campo entero, cada equipo en el lado de
  su nombre. Gol en el acento de la app, parado en blanco, fuera sólo el borde, bloqueado en gris; de cabeza, cuadrado.
  Entran con una animación (`shot-line`, `shot-mark` en `src/index.css`), que se quita con "reducir movimiento".
- Fotos de jugadores (`server/services/football/photos.js`, `GET /api/football/photo?id=&name=&team=`): como en el tenis,
  ESPN y si no, la de su artículo de Wikipedia, buscando con el equipo para desempatar nombres repetidos ("Bremer"). De una en
  una y guardadas en `football.cache` (60 días; el resto de la caché, 7). Muchos jugadores no tienen foto libre: entonces
  sale el dorsal. Para pedir las de una alineación entera (ahora no se usa), `POST /api/football/photos`: devuelve al momento
  las que ya tiene y `null` en las que faltan, que busca por detrás; la interfaz vuelve a preguntar cada 3 s mientras falte
  alguna. Si Wikipedia responde 429, su cola se para 2 minutos (reintentar enseguida sólo alarga el corte).
- `src/views/FootballStandings.tsx`: la segunda sección de la app ("Clasificación" en vez de "Jugadores").
- `src/components/football.tsx`: el balón del selector, `themeOf`, `esTime` y la tabla de clasificación.

## H2H y "cuántas veces se cumple"

Pestaña *H2H* de la ficha (`FootballTrends`, tabla común en `src/components/Trends.tsx`, la misma que en baloncesto):
1X2, más de 1,5 / 2,5 / 3,5 goles, ambos marcan y si marca cada uno, con cuántas veces se ha cumplido en los cara a cara
y en los últimos 10 de cada equipo (todas las competiciones) frente a la probabilidad sin margen de las casas. Los partidos
de cada equipo salen de `GET /api/football/team-games/:equipo` (calendario de ESPN de todas las competiciones, esta
temporada y la anterior). Los cara a cara, de la ficha (`headToHeadGames`) y, como a menudo viene vacía, también de esos
partidos (los del local contra el visitante).

## Cuotas (Winamax y Betway)

Como en baloncesto y tenis: las lee el lector de Docker, se comparan en la pestaña Cuotas (`SportOdds`) y van al cupón.

- **El partido** (`targetOfFootball`): local (a) contra visitante (b), con el nombre de ESPN, que es la clave del partido
  (`a|b`) en el esquema `odds`; tiene que ser igual en la interfaz y en el programador. Los otros nombres (`alt`) son los
  `alts` de ESPN sin la abreviatura ("VAL" está dentro de "Valladolid") y, en los filiales, la versión con B: ESPN dice
  "Real Sociedad II" y las dos casas "Real Sociedad B".
- **Lector** (`SPORT_CFG.football` en `server/lector/runner.js`): en Winamax, deporte 1 y el torneo por su nombre
  (`FOOTBALL_TOURS`; ojo, "LaLiga " lleva un espacio al final y hay "Serie A" y "Bundesliga" de otros países); en Betway, la
  lista de cada liga (`FOOTBALL_LISTS`, `grp/soccer/spain/la-liga`…). En Betway se saltan las pestañas "Crea tu apuesta",
  "Tiempo completo" y "1er Tiempo", que repiten mercados de otras.
- **El 1-X-2 de Betway** va arriba sin cabecera: el marcador (`marcador.js`) lo reconoce por tener tres selecciones con
  "Empate" y lo titula "1-X-2".
- **Normalizador** (`winamaxFootballInto` y `betwayFootballInto` en `server/services/odds/odds.js`): a filas comunes van
  1X2 (`moneyline`, con `x` para el empate), doble oportunidad (`double`: `1x`, `12`, `x2`), empate no válido (`dnb`), ambos
  marcan (`btts`), hándicap asiático (`spread`, referido al local), total de goles (`total`), goles de cada equipo
  (`team_total`), córners (`corners`) y tarjetas (`cards`), del partido (periodo 0) o de la 1.ª mitad (1). El periodo sale
  sólo del título ("1ª mitad - …", "1º Mitad - …"), nunca de la pestaña: la "1er Tiempo" de Betway enseña los del partido.
  Lo demás (resultado exacto, hándicap a 3 formas, multigoles…) sale como mercado de cada casa en Otros; goleadores,
  asistentes, remates y faltas, en Jugadores. Los "Trío/Dúo goleadores" de Winamax no se guardan: son decenas.
- **Tarjetas**: la cuota de ganador de cada lectura guarda también el empate (`ml.x` en `odds.imports`), y `MatchCard`
  enseña tres fichas cuando lo hay.
- **Lecturas programadas** (`upcomingFootball` en `scheduler.js`): como el tenis, porque hay decenas de partidos los fines
  de semana: de cerca sólo las últimas 3 horas y de lejos cada 3 horas, hasta 24 horas antes. Sin los aplazados.
- Los partidos pequeños (Copa contra equipos de Segunda RFEF, Segunda días antes) pueden tener sólo uno o dos mercados en
  Winamax, o no estar todavía en Betway: es lo que ofrecen las casas, no un fallo del lector.

## Modelo y recomendaciones

Como en tenis: el modelo está en el servicio y la interfaz sólo enseña lo que devuelve.

- **Resultados** (`server/services/football/history.js`): el marcador de ESPN mes a mes de cada competición, 18 meses. Un
  mes pasado se guarda para siempre en `football.cache` (`hist:<liga>:<AAAAMM>`, la limpieza de 7 días no lo toca); el mes en
  curso se pide cada media hora. Tres grupos que no se mezclan: hombres (las diez competiciones de clubes), mujeres
  (Champions Femenina, Liga F y WSL) y selecciones (Nations League y amistosos, más Mundial y clasificación sólo como
  datos). Con prórroga, el partido cuenta como el empate de los 90 minutos.
- **Modelo** (`model.js`): Poisson con ataque y defensa de cada equipo, el nivel de goles de cada liga y la ventaja de
  jugar en casa (nada en campo neutral), ajustado por máxima verosimilitud con los partidos recientes pesando más (vida
  media `halfLife`) y cada equipo tirado hacia la media (`reg`). Los que sólo salen en la Copa (categorías que no se
  siguen) parten de peor. Corrección de Dixon y Coles para los marcadores cortos. La primera parte es el 45 % de los goles.
  Se reajusta cada 3 horas.
- **Comprobación** (`backtest.js`, dentro del contenedor: `docker compose exec football node services/football/backtest.js men 2026-02-01`):
  cada semana se ajusta sólo con lo anterior. Parámetros elegidos con sep. 2025-ene. 2026 (`rejilla`) y comprobados con
  feb.-nov. 2026:

  | Grupo | Partidos | 1X2 log-loss | Sin mirar equipos | Más/menos 2,5 (azar 0,693) |
  |---|---|---|---|---|
  | Hombres | 1.801 | 0,994 | 1,061 | 0,674 |
  | Mujeres | 511 | 0,866 | 1,054 | 0,684 |
  | Selecciones | 464 | 0,909 | 1,075 | 0,675 |

  En hombres, el 1X2 sale bien calibrado (45 % → 47 %, 64 % → 74 % arriba: algo corto con los favoritos claros) y los goles
  medios cuadran (2,78 esperados, 2,91 reales). En selecciones sobrevalora a las débiles (26 % → 9 %): se avisa y se fía
  menos. Los goles se predicen mucho peor que el ganador, como en cualquier modelo público.
- **Recomendaciones** (`picks.js`, `GET /api/football/picks?date=&id=` y `/api/football/picks/day?date=`): como las de
  tenis. Mercados: 1X2, doble oportunidad, empate no válido, ambos marcan, total de goles, goles de cada equipo y hándicap
  asiático, del partido y de la 1.ª parte; sólo líneas x,5 (las enteras y las de cuarto pueden devolverse). El modelo pesa
  un 25 % frente a las casas sin margen (10 % si un equipo tiene pocos partidos) y menos cuanto más se aleja de ellas en
  el 1X2. Salen la más fiable, tres fáciles y tres complicadas. Se registran en `bets.predictions` (Acierto del modelo).
- **Interfaz** (`src/components/FootballPicks.tsx`): pestaña Recomendaciones en la ficha (se abre en ella antes de empezar),
  pantalla *Recomendaciones* con el selector *Partidos / Recomendaciones* de arriba (`FootballPicksPage`: hoy, mañana o pasado,
  la más fiable de cada partido y las más complicadas; al pulsar una se abre su partido en esa pestaña) y, en pantallas
  anchas, "Recomendaciones del día" al lado de la lista. Encima de la lista no: primero los partidos.

## Femenino

Champions Femenina, Liga F y WSL, con `women: true` en `LEAGUES`. En Winamax llevan "(F)" ("Champions League (F)"); la Liga F
y la WSL no estaban cuando se miró (parón) y sus nombres en `FOOTBALL_TOURS` son los más probables: si no encuentra un
partido, mira el nombre en Winamax. Betway no tiene una lista que se haya podido ver: se busca en la portada de fútbol.

## Selecciones (Nations League y amistosos)

En los parones salen la **Nations League** (`uefa.nations`) y los **amistosos internacionales** (`fifa.friendly`), con
`national: true` en `LEAGUES` (`server/services/football/index.js`). Cuando no hay, sus listas salen vacías.

- **Nombres en español**: las listas y la clasificación se piden a ESPN con `lang=es`. La ficha del partido no, porque con
  `lang=es` también se traducen los tipos de jugada ("Gol", "Tiro de esquina") y dejarían de reconocerse los tiros: se
  pide en inglés y `spanishNames` cambia los nombres de las selecciones por los del marcador en español de ese día.
- **`NATIONAL`**: las selecciones que ESPN deja en inglés aunque se pida en español ("North Macedonia", "Kenya") y otros
  nombres con que las llaman las casas ("República Checa" para Chequia, "Holanda", "Taiwán"…). Van a `alts`, con los que
  se emparejan los partidos en Winamax y Betway. Si una selección no sale en las cuotas, mira cómo la llama la casa y
  añádela aquí.
- **Casas**: Winamax "Nations League" (hay otra "Nations League " con espacio en MultiFútbol, que son combinadas, y no
  la coge el `^…$`) y "Partidos amistosos internacionales"; Betway `uefa-international-competitions/uefa-nations-league` y
  `international/friendlies` (`FOOTBALL_TOURS` y `FOOTBALL_LISTS` en `server/lector/runner.js`). Probado con Chequia-España:
  320 mercados en Winamax y todas las pestañas en Betway.
- **Lecturas programadas**: los amistosos sólo si juega una selección grande (`BIG_NATIONS` en `scheduler.js`): en un
  parón hay decenas y la mayoría no los tienen las casas. Los demás, a mano desde su pestaña de cuotas.
