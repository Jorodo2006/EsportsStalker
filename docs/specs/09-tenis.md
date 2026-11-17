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

**Cruces de ESPN comprobados con LiveScore** (`checkRivals` en `index.js`, `mainTour` en `livescore.js`). ESPN a veces pone a
la rival equivocada: el 13-11-2026, en las WTA Finals, dio Andreeva - Shnaider (la reserva) cuando LiveScore y las casas seguían
con Andreeva - Muchova. Con eso el partido se quedaba sin cuotas ni recomendaciones, y el lector buscaba un partido que las casas no
tenían. Ahora, si LiveScore tiene el partido a la misma hora (±30 min) con uno de los dos y otro rival, se pone el de LiveScore
con su ficha de ESPN, pero sólo si ESPN lo tiene en ese torneo (sale en otro partido): si no, lo normal es que sea el mismo jugador
escrito de otra forma y no se toca. El partido lleva `fixed` con lo que daba cada uno, y la app lo avisa en la columna del
partido y en su ficha. Los terminados no se tocan.

| Ruta | `window.api` | Qué devuelve |
|---|---|---|
| `GET /api/tennis/games?date=` | `tennis:games` | Partidos de ATP y WTA de ese día (`id` = `atp:123`): sets, tie-breaks, cabeza de serie, ranking, pista |
| `GET /api/tennis/days?from=&n=` | `tennis:days` | Partidos y partidos en juego por día, para la tira de días |
| `GET /api/tennis/live` | `tennis:live` | Partidos en juego (aviso rojo del selector) |
| `GET /api/tennis/rankings/:tour` | `tennis:rankings` | Ranking ATP o WTA (puesto, anterior, puntos) |
| `GET /api/tennis/player/:tour/:id` | `tennis:player` | Partidos del jugador en los torneos de los últimos días |
| `GET /api/tennis/profile/:tour/:id` | `tennis:profile` | Ficha: datos personales, balance de temporada y carrera, títulos, premios y últimos resultados |

El historial de la ficha sale de `eventlog` (API core de ESPN), que sólo da referencias: se pide el cuadro de cada torneo
(12 como mucho, con caché) y se buscan ahí sus partidos.

**La previa (qualy) de la ATP y la WTA** (`roundEs` y `withQualifying` en `index.js`, `qualifying` en `livescore.js`). Las rondas
de la previa empiezan por «Previa», que es lo que miran el interruptor *Previa*, las lecturas programadas y las recomendaciones para
dejarla fuera. ESPN llama a la última «Qualifying Final»: hasta noviembre de 2026 se quedaba sin traducir y pasaba por un partido
del cuadro final (salía con la previa oculta y se leían sus cuotas); ahora es «Previa, ronda final». ESPN no trae la previa de
todos los torneos, así que se completa con LiveScore, que la da como una fase aparte ("Paris Masters: Qualification"):
- Sólo se añade lo que ESPN no tiene. Mismo partido = los dos jugadores, con un apellido en común (ESPN «Inaki Montes-De La Torre»,
  LiveScore «Inaki Montes»).
- Va al panel del torneo de ESPN que comparte una palabra del nombre que no sea genérica («Paris Masters» y «Rolex Paris Masters»);
  si ESPN aún no lo tiene, con el nombre de LiveScore e id `lsq:<Sid>`. Los partidos llevan id `lsq:<Eid>` y `source: 'LiveScore'`
  (sus puntos en directo salen de ahí mismo, como los de los Challenger).
- La ronda se cuenta con la fase entera (`/stage/tennis/<categoría>/<fase>/0`, una petición cada 30 min por torneo con previa), que
  también da el país de cada jugador: «Previa, 1.ª ronda», «Previa, 2.ª ronda»… y «Previa, ronda final».

## ATP Challenger (`server/services/tennis/livescore.js`)

