# MMA (UFC, PFL y WOW)

Quinta app de Sharpex (acento rojo apagado, `data-app="mma"`). Combates, luchadores, previsión de victoria, cuotas de
Winamax y Betway, cupón y registro de apuestas con resolución automática. Servicio `mma` (puerto 4007, esquema `mma`).
Diseño y plan: `docs/superpowers/specs/2026-11-13-mma-design.md` y `docs/superpowers/plans/2026-11-13-mma.md`.

## Fuentes (todas gratuitas)

| Organización | Fuente | Qué da |
|---|---|---|
| UFC (`ufc`) y PFL (`pfl`) | API pública de ESPN: `site.api.espn.com/apis/site/v2/sports/mma/<org>/scoreboard` y `sports.core.api.espn.com/v2/sports/mma/leagues/<org>/events/<evento>/competitions/<combate>/status` | Carteleras, combates por categoría de peso, récord de cada luchador, ganador, y (sólo del endpoint de estado) método, asalto y tiempo |
| WOW (`wow`) | `wowmma.com` (Webflow, sin API): `/sitemap.xml`, `/wow-events/<slug>` | Evento (nombre, fecha, ciudad), combates profesionales con lado rojo/azul, edad, peso, altura, récord, categoría y, en los pasados, ganador, método, asalto y tiempo |

- **ESPN** no da el método en el marcador: `espn.js` lo pide al endpoint de estado de cada combate terminado y la caché
  (`cachedJSON`) lo guarda una semana. Los combates vienen **en orden de cartelera: el último es el principal** (`cardPos` 1).
  El primer competidor (`order` 1) es la esquina roja (`a`). ESPN no marca los títulos (`title` sólo si el texto del tipo lo dice).
- **WOW** (`wow.js`): su `robots.txt` permite rastrear todo salvo `/*?*`: **nunca se piden URLs con parámetros** (el slug se
  valida con `^wow-\d+[a-z0-9-]*$`). User-Agent propio, peticiones de una en una, caché en memoria (30 min eventos futuros, 24 h
  los jugados). La web no da la hora del evento (se pone 19:00 UTC) ni los asaltos programados (se supone 3). La cartelera se
  publica tarde. Si la web cambia de diseño, el lector devuelve vacío y el resto de MMA sigue funcionando (el error sale en el log).
- Las organizaciones son una lista (`espn.ORGS` y `LEAGUES` en `index.js`): añadir otra de ESPN (Bellator, KSW…) es una línea.

## Rutas (`/api/mma/…`)

`leagues`, `games?date=`, `days?from=&n=`, `live`, `match?id=[&date=]`, `fighter?id=`, `profile?id=` (sólo ESPN: edad, altura, alcance, peso,
guardia, KO y sumisiones ganados, golpes por minuto y derribos), `ranking`, `picks?date=&id=`, `picks/day?date=`, `search?q=`. Los días son de hora de España (`dates.js`): un combate de madrugada pertenece a su día de
Madrid. Un combate se identifica con `<org>:<id de ESPN>` o `wow:<slug>:<luchador A>-vs-<luchador B>` (**no** por su posición en la página: si WOW
añade o quita un combate, los demás conservan el id). `match` acepta el día (`date`) para mirar sólo ese día y los dos de al lado; sin él, dos
meses a cada lado.

Un combate (`MmaFight`): `{ id, org, orgName, event, eventId, date, state, status, weightClass, title, rounds, cardPos, venue, city, cancelled?, a, b, result? }`
con `result = { winner: 'a'|'b'|null, method: 'ko'|'sub'|'dec'|'other'|'', round, time, draw, noContest }`. Los cancelados
o aplazados llevan `cancelled: true` y no traen resultado.

## Modelo (`model.js`, `history.js`, `backtest.js`)

Un **Elo propio** recorriendo los combates por fecha: sólo cuentan los terminados con ganador (empates, anulados y
pendientes no mueven nada; un luchador sustituido empieza de cero). K = `K0 + K1/(1+combates)`. Ajustes pequeños: el récord
pesa `1/(1+combates)^1,5` (casi sólo en debutantes), −4 puntos por año desde los 35 (sólo WOW da la edad) y −1 punto por cada
12 días sin pelear pasados 18 meses. De él salen la probabilidad de victoria, la de cada **método** (KO/TKO, sumisión, decisión
por luchador) y la de **llegar a decisión**; `pOver` da la probabilidad de que dure más de N minutos (asaltos de 5).

