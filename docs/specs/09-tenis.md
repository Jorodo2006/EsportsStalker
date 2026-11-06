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

## ATP Challenger (`server/services/tennis/livescore.js`)

ESPN no los trae (de la ATP sólo el torneo principal). Salen de la API de la app de LiveScore (`prod-public-api.livescore.com/v1/api/app/date/tennis/<AAAAMMDD>/0`) y entran en
`GET /api/tennis/games`, `/days` y `/live` con `level: 'challenger'`, `tour: 'atp'` e id `ch:<Eid>`. Se pueden ocultar con el interruptor *Challenger*.

- **Por qué esta fuente:** el `robots.txt` de la web de LiveScore prohíbe `/api/` y sus condiciones no se pudieron leer (la página no se carga sin JavaScript). Su servidor de datos no tiene `robots.txt`. **Se decidió usarla el 5/11/2026, a petición del usuario y para uso personal**, a sabiendas de que
  Tennis Abstract y tennis-data.co.uk se descartaron por su `robots.txt`. Las peticiones van sin disfrazar. **Si la app se fuese a vender o a publicar, hay que volver a mirarlo.**
- **Sólo marcador y cuotas:** sin *Recomendaciones* ni *Forma de los jugadores*, porque ni el modelo (TennisMyLife) ni las fichas (ESPN) tienen sus datos. No hay banderas, ranking ni cabezas de serie.
- **Cuotas:** las lecturas programadas no los miran (`scheduler.js`): son decenas al día y leer de más puede hacer que las casas bloqueen. Se pueden pedir con *Actualizar cuotas*, si las casas los tienen.
- **Códigos:** `Eps` es el estado (`NS`, `S1`-`S5`, `FT`, `Ret.`, `W.O.`, `Canc.`, que no se enseña). `ErnInf` es la ronda: `4xxx` dieciseisavos, `5xxx` octavos, `6xxx` cuartos, `7xxx` semifinales y `final`, deducidos contando los partidos de cada código. La previa va en el nombre (`: Qualification`).

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

- No hay modelo de valor para el tenis (habría que estimar la probabilidad de ganar con el ranking o un Elo).
- Dobles: no se muestran.

## Recomendaciones (`server/services/tennis/model.js` y `picks.js`, `src/components/TennisPicks.tsx`)

Pestaña *Recomendaciones* de cada partido sin empezar y banda *Las más fiables del día* en la lista. `GET /api/tennis/picks?date=&id=` y `GET /api/tennis/picks/day?date=`; el servicio pide las cuotas a `odds` (`quiet: true`: sólo lee).

**Modelo.** Sale de los CSV de TennisMyLife, reproducidos en orden y sin mirar nunca al futuro:

- Elo general y por superficie (la retirada no cuenta) y puntos al saque y al resto *por encima de la media de cada condición*, con los partidos recientes pesando más y corregidos por el rival. Pista dura bajo techo es una condición propia: mezclarlas daba 0,7 juegos de menos bajo techo y 1,4 en hierba.
- `logit(p) = wElo·logit(Elo) + wStats·logit(estadísticas)`, con pesos por circuito aprendidos con 2024.
- Punto → juego → set → partido se calcula exacto, promediando la forma del día (`formSd`). De esa distribución salen ganador, sets, hándicaps, totales, juegos de cada jugador, sets sueltos, tie-break y combinaciones.

**Mezcla con la casa.** La probabilidad final mezcla modelo y casa sin margen en logit: 25 % el modelo (10 % con poca muestra), y menos cuanto mayor es la discrepancia. Ese 25 % es una decisión, no una medida: no hay cuotas históricas gratuitas con las que ajustarlo. Los partidos se recalculan con la probabilidad final para que todos los mercados cuadren.

**Selección.**

- *La más fiable*: probabilidad ≥ 60 %, cuota ≥ 1,15, fiabilidad ≥ 50, valor ≥ −7 %. Se ordena por probabilidad + valor. Puede no haber ninguna.
- *Más fáciles*: probabilidad ≥ 60 %, por valor, sin repetir tipo de mercado.
- *Más complicadas*: probabilidad entre 15 y 45 %, cuota de 2,20 a 15. Contra el favorito sólo con valor ≥ 3 %.
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

Los pesos y `formSd` se ajustaron sólo con 2024, pero el sesgo bajo techo y en hierba se vio mirando 2025-26, así que esta comprobación no es del todo ciega. Queda algo de sesgo en hierba (ATP: 24,97 juegos reales, 24,34 del modelo).

Dice si las probabilidades son correctas, **no si se gana dinero**: para eso harían falta cuotas de cierre históricas. El margen medido de las casas es de un 3-4 % en el ganador y de un 8-10 % en los mercados secundarios, así que casi nada sale con valor positivo. Sin modelar todavía: aces, roturas, primeros juegos, lesiones y cansancio. Sólo hay partidos del circuito principal: los jugadores de WTA 125 e ITF salen sin histórico y mandan las casas.