ESPN no los trae (de la ATP sólo el torneo principal). Salen de la API de la app de LiveScore (`prod-public-api.livescore.com/v1/api/app/date/tennis/<AAAAMMDD>/0`) y entran en
`GET /api/tennis/games`, `/days` y `/live` con `level: 'challenger'`, `tour: 'atp'` e id `ch:<Eid>`. Se pueden ocultar con el interruptor *Challenger*.

- **Por qué esta fuente:** el `robots.txt` de la web de LiveScore prohíbe `/api/` y sus condiciones no se pudieron leer (la página no se carga sin JavaScript). Su servidor de datos no tiene `robots.txt`. **Se decidió usarla el 5/11/2026, a petición del usuario y para uso personal**, a sabiendas de que
  Tennis Abstract y tennis-data.co.uk se descartaron por su `robots.txt`. Las peticiones van sin disfrazar. **Si la app se fuese a vender o a publicar, hay que volver a mirarlo.**
- **Sólo marcador y cuotas:** sin *Recomendaciones* ni *Forma de los jugadores*, porque ni el modelo (TennisMyLife) ni las fichas (ESPN) tienen sus datos. No hay banderas, ranking ni cabezas de serie.
- **Motor propio (servicio `challenger`, `server/sharpex-tenis`):** Elo de los Challenger con el histórico de Sackmann y TennisMyLife, en `/api/challenger`. Todavía no sale en la interfaz. `GET /api/challenger/comparar?fecha=AAAA-MM-DD` da, para cada Challenger del día, la probabilidad del modelo, la superficie (por la ciudad del torneo) y las cuotas de apertura y de cierre de cada casa con la probabilidad del mercado sin margen: con los resultados, dirá si el modelo gana a la casa antes de enseñar picks.
- **Cuotas:** son decenas al día, así que no se leen como el resto del tenis. Sólo los del cuadro final, dos veces (`scheduler.js`, ajuste `challengerOddsEnabled`, *Ajustes → Cuotas automáticas → Leer los Challenger*): una hasta 12 h antes y la de cierre, a 20 min de la hora prevista; si sigue sin empezar, otra cada 40 min hasta 5 h después (las horas de LiveScore son aproximadas). Unas 50-75 lecturas al día. También se pueden pedir con *Actualizar cuotas*, si las casas los tienen.
- **Códigos:** `Eps` es el estado (`NS`, `S1`-`S5`, `FT`, `Ret.`, `W.O.`, `Canc.`, que no se enseña). `ErnInf` es la ronda: `4xxx` dieciseisavos, `5xxx` octavos, `6xxx` cuartos, `7xxx` semifinales y `final`, deducidos contando los partidos de cada código. En la ATP y la WTA la previa va en el nombre de la fase (`: Qualification`).
- **La previa de los Challenger no la tiene LiveScore** (comprobado el 16-11-2026): no sale en los días de previa (sólo las finales de
  la semana anterior), no existe como fase (`/stage/.../<torneo>-qualification` da 410, como un nombre inventado) y la web del
  torneo sólo tiene *Overview*, *Fixtures* y *Results*. Otras fuentes miradas:
  - **ProTennisLive** (la oficial de la ATP, sin `robots.txt`): es de donde sale (abajo).
  - Flashscore: su web carga los datos con una clave de su propia aplicación; usarla sería hacerse pasar por ella (regla 1).
  - TennisLive: su `robots.txt` prohíbe expresamente a los robots de IA. Tennis Temple: 403 de Cloudflare. Tennis Explorer: la red
    del instituto lo bloquea por DNS. Tennis TV: sólo el circuito ATP. atptour.com y Sofascore: 403 (ya descartadas).

## Previa de los Challenger (`server/services/tennis/protennislive.js` y `ptlpdf.js`)

De ProTennisLive, la web oficial de resultados de la ATP (sin `robots.txt`): cada torneo publica en
`www.protennislive.com/posting/<año>/<id ATP>/` el cuadro de la previa (`qs.pdf`) y el orden de juego del día (`op.pdf`).

