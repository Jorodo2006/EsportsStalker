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
| NBL (Australia) | API pública de ESPN (`basketball/nbl`) | Lo mismo que la WNBA salvo dos huecos que se rellenan en `espn.js`: el registro de cada jugador (ESPN lo da vacío) se monta con los box scores de su equipo (`boxLogs`), y a la clasificación le faltan casa, fuera y últimos 10, que se calculan con los resultados (`tableFromGames`, que también la da entera si ESPN no responde con nada). Los líderes y medias de la ficha de equipo salen de esos registros. La plantilla de ESPN no es de fiar (faltan fichajes, sobran los que se fueron y decenas que nunca han jugado): la plantilla es quien ha jugado con el equipo esta temporada según los box scores, con dorsal y posición de ESPN si los tiene (`squadFix`) |
| Euroliga (`E`), EuroCup (`U`) | API pública de la Euroliga (`api-live.euroleague.net`) | Calendario de la temporada, plantillas y box score de cada partido; los partidos de un jugador se montan con los box scores de su equipo (esta temporada y la anterior) |

**NBL**: ESPN sólo tiene jugadores en los box scores desde febrero de 2026 (el final de la 25-26 y su playoff); antes vienen
vacíos. El modelo ve por eso menos partidos que en la NBA, y la fiabilidad lo refleja. La numeración de la temporada es la de la
NBA (2027 = 26-27), los cuartos son de 10 minutos (`flow`, `gameMinutes` en `src/lib/basket-leagues.ts`) y tiene jugada a jugada
con coordenadas, como la NBA. No sale en la portada **Hoy** (nota 40, como la WNBA). El lector la busca en Winamax por el torneo
"NBL" y en Betway en `australia/nbl` (si esa lista no existe, en la de baloncesto).

La ACB no tiene fuente gratis conocida. La NCAA está en ESPN, pero tiene cientos de partidos al día y no se ha metido.
Sofascore bloquea las peticiones automáticas y no se usa.

Los días van en **hora de España**: un partido de la NBA a la 01:30 cuenta en el día siguiente (se piden a ESPN los
días de EE. UU. que tocan y se filtra por hora). Caché en memoria y en `basket.cache`; los box scores terminados no se
vuelven a pedir.

| Ruta | `window.api` | Qué devuelve |
|---|---|---|
| `GET /api/basket/leagues` | `basket:leagues` | Ligas con nombre, país y logo |
| `GET /api/basket/games?date=` | `basket:games` | Partidos de todas las ligas de un día de España (`id` = `liga:id`) |
| `GET /api/basket/days?from=&n=` | `basket:days` | Partidos y partidos en juego por día, para la tira de días |
| `GET /api/basket/live` | `basket:live` | Partidos en juego (aviso rojo del selector) |
| `GET /api/basket/roster/:league/:team` | `basket:roster` | Plantilla |
| `GET /api/basket/injuries` | `basket:injuries` | Bajas de la NBA |
| `GET /api/basket/boxscore/:id` | `basket:boxscore` | Estadísticas del partido: puntos por cuarto, jugadores, totales y enfrentamientos de la temporada |
| `GET /api/basket/players/search?q=` | `basket:search` | Jugadores de NBA, Euroliga, EuroCup y NBL (`/api/basket/search` es la del buscador de la cabecera) |
| `GET /api/basket/gamelog/:league/:id?team=` | `basket:gamelog` | Partidos del jugador (en la Euroliga hace falta su equipo) |
| `GET /api/basket/absences/:league/:id?team=` | `basket:absences` | Partidos recientes de su equipo que no jugó, con el motivo (sólo las ligas de ESPN: NBA, WNBA y NBL). El registro de ESPN se los salta; salen del boxscore de cada partido (`didNotPlay`), guardados para siempre en `keep:dnp:<liga>:<partido>`. En la gráfica del analizador van en gris, y un 0 jugando como barra roja corta. El boxscore del partido trae también `out` (los que no jugaron) |
| `GET /api/basket/schedule/:league/:team` | `basket:schedule` | Calendario del equipo esta temporada (para saber si un jugador vuelve de una baja). Sólo las ligas de ESPN (NBA, WNBA y NBL) |
| `GET /api/basket/rest/:id?home=&away=` | `basket:rest` | Descanso de los dos equipos antes del partido (`rest` en `espn.js`, del calendario del equipo en hora de Nueva York): noches libres (0 = B2B), partidos en las 4 últimas noches, partido anterior y si mañana vuelve a jugar. Sale bajo el marcador del partido y en el contexto del jugador |

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
- Ajustes medidos (`PROJ`, ver *Calibración de noviembre de 2026*): los partidos de la temporada pasada cuentan ×0,88 en la
  estadística y ×0,92 en los minutos; los minutos previstos por encima de 30 se acercan un 15 % a 30; la varianza ×1,2.