- **Historial** (`history.js`): ESPN por trimestres desde 2016 (unos 7.000 combates), guardado reducido en `mma.cache` con clave
  `hist:` (no se borra con la limpieza: el pasado no cambia), más los eventos de WOW. La primera carga son unas 90 peticiones.
- **Prueba** (`docker compose exec mma node services/mma/backtest.js`, 13-nov-2026): se predice cada combate sólo con lo anterior;
  parámetros ajustados con 2019-01 a 2024-06 y comprobados con 2024-07 en adelante (1.827 combates):

  | | Brier | log-loss | acierto |
  |---|---|---|---|
  | Todos | 0,2406 | 0,6737 | 57,6 % |
  | ≥3 combates previos de cada uno | 0,2375 | 0,6674 | 58,6 % |
  | UFC / PFL / WOW | 0,2403 / 0,2416 / 0,2420 | | 57,2 / 57,1 / 64,9 % |

  Calibración (favorito): 50-55 % → pasó 52,8 %; 55-60 % → 58,0 %; 60-65 % → 60,6 %; 65-70 % → 65,3 %; 70-80 % → 80,3 %.
  Una moneda es Brier 0,25 y log-loss 0,693; las casas rondan 0,21-0,22 y 0,62-0,63. **El modelo está bien calibrado pero
  discrimina poco**: por eso las recomendaciones lo mezclan con la casa con poco peso (8-25 %).
- **Límites**: la prueba no usa el récord del marcador (no se sabe si es de antes o de después del combate) ni el método (ESPN
  no lo da); los porcentajes de método (`BASE` en `model.js`) son a priori, sin medir. WOW es el más flojo: sólo 114 combates
  de prueba y su fiabilidad no pasa de "media".

## Cuotas (Winamax y Betway)

- **Winamax**: deporte `117` (UFC = categoría 1089, PFL = 1095; los torneos se llaman "UFC 334: …", "PFL Dubai"). El lector (`runner.js`,
  `SPORT_CFG.mma`) busca por `tours` (`ufc`/`pfl`/`wow`) en el estado de la portada o por el socket.
- **Betway**: grupos `grp/ufc---martial-arts/upcoming-fights/<ufc-NNN | ufc-fight-night | pfl>` (el cartel sale del `event` del
  combate; `bridge.js` lo conserva en el trabajo). Si no hay grupo, la categoría `cat/ufc---martial-arts`.
- **Normalizador** (`winamaxMmaInto`, `betwayMmaInto` en `odds.js`), claves estables que usan las recomendaciones y la resolución:

  | Clave | Selecciones | Winamax | Betway |
  |---|---|---|---|
  | `moneyline\|0\|\|` | `a`, `b` | Ganador | Ganador del Combate |
  | `method\|0\|<ko\|sub\|dec>\|` | `a`, `b` | Ganador y método de victoria | Método de victoria |
  | `distance\|0\|\|` | `yes`, `no` | El combate llegará al final | El combate terminará en empate o se decidirá por puntos |
  | `total_rounds\|0\|\|<línea>` | `over`, `under` | Número total de asaltos | Total de asaltos - N |

  Lo demás (asalto exacto, doble oportunidad, método y ronda…) sale como mercado propio de cada casa (período `50`, pestaña "Otros").
  Si la página no trae a los dos luchadores del combate (un sustituto, otra pelea), **no se mezcla** (devuelve 0 mercados).
- **Emparejado de luchadores** (`server/shared/fighters.js`, `mentions`): exige **apellido y nombre** (o su inicial, un prefijo, o una variante a 2 letras, "Charlie"/"Charles"); el apellido solo no basta ("Silva" o "Rodriguez" son de muchos). Lo usan el normalizador (`mmaSide`, orientación de Winamax: si no coinciden los dos luchadores, 0 mercados), el resolvedor y, en versión equivalente dentro de la página, `winamaxFind` del lector (deporte 117). Antes, en `equipos.js`: sin tildes ("Uroš Medić" / "Uros Medic"), con los `alt` de cada luchador ("Topuria",
  "Topuria I.") y con una errata de una letra en el apellido si coincide la inicial ("Charlie Radke" / "Charles Radtke"; también en
  `winamaxFind` del lector). Si una casa llama distinto a un luchador, el trabajo termina con "No encuentro el partido".