- **Qué torneos:** el id ATP de un Challenger se repite de un año a otro. Se prueban los de la misma semana (con una de margen) de
  los dos años anteriores, sacados del histórico de Sackmann por el servicio `challenger` (`GET /internal/challenger/torneos`, sólo
  por la red de Docker), y los de las ciudades que LiveScore ya tiene esa semana. Vale el que trae las fechas de esta semana o de
  la siguiente (la previa de la siguiente es este fin de semana). Un torneo nuevo, que no se jugaba hace un año como Challenger
  (Metz en 2026), no sale. Antes de publicarse el cuadro hay una hoja de aviso de 2-3 KB: se trata como si no estuviera.
- **Cada cuánto:** los PDF los sirve la caché de Cloudflare 5 min (`max-age=300`), así que preguntar más a menudo no da nada
  nuevo. De viernes a martes de la semana del torneo, cada uno cada 5 min de 7 a 23 h del torneo y cada 30 min de noche; antes,
  cada 3 h hasta que sale el cuadro; con la previa acabada, cada 6 h. Peticiones condicionales (`ETag`): si no ha cambiado
  responde 304 sin el PDF. De una en una, como poco a 8 s; con un 429 se para 5 min y se espacia el doble (vuelve a bajar tras 20
  buenas). Lo leído se guarda en `tennis.cache` (`ptl:<año>-<id>`). Estado: `GET /internal/tennis/previa` del servicio tennis.
- **Los PDF** son páginas impresas con Chrome: fuentes CID con `ToUnicode` y los anchos de cada glifo (`/W`), con lo que se juntan
  los trozos que Chrome parte al ajustar el espacio entre letras ("MORIY" + "A, Hiroki"). El cuadro: posición, siembra, entrada
  (WC, Alt…), "APELLIDO, Nombre" (cortado con "…" si no cabe) y país; los ganadores van en la columna de la ronda siguiente a media
  altura entre los dos de los que salen, y se asignan por la altura y el apellido; el resultado va desde el que gana ("62 67", "6",
  "62" = 6-2 6-7(6) 6-2; "Walkover"). El orden de juego: la pista es la columna, la hora la etiqueta del turno ("Starts At 10:00",
  "Not Before 13:00"; "Followed By" = el anterior + 1 h 30, aproximada), y la hora local se pasa a UTC con la zona de la ciudad
  (`zoneOf`; en países con varias zonas, si la ciudad no está, la más habitual y la hora sale aproximada).
- **Los partidos** van en `GET /api/tennis/games` y `/days` con `level: 'challenger'`, `source: 'ProTennisLive'`, id
  `ptl:<año>-<id>-<ronda>-<n>` y ronda «Previa, 1.ª ronda» … «Previa, ronda final», en el panel del torneo de LiveScore de la misma
  ciudad. Sin orden de juego, el día se cuenta hacia atrás desde el de la ronda final (domingo si no se sabe) y la hora sale "por
  confirmar". Sin directo ni puntos: el resultado llega con el cuadro, a los 5 min como mucho. Como el resto de la previa, no entran
  en las lecturas de cuotas ni en el motor de los Challenger.
- Las pruebas (`server/test/ptl.test.js`) usan trozos con la forma de los PDF de Sídney, Champaign y Montevideo de noviembre de 2026.
  Si cambian el diseño de los PDF, la lectura deja de entenderlos y lo dice en el registro (`no se entiende el cuadro de <id>`).

## Puntos del juego (`server/services/tennis/points.js`)

ESPN sólo da los juegos de cada set. Los puntos (15-30, 40-AD) y quién saca van en `points` de `GET /api/tennis/games` y `/live`:

- **WTA y WTA 125:** API de la web oficial de la WTA (`api.wtatennis.com/tennis/tournaments/<id>/<año>/matches?states=L`), cuyo `robots.txt` no pone límites.
- **ATP:** LiveScore (`Tr1G`, `Tr2G`, `Esrv`), cruzado por nombre con el partido de ESPN. `app.atptour.com` y Sofascore responden 403 y no se intenta saltar.
- **Challenger:** LiveScore, de donde sale el partido entero.
- **0-0 en LiveScore:** no trae los puntos. Se enseña 0-0 sólo si ese partido ya ha dado puntos alguna vez; si no, nada, porque también podría no tener datos.
- **Sólo si cuadra:** si los juegos no coinciden con los de ESPN, `points` es `null`. Una fuente puede ir por detrás: al acabar un tie-break, ESPN daba 6-7 y la WTA seguía en 6-6
  con 5-6. Tampoco se enseña si lleva 5 minutos sin cambiar (lluvia, lesión).
- **Nombres:** se cruzan por palabras, porque ESPN escribe "Li Zongyu" y la WTA, nombre "Zongyu" y apellido "Li".
- **Frescura:** caché de 15 s (la lista de torneos, 6 h) y la interfaz pregunta cada 15 s con partidos en juego. Por eso el marcador de ESPN pasó de 60 a 20 s de caché, con
  la copia en `tennis.cache` limitada a una por minuto. Puede ir por detrás del partido, y no se ha medido cuánto: no hay que fiarse de él para apostar punto a punto.
- Es la API que usa su web, sin documentar: puede cambiar sin aviso. Si falla, el marcador sale igual, sin puntos.

## Estadísticas de juego (`server/services/tennis/tml.js`)

ESPN no da saque, resto ni superficie. Salen de los **CSV gratuitos de TennisMyLife** (`stats.tennismylife.org/data/`: un
fichero por año y por circuito, más los torneos en curso), que se bajan cada 6 h (en curso, cada 30 min) y se guardan en
`tennis.cache`. Se calculan por año, 52 semanas y 3 años, en total y por superficie.

| Ruta | `window.api` | Qué devuelve |
|---|---|---|
| `GET /api/tennis/stats/:tour/:id` | `tennis:stats` | Periodos con resultados, juegos, saque, resto, mejor y peor superficie (mínimo 5 partidos), y balance por rival y categoría |
| `GET /api/tennis/surface/:tour?name=&city=` | `tennis:surface` | Superficie de un torneo, buscándolo por ciudad o nombre |

- **Condiciones de TennisMyLife:** sólo uso personal y no comercial, y no se pueden redistribuir los CSV. Por eso no van al
  repo. **Si la app se fuese a vender o a publicar con anuncios, hace falta su permiso escrito.**
- Cada periodo lleva `tour`: la media de todo el circuito con el mismo filtro, que es la línea central de las barras de saque
  y resto. Los colores de superficie (`SURFACE_COLOR`) están validados para daltonismo sobre el fondo oscuro.
- Los jugadores se cruzan por nombre con ESPN (sin acentos). Si no aparecen, la pantalla lo dice.
- **Fotos** (`server/services/tennis/photos.js`): el retrato de ESPN y, si no lo tiene, la imagen de su artículo de Wikipedia, comprobando que es un tenista y lleva su apellido. Se busca sólo al abrir una ficha, de una en una y guardando el resultado en `tennis.cache`, porque Wikipedia responde 429 si se le piden muchas seguidas. Sin foto salen las iniciales.
- **Ratio de dominio**: % de puntos ganados al resto entre % de puntos perdidos al saque. Es la cifra grande de la ficha; se calcula en el renderer con los datos de TennisMyLife.
- Se contrastó con la API oficial de la WTA (Swiatek 2026): los porcentajes coinciden con décimas de diferencia, pero faltan
  unos pocos partidos (53 de 58), así que no hay que tomar los totales como cifra oficial. Los W.O. no cuentan.
- Fuentes descartadas: atptour.com y Sofascore (403), Tennis Abstract y tennis-data.co.uk (su `robots.txt` lo prohíbe),
  Sackmann (el repositorio ya no existe), Ultimate Tennis Statistics (se quedó en 2024).

## Estadísticas del partido (`server/services/tennis/matchstats.js`, `src/components/TennisMatchStats.tsx`)

