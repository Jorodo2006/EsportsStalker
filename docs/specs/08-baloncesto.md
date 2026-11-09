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

| Ruta | `window.api` | Qué devuelve |
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
- `blendWithMarket` (sólo baloncesto; LoL usa el modelo a secas): la `p` del EV mezcla en logit el modelo y la casa sin margen, con peso
  0,4 en jugadores (0,2 con menos de 10 partidos) y 0,25 en equipos. El peso se multiplica por 4·q·(1−q), con q la probabilidad de la casa:
  hacia los extremos el modelo sale optimista y una diferencia pequeña da un EV enorme con cuotas altas. **Los pesos son una decisión, no una
  medida:** no hay cuotas históricas de baloncesto. La probabilidad del modelo no cambia: es la que dan el analizador y el escáner, y el panel
  enseña la mezcla aparte (*Con la casa*).
- `tooFar`: 0,85 de diferencia en logit entre modelo y casa (50 % frente a 70 %, o 10 % frente a 21 %). En jugadores resta 25 de fiabilidad y
  las recomendaciones lo descartan: suele ser que al modelo le falta algo o un mercado mal leído.
- `reliability`: suma los factores de cada deporte, reescala a 100 y resta las penalizaciones.
- `verdict`: *Apostar* (EV ≥ 4 %, ventaja ≥ 3 %, fiabilidad ≥ 55), *Valor ligero* (EV ≥ 1,5 %, fiabilidad ≥ 45) o
  *No apostar*.

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
  hace y el segundo quien asiste, roba o tapona; coordenadas en pies desde el aro). Sólo NBA y WNBA: la Euroliga no da
  jugada a jugada y su ficha sale sin pista ni cuartos.
- *Cómo fue el partido* (`BasketFlow`, en Estadísticas; `GET /api/basket/flow/:id`, `flow` en `espn.js`): la ventaja de
  cada equipo en cada momento (visitante arriba, local abajo, cada uno en su color), con la mayor ventaja, los cambios de
  líder, los empates y el mayor parcial de cada uno. Sale del marcador de cada jugada; en directo se refresca cada 30 s.
  Sólo NBA y WNBA.
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
  podido medir si el EV gana dinero**: el backtest dice si la probabilidad es correcta, no si se le gana a la casa. Euroliga, EuroCup y
  WNBA no se han evaluado.

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
muestra. Tampoco aquí se ha podido medir si se le gana a la casa, y Euroliga, EuroCup y WNBA usan los parámetros de la NBA sin evaluar.

## Pendiente

- Flechas de subida y bajada de las cuotas (el histórico se guarda en `odds.price_history` y lo da `POST /api/odds/history`; falta la interfaz).
- Clasificaciones por liga.
- No ajusta por bajas de compañeros, partidos seguidos, ritmo del rival ni defensa por posición.

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
  Las estadísticas se piden con `seasontype=2`, porque fuera de temporada ESPN daría sólo las del playoff.
- **Euroliga y EuroCup** (API de la Euroliga): la clasificación se pide por jornada y la jornada en curso puede dar 404, así
  que se usa la última que responda. Añaden aforo, ciudad, país y presidente; la API no da bajas.