- Probabilidad: binomial negativa (o Poisson) si la media es menor de 12; normal con corrección de continuidad si no.
  Se mezcla con la frecuencia ponderada de superar la línea (el modelo cuenta como 10 partidos).
- Fiabilidad: muestra de esta temporada (25), historial (15), regularidad (20), minutos estables (15), margen sobre la
  línea (15), modelo frente a histórico (10). Resta 20 si está lesionado o en duda, 8 si cambió de rol (minutos ±18 %)
  y 15 si la muestra tiene pretemporada.
- ESPN numera la temporada por el año en que acaba (2027 = 26-27) y la Euroliga por el año en que empieza (2026 = 26-27).

## Valor común con LoL (`src/lib/value.ts`)

- `devig`: con las dos cuotas quita el margen exacto; con una, lo estima (7 %).
- `devigBooks`: con varias casas, quita a cada una su propio margen y las promedia (las que sólo dan un lado, con la mitad de peso).
  Lo usan jugadores (analizador, escáner, recomendaciones) y puntos de equipo, con las cuotas de todas las casas de esa línea; lo que se
  paga es la cuota elegida. Hasta el 12 de noviembre de 2026 se quitaba el margen a la mejor cuota de cada lado aunque fueran de casas
  distintas: salían márgenes casi nulos (0,3 %) y la probabilidad de la casa inflada del lado elegido, y la misma apuesta daba +7 % desde
  la recomendación y +0,8 % al pulsar la cuota de una casa. Las `p_market` de `bets.predictions` anteriores a esa fecha están hechas así.
- `sideValue`: EV = p × cuota + nula − 1; ventaja = probabilidad estimada − probabilidad de la casa sin margen;
  stake = ¼ de Kelly con un tope del 3 % del bank.
- `blendWithMarket` (sólo baloncesto; LoL usa el modelo a secas): la `p` del EV mezcla en logit el modelo y la casa sin margen, con peso
  0,3 en jugadores (0,15 con menos de 10 partidos; era 0,4 y 0,2 hasta noviembre de 2026) y 0,25 en equipos. El peso se multiplica por 4·q·(1−q), con q la probabilidad de la casa:
  hacia los extremos el modelo sale optimista y una diferencia pequeña da un EV enorme con cuotas altas. **Los pesos son una decisión, no una
  medida:** no hay cuotas históricas de baloncesto. La probabilidad del modelo no cambia: es la que dan el analizador y el escáner, y el panel
  enseña la mezcla aparte (*Con la casa*).
- `tooFar`: 0,85 de diferencia en logit entre modelo y casa (50 % frente a 70 %, o 10 % frente a 21 %). En jugadores resta 25 de fiabilidad y
  las recomendaciones lo descartan: suele ser que al modelo le falta algo o un mercado mal leído.
- `reliability`: suma los factores de cada deporte, reescala a 100 y resta las penalizaciones.
- `verdict` / `verdictOf`: *Apostar* (EV ≥ 2 %, fiabilidad ≥ 55), *Valor ligero* (EV ≥ 1 %, fiabilidad ≥ 45) o *No apostar*.
  **Es el único criterio de toda la app** (`BET_EV`, `BET_REL`, `LEAN_EV`, `LEAN_REL`): la etiqueta *Con valor* de las
  recomendaciones es *Apostar*, la banda de las mejores y la principal de cada perfil sólo cogen *Apostar* o *Valor ligero*, y lo usan
  también tenis, LoL y Acierto del modelo. Hasta noviembre de 2026 cada pantalla tenía el suyo (la banda cogía cualquier EV positivo y
  el análisis pedía un 4 %), y la misma apuesta salía como de las mejores en una y como *No apostar* en otra.
  Si el modelo se aleja demasiado de la casa (`tooFar`), el veredicto es *No apostar* aunque el valor salga alto: las recomendaciones
  ya las descartaban.
- Las cuotas cambian: al abrir el análisis desde una recomendación, si la cuota de ese lado ya no es la que se vio en la lista, se
  avisa arriba (la de antes y su valor, la de ahora y el suyo). El veredicto es siempre con la cuota de ahora.

## Interfaz