Bajo el marcador, en *Marcador*: aces, dobles faltas, primer saque dentro, puntos ganados con el primero y con el segundo, bolas de
break salvadas y convertidas, juegos al saque y puntos ganados, de los dos jugadores, con selector *Partido / Set N* si hay sets.
`GET /api/tennis/match-stats?tour&date&state&a&b` (nombres como los da ESPN). **ESPN no tiene estadísticas de partido de tenis**
(`statsSource: none`). Fuentes, por este orden:

- **WTA:** la API de su web oficial (`api.wtatennis.com/tennis/tournaments/<torneo>/<año>/matches/<partido>/stats`, la misma de los
  puntos en directo; su robots.txt no pone límites). En directo (se renueva cada minuto) y al acabar, por sets y con lo que duró
  cada uno. El partido se busca por apellidos (`samePlayer` de `points.js`) en los torneos de esos días.
- **TennisMyLife** (ATP y WTA, sólo partidos acabados): las mismas columnas que usa la forma (`w_ace`, `w_1stIn`, `w_bpFaced`…), del
  partido entero. Su fichero del año se actualiza cada semana y el de torneos en curso (`ongoing_tourneys.csv`) a diario, así que en la
  ATP salen al día siguiente o unos días después, según el torneo.

No hay ninguna fuente permitida que dé las de la ATP al acabar: la web de la ATP tiene el muro anti-bots de Cloudflare y LiveScore
las tiene, pero su robots.txt prohíbe `/api/` y se decidió (noviembre de 2026, con la web ya pública) no ampliar su uso para esto.
Sin estadísticas, el panel lo dice y lleva a *Forma de los jugadores*.

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
  partidos agrupados por torneo (los Grand Slam primero). En juego, cada fila enseña sets ganados, juegos del set y puntos del juego. La ficha tiene marcador grande (sets ganados) y las pestañas
  *Marcador* (set a set con tie-breaks, puntos del juego y quién saca), *Cuotas* y *Forma de los jugadores* (ranking y últimos partidos).
- *Jugadores*: rankings de la ATP y la WTA con buscador por nombre o país y la subida o bajada de cada jugador. Al pulsar
  uno se abre su ficha (`src/components/TennisPlayerSheet.tsx`), que también se abre desde *Forma de los jugadores*.
  Esa pestaña enseña además los enfrentamientos recientes entre los dos.

## Pendiente

- Dobles: no se muestran.

## Recomendaciones (`server/services/tennis/model.js` y `picks.js`, `src/lib/tennis-picks.ts`, `src/components/TennisPicks.tsx`)

Igual que en el baloncesto, en la ATP y la WTA (los Challenger tienen su propio motor, arriba). Hay tres sitios:

- La pestaña *Recomendaciones* de cada partido sin empezar.
- La pantalla *Recomendaciones*, que se abre con el selector *Partidos / Recomendaciones* de arriba (se entra siempre en *Partidos*). Junta los partidos con cuotas de las próximas 24 horas o de un día, y se puede quedar en la ATP, en la WTA o en un solo partido. En pantallas anchas, la más fiable y las más fiables del día van en una columna al lado, y en el centro quedan los filtros y las tres listas.
- La banda *Las más fiables del día* de la lista, con la más fiable de cada partido y el enlace a la pantalla.

Las tres usan el mismo tablero:

- **Filtros:** tipo de apuesta (ganador, hándicap de juegos, total de juegos, sets, saque y primeros juegos, aces u otras), partido entero o un set suelto, cuota mínima (1,15 por defecto) y *Sólo con valor*. Se guardan en `localStorage` (`tennis-picks`).
- **Orden:** por probabilidad (por defecto) o por valor.
- **Contenido:** la más fiable y tres listas.
- **Al pulsar:** una recomendación de la pantalla abre su partido, y la cuota la manda al cupón.

Rutas:

- `GET /api/tennis/picks?date=&id=`: un partido.
- `GET /api/tennis/picks/board?date=`: los partidos sin empezar de un día, sin la previa ni los cruces sin rival. Devuelve también los que aún no tienen cuotas. Se guarda un minuto.
- `GET /api/tennis/picks/day?date=`: de cada partido del tablero, la más fiable y la más complicada según el servicio (la usaba la portada *Hoy*, ya quitada).

Cada partido trae también `top`, `easy` y `hard`: la selección de siempre del servicio (la más fiable, tres fáciles y tres complicadas, de familias distintas). Son las que se registran para medir el acierto (`src/lib/predictions.ts`), sea cual sea el filtro que se esté mirando.

El servicio pide las cuotas a `odds` (`quiet: true`: sólo lee) y devuelve todas las líneas que no descarta. La interfaz las filtra y las reparte (`src/lib/tennis-picks.ts`).

**Modelo.** Sale de los CSV de TennisMyLife, reproducidos en orden y sin mirar nunca al futuro:

- Elo general y por superficie (la retirada no cuenta) y puntos al saque y al resto *por encima de la media de cada condición*, con los partidos recientes pesando más y corregidos por el rival. Pista dura bajo techo es una condición propia: mezclarlas daba 0,7 juegos de menos bajo techo y 1,4 en hierba.
- `logit(p) = wElo·logit(Elo) + wStats·logit(estadísticas)`, con pesos por circuito aprendidos con 2024.
- Punto → juego → set → partido se calcula exacto, promediando la forma del día (`formSd`). De esa distribución salen ganador, sets, hándicaps, totales, juegos de cada jugador, sets sueltos, tie-break, resultado exacto, set a cero, par o impar y combinaciones.
- Con el saque de cada uno (`holdProb`, `gameScores`, `afterGames`, `firstBreakA`) salen el primer juego al saque de cada jugador y su marcador exacto, cómo van tras 2, 4 o 6 juegos y quién rompe primero. Quién saca primero no se sabe: mitad y mitad.
- **Aces** (`aceRates`, `acesTail`): aces por punto al saque de cada jugador frente a los esperados ante sus rivales, y los que le hacen al resto, sobre la media de la pista; los partidos recientes pesan más (`aceHalfLife`) y con poca muestra manda la media (`acePrior`). Los puntos al saque salen del largo del partido. Para cada largo, una binomial negativa (`aceSize`), y una corrección de la media por circuito (`aceScale`). Los "Total de aces (logros)" de Winamax no se usan: sus cuotas no son las de un partido (a Sabalenka, que hace 4 o 5 de media, le daban un 58 % de llegar a 10), y parecen del torneo entero.

**Mezcla con la casa.** La probabilidad final mezcla modelo y casa sin margen en logit: 25 % el modelo (10 % con poca muestra), y menos cuanto mayor es la discrepancia. Ese 25 % es una decisión, no una medida: no hay cuotas históricas gratuitas con las que ajustarlo. Los partidos se recalculan con la probabilidad final para que todos los mercados cuadren.

**Selección.** El servicio descarta lo que nunca se recomienda:

- discrepa de la casa en más de 20 puntos;
- cuota fuera de 1,15-15;
- probabilidad < 15 %;
- valor < −12 %;
- fiabilidad < 35.

Del resto, en la interfaz:

- *La más fiable*: probabilidad ≥ 60 %, fiabilidad ≥ 50, valor ≥ −7 %. Se ordena por probabilidad + valor, y un set suelto cuenta algo menos. Puede no haber ninguna.
- *Más fáciles*: probabilidad ≥ 60 %, valor ≥ −10 % y fiabilidad ≥ 40.
- *Equilibradas*: probabilidad de 45 a 60 %, con los mismos mínimos.
- *Más complicadas*: probabilidad < 45 % y cuota ≥ 2,20. Contra el favorito, sólo con valor ≥ 3 %.
- *Con valor*: valor ≥ 2 % y fiabilidad ≥ 55, lo mismo que en el baloncesto.
- Repeticiones: con *Todo* sale una línea por tipo de mercado y partido. Con un tipo elegido salen todas sus líneas, para compararlas. En la pantalla de varios partidos, como mucho dos de cada partido por lista.
- Fiabilidad 0-100: datos de los jugadores, acuerdo modelo-casa sobre el ganador, tipo de mercado y cuotas. Se descarta lo que discrepa más de 20 puntos de la casa: suele ser un mercado mal leído o algo que el modelo no sabe.