- **Programador** (`scheduler.js`, `upcomingMma`): como tenis y fútbol (`CROWDED`). WOW no está en las listas de Betway ni, hasta ahora,
  de Winamax: el trabajo termina con error visible.
- **No hay lector de reserva** (marcador / extensión de Chrome) para MMA: sólo el contenedor `lector`.

## Resolución de apuestas (`bets/settle.js`)

`mmaResult` pide `/api/mma/match` (con el día de la apuesta). **Antes de resolver se comprueba que el cartel de la apuesta ("A vs B") son los
dos luchadores del resultado** (`fightMatches`, con `server/shared/fighters.js`): si un id cambia de combate, la apuesta no se resuelve con el
resultado de otro. `evaluateMma` resuelve ganador, método, "llega a decisión" y total de asaltos
(`(asalto−1)×5 + tiempo` frente a `línea×5`; línea exacta = nula). **Empate, sin resultado, cancelado, método desconocido o
descalificación o decisión técnica (`other`) se quedan pendientes** para hacerlo a mano: cada casa los paga a su manera. Migración `011_mma.sql`
(`sport` admite `mma` en `bets.bets` y `bets.bet_legs`). Las recomendaciones del día se registran en `bets.predictions` (`mmaPredictions`).

## Interfaz

`MmaFights` (lista por evento con el principal arriba, filtros UFC/PFL/WOW, ficha con Comparativa / Recomendaciones / Cuotas),
`MmaSpotlight` (el cara a cara de la ficha: fotos a los lados y tabla central con edad, récord, altura, alcance, KO/TKO, sumisiones, decisiones, golpes/min, derribos y Elo; ESPN trae las medidas y el estilo de su ficha y WOW lo que da su web; el que va por delante, con el acento), `MmaFighters` (ranking por Elo del modelo, no oficial: activos con ≥5 combates en los últimos 18 meses), `MmaFighterSheet`,
`MmaPicks`, `mma.tsx`. En **Hoy** entra el combate principal de cada cartel (`mmaScore`: base UFC 40, PFL 35, WOW 30; principal +25
(WOW +35), co-principal +10, cinco asaltos +20) y sus recomendaciones. Mercados para el formulario de apuesta: `MMA_MARKETS`.

## Revisión final

Un revisor independiente encontró y se corrigió (con test): resolución contra el combate equivocado (ids de WOW por posición), combates de WOW sin
fecha que rompían los días de UFC y PFL, WOW lento que bloqueaba todo (ahora tope de 4 s y sirve lo caducado mientras renueva), decisión técnica
resuelta como decisión, cruce de luchadores con el mismo apellido, y la descarga de ±60 días en cada ficha. Menores corregidos: trimestres
vacíos de ESPN no se guardan, el método vacío no se cachea una semana, la hora sale en hora de Madrid y WOW muestra "Hora por confirmar".

## Pendientes conocidos

- Móvil (375 px): no comprobado en pantalla con el navegador (viewport fijo); las piezas son las de las otras apps, con tablas en `overflow-x-auto`.
- La columna "Prob." del comparador normaliza los mercados de método como si A+B sumaran 100 %; las recomendaciones no (usan margen supuesto).
- El marcador de ESPN no da el método de cada victoria: la ficha del luchador sólo lo cuenta en WOW (la ficha de ESPN sí da KO y sumisiones ganados en el cara a cara).
- La pestaña WOW del ranking sale casi vacía (pide ≥5 combates y WOW tiene pocos por luchador).
- Si cambia de orden o desaparece un combate con recomendaciones abiertas, la pestaña abierta sigue pintándose hasta cerrarla.
- Sin cuotas históricas gratuitas no se puede comprobar si las recomendaciones dan dinero a la larga.