- *Partidos* (`BasketMatches`): igual que en LoL. Arriba se elige *Partidos* o [*Recomendaciones*](#recomendaciones). Tira de días con el
  número de partidos, filtro En juego / Próximos / Terminados, interruptor de cuotas de ganador, banda con las mejores de las próximas 24 h
  y partidos agrupados por competición (se pueden plegar). Al pulsar un partido se abre su ficha a página completa (*Volver a partidos* para
  salir): marcador grande, botón *Apuesta* y pestañas *Estadísticas*, *Recomendaciones* (la primera si no ha empezado), *Cuotas* (si no ha
  terminado), *Puntos*, *Líneas*, *Equipos*, *Plantillas* y *Valor de jugador*.
- *Estadísticas* (`GET /api/basket/boxscore/:id`, se refresca cada 20 s en juego): puntos por cuarto, comparación de
  equipo (tiros, rebotes, asistencias, robos, tapones, pérdidas), tabla de cada equipo con titulares y enfrentamientos de
  la temporada. Las columnas de la tabla se ordenan al pulsarlas (de más a menos, de menos a más, orden normal).
  Pulsar un jugador abre su partido (`BasketPlayerGameDialog`, como en fútbol): foto de ESPN, filtro Todos / Q1… / Pr,
  media pista con sus tiros (dentro y fallados) y sus estadísticas, y un botón *Sus líneas* que lleva al analizador.
  "Todos" sale del boxscore (oficial); cada cuarto y los tiros, de las jugadas de ESPN
  (`GET /api/basket/player-game/:id/:jugador`, `playerGame` en `espn.js`: el primer participante de cada jugada es quien la
  hace y el segundo quien asiste, roba o tapona; coordenadas en pies desde el aro). Sólo NBA, WNBA y NBL: la Euroliga no da
  jugada a jugada y su ficha sale sin pista ni cuartos.
- *Cómo fue el partido* (`BasketFlow`, en Estadísticas; `GET /api/basket/flow/:id`, `flow` en `espn.js`): la ventaja de
  cada equipo en cada momento (visitante arriba, local abajo, cada uno en su color), con la mayor ventaja, los cambios de
  líder, los empates y el mayor parcial de cada uno. Sale del marcador de cada jugada; en directo se refresca cada 30 s.
  Sólo NBA, WNBA y NBL.
- *H2H* (`BasketTrends` en `BasketMatches.tsx`, tabla común en `src/components/Trends.tsx`): para cada mercado con la
  línea más igualada de las casas (ganador, total, hándicap, puntos de cada uno, total de la 1.ª mitad), cuántas veces se
  ha cumplido en los cara a cara y en los últimos 10 de cada equipo, frente a la probabilidad sin margen. Usa los partidos
  de la liga de esta temporada y la anterior (`league-games`, los mismos de los puntos). En los últimos de un equipo, el
  otro lado del mercado es su rival de cada día. Sin cuotas, las líneas salen de lo habitual de los dos (mediana, a x,5).
- *Cuotas* (`BasketOdds`): estado de cada casa, botón *Actualizar cuotas* y mercados por Partido / Jugadores /
  Mitades / Cuartos / Otros. En hándicaps y totales salen primero las tres líneas más igualadas. Clic: apuesta; clic
  derecho: combinada.
- *Valor de jugador* (`BasketAnalyzer`): si las casas tienen líneas de ese jugador y mercado, se rellenan solas (la más
  igualada) y salen como botones. Si no, se propone la proyección redondeada a x,5 y las cuotas se ponen a mano.
- *Jugadores* (`BasketPlayers`): buscador de las tres ligas y el mismo analizador.
- *Líneas* (`BasketLines`, `BasketLineScanner`): ver [Escáner de líneas](#escáner-de-líneas). También como pestaña en la ficha de un
  partido que no ha empezado, sólo con sus jugadores.
- *Puntos* (`GamePoints`): pestaña de la ficha del partido. Ver [Puntos de los equipos](#puntos-de-los-equipos).

## Escáner de líneas

*Jugadores → Líneas*. Se elige un mercado de `BASKET_MARKETS`, Más o Menos y la línea, y salen los jugadores, primero los más rentables (sin
cuotas, de más a menos probabilidad). La línea admite `4,5`, `4.5`, `+4.5` (Más) y `-4.5` (Menos). Se puede ordenar también por probabilidad,
fiabilidad o proyección.

- **Partidos:** los que no han empezado de las próximas 24 horas, o de hoy, mañana o pasado. Por defecto no es el día natural porque en
  hora de España los partidos de la NBA de esta noche ya cuentan como de mañana. Una proyección de antes del partido no vale para uno en
  juego, así que esos no salen.
- **Cálculo:** `scanLine` llama al mismo `analyze` que el analizador, y pulsar una fila abre el análisis con ese mercado y esa línea.
  Las dos pantallas deben dar siempre la misma probabilidad.
- **Datos:** `GET /api/basket/team-logs/:league/:team` trae la plantilla con los partidos de cada jugador. El log de un jugador en ESPN
  pesa unos 700 KB: por eso `remember` (`cache.js`) guarda sólo el resumen y `bulk` limita a 8 las peticiones a la vez. Con 8 partidos
  tardó unos 25 s la primera vez y 4 s con la caché.
- **Cuotas:** las de las casas si tienen esa línea exacta para ese jugador, con el EV y un clic para el cupón. Si tienen otra línea, sale
  «línea X». Las consultas van con `quiet`: mirar muchos partidos no es abrirlos, y el marcador usa «el último abierto» para repartir
  sus capturas.
- **Filtros:** minutos previstos (15 por defecto), al menos 3 partidos, y fuera las bajas (`Out`, sanción o no haber jugado los últimos
  3 partidos de su equipo; es el único aviso en Euroliga y EuroCup, cuya API no da bajas). Cuota mínima (1,50 por defecto): mira la cuota de
  la casa y, si no tiene esa línea, la justa, porque si la justa ya es baja lo que paguen será menos todavía.

### Cuánto fiarse (backtest)

Sólo con lo anterior a cada partido, NBA 25-26 (desde 15 partidos jugados, n = 683 571) y 26-27 hasta el 5/11/2026 (n = 89 612).

| Dicho por el modelo | 25-26 real | 26-27 real |
|---|---|---|
| 40-50 % | 44,9 % | 40,5 % |
| 60-70 % | 63,7 % | 59,4 % |
| 70-80 % | 72,6 % | 70,0 % |
| 80-90 % | 82,0 % | 80,1 % |
| 90-100 % | 92,8 % | 91,5 % |

Ordenar selecciona los extremos, y ahí sale optimista. Misma línea en cada jornada:

| | 25-26: dicho → real | 26-27: dicho → real |
|---|---|---|
| El 1.º | 76,6 % → 71,0 % | 78,6 % → 73,5 % |
| Los 5 primeros | 67,8 % → 63,4 % | 69,0 % → 62,7 % |
| Los 10 primeros | 62,0 % → 58,3 % | 63,0 % → 57,8 % |

- Más de 4,5 asistencias en 25-26: los 5 primeros decían 83,9 % y se cumplió un 81,2 %.
- Robos y tapones son lo menos fiable: con p ≥ 80 % dicen un 85 % y se cumple un 75 % (25-26).
- La fiabilidad sí separa (25-26, p ≥ 70 %): de 70 para arriba dice 86,1 % y se cumple 83,7 %; entre 50 y 70, 78,3 % y 74,7 %; por debajo de
  50, 74,9 % y 67,6 %.
- Se probó una corrección logística (ajustada con 25-26, evaluada con 26-27). Mejoraba muy poco (Brier 0,1120 → 0,1117) y apenas tocaba
  el 1.º del ranking, así que no se aplicó: el sesgo viene sobre todo de seleccionar, no de una mala calibración. Se avisa en la pantalla.
- **Límites:** sólo cuenta partidos que el jugador jugó y plantillas actuales. No hay líneas históricas de las casas, así que **no se ha
  podido medir si el EV gana dinero**: el backtest dice si la probabilidad es correcta, no si se le gana a la casa. Euroliga, EuroCup,
  WNBA y NBL no se han evaluado.

## Recomendaciones

*Partidos → Recomendaciones* (las próximas 24 h o el día que se elija) y pestaña *Recomendaciones* de cada partido sin empezar. Es lo mismo que
en tenis, con otra idea de orden: una cuota de 1,11 muy probable no da dinero, así que dentro de cada perfil manda el valor.

Lógica en `src/lib/basket-picks.ts` (funciones puras) y datos y pantalla en `src/components/BasketPicks.tsx`. Se calcula en el navegador, como el
escáner, con el mismo `analyze`: el modelo de jugadores está en TypeScript y el servicio es CommonJS.

- **Qué entra:** cada línea real de las casas de jugadores (`playerPicks`) y de totales y puntos de equipo, del partido, las mitades y los cuartos
  (`teamPicks`). Ganador y hándicap no, porque el modelo no los calcula. Sin cuotas no se recomienda nada ni se piden los partidos de los
  jugadores: los logs sólo se piden de los partidos con líneas.
- **Qué se descarta (`saneLine`):** cuota por debajo de 1,20 o por encima de 15, fiabilidad menor de 40, EV menor de −12 %, `tooFar`, bajas, menos de
  3 partidos o de 15 minutos previstos.
- **La mejor opción:** EV positivo, fiabilidad ≥ 50 y probabilidad ≥ 30 %. Se ordena por EV + 0,1 × fiabilidad + 0,1 × probabilidad. Robos y tapones
  no salen aquí salvo que se filtre por *Defensa*, porque es lo que peor calibra el modelo. Si ninguna sale rentable se dice.
- **Perfiles:** *Más fáciles* (probabilidad ≥ 58 %), *Equilibradas* (42-58 %) y *Más complicadas* (15-42 %), de más a menos valor, sin repetir mercado
  de un jugador y con dos filas por jugador como mucho (`diversify`).
- **Con valor:** EV ≥ 2 % y fiabilidad ≥ 55, lo mismo que en tenis.
- **Filtros:** mercado, Más o Menos, línea exacta (`+2,5`), cuota mínima (1,50 por defecto, se recuerda) y *Sólo con valor*.
- **Rendimiento:** cada equipo se calcula una vez (`once`) y sólo se recalcula si cambian los mercados de verdad: la lista de mercados se compara por
  referencia porque las cuotas se vuelven a pedir cada minuto y casi nunca cambian. 2 partidos con 738 líneas tardan unos 220 ms.

Comprobado con los partidos reales de los jugadores y **cuotas de prueba generadas**, porque el 5/11/2026 no había ninguna cuota de baloncesto guardada
(la red desde la que se hizo bloquea las casas). Con un margen del 8 %, el EV máximo pasó de +65 % a +11 % al medir en logit y bajar el peso en los extremos, y
la mediana quedó en −4 %, lo esperable. **No se ha podido medir si se gana dinero ni si los pesos son buenos:** cuando `odds.price_history` tenga líneas de
baloncesto se podrá comparar el EV con lo que pasó.

## Puntos de los equipos

`GET /api/basket/league-games/:league` da los partidos terminados de toda la liga, esta temporada y la anterior, con los puntos de cada
cuarto (`src/lib/basket-teams.ts` hace las cuentas). En ESPN sale de un marcador por día (no acepta rangos): el calendario de la temporada
dice qué días hay partidos, y los días con más de dos de antigüedad se guardan resumidos en `basket.cache` con clave `keep:` y no se vuelven
a pedir. La primera carga de la NBA son unos 8 s. La Euroliga y la EuroCup ya traen los parciales en su calendario. Fuera la pretemporada y
el All-Star (`competitions[0].type.abbreviation === 'ALLSTAR'`).

- *Equipos → Puntos* (`LeaguePoints`): anotados, encajados, total, diferencia, máximo y mínimo de toda la liga, ordenable. Por partidos
  (temporada, casa, fuera, últimos 10 o 5) y tramo (partido, mitades, cuartos). Con una línea, el % de partidos que la superan.
- *Ficha de equipo* (`TeamPoints`): los mismos datos por tramos, media de cada cuarto y mitad, últimos partidos frente a una línea y
  estadísticas por partido (`TeamStats`). Las avanzadas son estimaciones: posesiones = tiros + 0,44 × tiros libres − rebotes de ataque
  + pérdidas; ratings por 100 posesiones.
- *Ficha del partido → Puntos* (`GamePoints`): proyección del total y de cada equipo, por tramo. Con la línea de las casas si la hay, el
  panel de valor común, los últimos partidos frente a la línea, las frecuencias y los enfrentamientos.
- En las gráficas, las barras salen de la línea: desde 0 no se verían 5 puntos sobre 225, y recortar el eje engañaría. Arriba es Más y abajo
  Menos, así que no depende sólo del verde y el rojo, que se confunden con daltonismo.
- La prórroga cuenta en el partido y en la 2.ª mitad, no en el 4.º cuarto. **No se ha comprobado** que Winamax y Betway liquiden igual.

### Modelo

`proyección = media de la liga + 0,8 × (lo que anota por encima de la media) + 0,8 × (lo que encaja el rival por encima de la media) ± la
mitad del factor campo`. Pesos con vida media de 15 partidos y esta temporada ×1,6. La media de la liga no cuenta los playoffs: se anota menos
y al principio de temporada inflaba las proyecciones (+3 puntos de sesgo). La dispersión sale de la de los dos equipos, y la probabilidad
mezcla el modelo con la frecuencia histórica, que pesa menos que en los jugadores porque no sabe contra quién se juega.

Si el modelo se aleja de la casa 12 puntos de probabilidad o más, resta 25 de fiabilidad, porque lo normal es que la casa sepa algo que el
modelo no. Ese umbral **no está validado** (no hay líneas históricas), sólo hace más prudente el veredicto.

Ajustado con la NBA 24-25 (1 086 partidos). Las líneas de la comparación son las mismas para todas las variantes.

| Evaluación | Error medio del total | Sesgo | Se pasa en proyecciones extremas |
|---|---|---|---|
| 25-26 (1 322 partidos) | 15,09 | −0,54 | +0,9 |
| 26-27 hasta el 5/11/2026 (121 partidos) | 15,14 | −0,52 | +7,5 |

Calibración en 25-26: dice 25,0 % y se cumple 24,9 %; 45,1 % y 44,6 %; 64,8 % y 64,5 %; 85,1 % y 85,1 %. Sumar los totales medios de los dos
equipos, sin más, falla por 15,6 en 25-26. El peso de esta temporada no se pudo ajustar, porque 24-25 no tenía temporada anterior en la
muestra. Tampoco aquí se ha podido medir si se le gana a la casa, y Euroliga, EuroCup, WNBA y NBL usan los parámetros de la NBA sin evaluar.

## Calibración de noviembre de 2026 (`scripts/calib-basket.ts`)

Con las primeras recomendaciones reales resueltas (10 y 11 de noviembre) los "más" salían mal: decía 44 %, la casa 34 % y se
cumplía un 27,5 %. Se buscó la causa con los registros de la caché (32 000 partidos de 1 046 jugadores) y con las líneas reales:

- **La proyección se pasaba a principio de temporada.** En 25-26 el sesgo era cero, pero en 26-27 daba 1,5 minutos y 1,8 de
  P+R+A de más (3 minutos y 3 de P+R+A en los 3 primeros partidos). Los que siguen de una temporada a otra juegan menos: les
  quitan minutos novatos y fichajes y son un año mayores. Ajustado con octubre y comprobado con noviembre: los partidos de la
  temporada pasada valen ×0,88 (estadística) y ×0,92 (minutos). Sesgo de P+R+A en 26-27: −1,57 → +0,03, sin tocar 25-26.
- **Los minutos muy altos vuelven hacia la media**: 0,7 minutos de menos con 33 o más previstos, incluso en 25-26. Por encima de
  30 se acercan un 15 % (ajustado hasta enero, comprobado después). Quita el sesgo de minutos; la probabilidad no cambia.
- **Colas más gruesas que la curva**: a ±1,5 desviaciones pasan más partidos muy malos y muy buenos de los que dice. Varianza ×1,2.
- **Quitar el margen de otra forma no cambia nada**: con un margen del 4,8 %, proporcional, aditivo, potencia y Shin dan lo mismo.

La prueba pone las líneas a −1,5…+1,5 desviaciones de la media de los últimos 20 partidos (las mismas para todas las variantes,
como las escaleras de las casas), y no sólo en la proyección. Log-loss en 26-27: 0,469 → 0,463; en 25-26 no cambia (0,494 → 0,493).
Con las 633 recomendaciones reales de la NBA recalculadas, el modelo nuevo acierta más que el viejo (log-loss 0,641 → 0,624; mezclado
con la casa 0,603 → 0,599) y habría recomendado 333 en vez de 632 (+2 % frente a −10 %; son unos 15 partidos, es poco).

**La casa sola acertó más que cualquier mezcla** en esas recomendaciones: son justo las líneas en las que el modelo no estaba de
acuerdo con ella, y en los "más" ganó siempre. Por eso el peso del modelo baja a 0,3. Para medirlo sin ese sesgo, desde ahora se
guardan en `bets.predictions` **todas las líneas** que calcula el modelo, no sólo las de valor; en Acierto del modelo se ven las
recomendadas (EV ≥ 2 % y fiabilidad ≥ 55) o «Todas las líneas». Con unos miles resueltas hay que repetir la medida del peso por
mercado y por lado.

Para repetir la prueba (unos 5 minutos con un partido de cada 4; el tercer argumento prueba variantes de `PROJ`):

```bash
docker compose exec -T db psql -U lolet -d lolet -At -c "SELECT json_object_agg(key, value) FROM basket.cache WHERE key LIKE 'log:nba:%'" > logs.json
npx esbuild scripts/calib-basket.ts --bundle --platform=node --outfile=<temporal>/cal.cjs
node <temporal>/cal.cjs logs.json 4 '{"carry":1,"carryMin":1}'
```

## Bajas de los compañeros

El modelo **no** cambia la proyección cuando faltan compañeros: no está medido cuánto suben los demás, y la casa ya pone la línea
sabiéndolo. Lo que sí hace (`src/lib/basket-mates.ts`, con los registros de la plantilla, `GET /api/basket/team-logs`):

- **Quién falta y desde cuándo.** Un compañero con "Out" en el parte (ESPN en la NBA; el de la plantilla en la WNBA) cuenta como
  importante si sus últimos 10 partidos con el equipo pasan del 42 % de los minutos (unos 20 en la NBA, 17 en la WNBA). La baja es
  **nueva** si lleva 3 partidos o menos fuera esta temporada: entonces los últimos partidos del jugador, que son los que más pesan en la
  proyección, se jugaron con él. Si lleva más, ya están dentro de su media.
- **Fiabilidad de los "menos".** Con bajas nuevas e importantes, el lado "menos" pierde 10 + 5 por baja puntos de fiabilidad (25 como
  mucho) y lleva un aviso; el "más" no se toca. Es una decisión, no una medida: la proyección puede quedarse corta justo hacia ese lado.
  Se aplica igual en el analizador, el escáner y las recomendaciones (`matesOut` en el contexto del modelo).
- **Con él y sin él.** En *Contexto*, por cada importante que falta: la media del jugador en el mercado elegido, sus minutos y cuántas
  veces pasó la línea en los partidos sin él y con él, esta temporada y la anterior, sólo en este equipo y en temporadas en que coincidieron.
  Con menos de 5 partidos sin él es una pista, no una prueba.

Para meterlo en la proyección habría que medir con `scripts/backtest-basket.ts` cuánto cambia de verdad (como el B2B, que parecía obvio y
salió al revés).

## Pendiente

- Flechas de subida y bajada de las cuotas (el histórico se guarda en `odds.price_history` y lo da `POST /api/odds/history`; falta la interfaz).
- Clasificaciones por liga.
- No ajusta la proyección por bajas de compañeros (sólo la fiabilidad de los "menos", ver arriba), ritmo del rival ni defensa por posición.

## Colores de los equipos

La ficha del equipo, *Frente a frente* y el marcador grande del partido van con los colores de cada equipo, y no con el naranja de la app. Si no se conocen, se quedan con el naranja.

- `GET /api/basket/colors/:league` da `{ idEquipo: { color, alt } }`. NBA y WNBA: ESPN (`/teams`, color y `alternateColor`).
- **Euroliga y EuroCup:** su API no los da y salen del escudo (`server/services/basket/colors.js`): el tono que más ocupa y el segundo, y cuanto más vivo más cuenta (los dorados metálicos daban marrón). El blanco, el negro y el gris sólo mandan si no hay otro, porque la mayoría de los escudos llevan borde. `KNOWN` fija los clubes en los que el escudo engaña (Partizán y Besiktas salían rojos). Se hace en el backend porque sus servidores no permiten leer los píxeles desde el navegador (CORS), y sin dependencias: son PNG con zlib, muchos entrelazados, alguno con paleta o de 16 bits. Se guarda en `basket.cache` por dirección del escudo. Es una aproximación: comprueba el resultado si cambia un escudo.
- **`teamTheme`** (`src/lib/team-colors.ts`) no usa los colores tal cual, porque sobre ellos van letras blancas y cifras sobre fondo oscuro: oscurece la banda hasta un contraste de 5 con el blanco y aclara la línea hasta 8 con el negro. Si el principal es muy claro y el otro oscuro, los cambia de sitio. Se aplica con las variables `--tv-*` en el contenedor: las piezas de `viz.tsx` las leen solas.

## Equipos

*Jugadores → Equipos*: clasificación de cada liga, y al pulsar un equipo su ficha (`src/components/BasketTeamSheet.tsx`).
La ficha de un partido tiene además la pestaña *Equipos*, con los dos frente a frente.

| Ruta | `window.api` | Qué devuelve |
|---|---|---|
| `GET /api/basket/standings/:league` | `basket:standings` | Grupos con cada equipo: puesto, balance, casa, fuera, últimos 10, racha y puntos por partido |
| `GET /api/basket/team/:league/:team` | `basket:team` | Clasificación, estadísticas por grupos, líderes, resultados, próximos partidos y plantilla con bajas |
| `GET /api/basket/league-games/:league` | `basket:leagueGames` | Partidos terminados de la liga con los puntos por cuarto, esta temporada y la anterior |
| `GET /api/basket/team-logs/:league/:team` | `basket:teamLogs` | Plantilla con los partidos de cada jugador |
| `GET /api/basket/colors/:league` | `basket:colors` | Color principal y secundario de cada equipo |

- **NBA y WNBA** (ESPN): los promedios de la plantilla salen de los líderes del equipo; la NBA añade salarios y bajas.
  La **NBL** no tiene líderes ni estadísticas de equipo en ESPN: medias y líderes salen de los registros montados con los box scores.
  Las estadísticas se piden con `seasontype=2`, porque fuera de temporada ESPN daría sólo las del playoff.
- **Euroliga y EuroCup** (API de la Euroliga): la clasificación se pide por jornada y la jornada en curso puede dar 404, así
  que se usa la última que responda. Añaden aforo, ciudad, país y presidente; la API no da bajas.

## Contexto del jugador

En el analizador, la tarjeta **Contexto** (`src/components/BasketContext.tsx`) junta lo que puede cambiar el partido de
un jugador: el parte médico de ESPN, si lleva partidos sin jugar o vuelve de una lesión (con sus minutos desde la vuelta
frente a los de antes), el descanso de su equipo y del rival, cómo rinde él en B2B frente a con descanso (esta temporada y
la anterior, con el % de veces que supera la línea), si le están dando más o menos minutos (los 5 últimos frente a la media)
y las bajas de su equipo. Es información; de ella, el modelo sólo usa lo que se ha medido que importa (abajo).

## B2B y vuelta de baja en el modelo (`src/lib/basket-context.ts`, `CTX_FACTORS` en `basket-model.ts`)

`gameCtx` saca del registro del jugador, del calendario de su equipo y de la fecha del partido si juega en B2B (su partido
anterior fue el día antes, en hora de Nueva York) y si es su 1.º, 2.º o 3.º partido tras perderse 3 o más seguidos de su
equipo. Lo usan igual el analizador (calendario de `/api/basket/schedule`), el escáner y las recomendaciones (calendario
sacado de la plantilla, `teamGamesOf`): las tres pantallas siguen dando la misma probabilidad.

Medido con `scripts/backtest-basket.ts` sobre los registros de la caché (unos 420 jugadores de la NBA, temporadas 25-26
y 26-27): para cada partido se proyecta con los anteriores y se compara con lo que hizo. Ajuste: 25-26 hasta enero;
comprobación: de febrero en adelante y 26-27.

| Situación | Ajuste | Comprobación | En el modelo |
|---|---|---|---|
| B2B | PRA +2,7 % ±2,4, minutos +2,2 % | PRA +5,9 % ±2,4, minutos +5,0 % | ×1,02 en puntos, rebotes y sus sumas |
| 1.er partido tras baja | PRA −11,6 % ±6,6, minutos −13 % | PRA −12,3 % ±6,5, minutos −16 % | ×0,90-0,93 según el mercado |
| 2.º partido tras baja | PRA −10 % | PRA −6 % | ×0,93-0,97 |
| 3.er partido | ≈ 0 | ≈ 0 | nada |

**En B2B no rinden menos, sino algo más**: quien juega el segundo de un B2B está sano y tiene minutos; los que se toman
descanso no salen. Por eso en la tarjeta de contexto el B2B ya no va en rojo. Lo medido se encoge un 20 % hacia 1. Con
el periodo de comprobación, la probabilidad de "Más" mejora en los partidos de vuelta (Brier 0,2375 → 0,2359) y un poco
en los B2B, sin empeorar el resto.

La misma prueba enseña que **el modelo solo se pasa de seguro**: cuando dice 63 %, sale un 54-56 %; cuando dice 27 %, un
34-37 %. En la app lo suaviza la mezcla con la casa (`MODEL_WEIGHT`), y el acierto real de lo que enseña se mide en
Mis apuestas → Acierto del modelo. Si ahí también sale descalibrado, el siguiente paso es encoger la probabilidad del
modelo hacia el 50 % o bajar su peso.

Para repetir la prueba:

```bash
docker compose exec -T db psql -U lolet -d lolet -At -c "SELECT json_object_agg(key, value) FROM basket.cache WHERE key LIKE 'log:nba:%'" > <temporal>/logs.json
npx esbuild scripts/backtest-basket.ts --bundle --platform=node --outfile=<temporal>/bt.cjs && node <temporal>/bt.cjs <temporal>/logs.json
```

Debajo de "En las casas", la tabla del analizador enseña la cuota de cada casa por línea (Más y Menos), con la que paga
más resaltada cuando las dos la tienen (`playerLines` guarda `books` con las cuotas de cada casa).