**Comprobación** (`node server/services/tennis/backtest.js <carpeta CSV> atp|wta 20250101`). Sobre partidos de 2025 y 2026, no usados para ajustar:

| | ATP (5.276) | WTA (4.798) |
|---|---|---|
| Brier del ranking | 0,2212 | 0,2187 |
| Brier del Elo | 0,2218 | 0,2153 |
| Brier del modelo | 0,2145 | 0,2090 |
| Dice 75 % → pasa | 73,4 % | 75,1 % |
| Dice 84 % → pasa | 82,4 % | 84,9 % |
| Juegos por partido: real / modelo | 26,05 / 26,11 | 22,04 / 22,11 |

Aces (2025-2026; los parámetros, con 2024):

| | ATP | WTA |
|---|---|---|
| Aces por partido: real / modelo | 13,65 / 13,87 | 5,82 / 5,98 |
| Un jugador, "k o más": dice 55 % → pasa | 56,5 % | 54,9 % |
| Entre los dos: dice 75 % → pasa | 75,5 % | 71,9 % |

En la WTA se pasa algo de confiado en lo más alto. Set a cero (ATP): dice 13 % → pasa 12 %.

Los pesos y `formSd` se ajustaron sólo con 2024, pero el sesgo bajo techo y en hierba se vio mirando 2025-26, así que esta comprobación no es del todo ciega. Queda algo de sesgo en hierba (ATP: 24,97 juegos reales, 24,34 del modelo).

Dice si las probabilidades son correctas, **no si se gana dinero**: para eso harían falta cuotas de cierre históricas. El margen medido de las casas es de un 3-4 % en el ganador y de un 8-10 % en los mercados secundarios, así que casi nada sale con valor positivo. Sin modelar todavía: dobles faltas, lesiones y cansancio. El primer juego al saque, los primeros juegos y el primer break no se pueden comprobar con el marcador final de los CSV: en la fiabilidad cuentan menos (`trustOf`). Sólo hay partidos del circuito principal: los jugadores de WTA 125 e ITF salen sin histórico y mandan las casas.

### Cansancio y actividad reciente: medido, no añadido (noviembre de 2026)

`server/services/tennis/backtest-contexto.js` (`docker compose exec tennis node services/tennis/backtest-contexto.js atp|wta 20240601`) mira, para cada partido
desde junio de 2024 (unos 7.000 por circuito, en dos mitades), cuántos minutos había jugado cada uno y compara lo que pasó con lo que daba el modelo.
- **Minutos ya jugados en el mismo torneo** (rondas anteriores): no hay efecto. Los residuos van de −2,6 a +3,8 puntos sin patrón, dentro del error (±2-3).
- **Minutos del torneo anterior (menos de 14 días antes):** el efecto sale al revés que el cansancio. El que más ha jugado rinde unos 3 puntos **por encima**
  del modelo (con 3 h o más de diferencia: ATP +3,8 y +2,3, WTA +4,4 y +0,7 en las dos mitades; el que ha jugado menos, −2 a −5). Es de esperar:
  haber jugado mucho es haber llegado lejos, y el Elo va con retraso. No es cansancio, es forma.
- **Si se añadiera** (β·diferencia de horas/3 al logit, β ≈ 0,12-0,15, estable entre mitades y circuitos), ajustado con una mitad y comprobado en la otra baja el log-loss
  sólo 0,0007-0,0016 (de 0,614 a 0,613 en la ATP). Es una mejora real pero casi nula, y exigiría sacar los minutos de cada jugador al predecir.
**No se añade al modelo.** Si algún día se retoma, hay que verlo como forma reciente, no como cansancio.

