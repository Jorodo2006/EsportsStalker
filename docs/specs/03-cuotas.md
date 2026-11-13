# 03 · Cuotas

**Regla:** no se usa ninguna API de cuotas. Las cuotas se leen de las páginas de **Winamax y Betway** y llegan al
backend por el gateway (`127.0.0.1:47365`). Se pueden leer a mano (botón *Actualizar cuotas*) o solas (lecturas
programadas, de LoL, baloncesto y tenis). Todo lo leído se guarda en PostgreSQL.

> **Desde la 0.4** las lee el contenedor `lector` (`server/lector/runner.js`): un Chromium sin cabeza dentro de Docker
> que hace lo mismo que la extensión (buscar el partido, abrir sus pestañas, pasar `marcador.js` y mandar el resultado),
> sin abrir el Chrome del usuario. No usa trucos anti-bot. Bet365 se quitó porque no se deja leer así. El marcador y la
> extensión de más abajo siguen funcionando como reserva. Cada trabajo lleva `match.sport` (`basket` o, sin él, LoL) y
> `match.league`, que eligen dónde se busca el partido; el normalizador usa `winamaxBasketInto` para el baloncesto.
> MMA (UFC, PFL y WOW): ver [12-mma.md](12-mma.md) (`winamaxMmaInto` y `betwayMmaInto`, claves de mercado y emparejado de luchadores; sin lector de reserva).

## Piezas

| Pieza | Fichero | Papel |
|---|---|---|
| Servidor puente | `server/services/odds/bridge.js` (detrás del gateway en `127.0.0.1:47365`) | Guarda las importaciones durante 6 h en `odds.imports` y el histórico en `odds.price_history`, lleva los trabajos y las direcciones aprendidas |
| Programador | `server/services/odds/scheduler.js` | Crea trabajos para los partidos próximos, más seguidos cuanto más cerca están |
| Lector (marcador) | `chrome/bookmarklet/marcador.js` | Lee la página de la casa abierta. Funciona como bookmarklet o inyectado por la extensión |
| Extensión Chrome MV3 | `chrome/extension/` (`manifest.json`, `background.js`, `pagina.js`) | Hace los trabajos: abre las casas en pestañas de fondo, busca el partido, lo lee y cierra |
| Normalizador | `server/services/odds/odds.js` (+ `equipos.js`) | Convierte lo recibido en filas comparables entre casas, cuota de ganador e histórico |
| Generador | `scripts/extension.js` (`npm run extension`), `src/lib/api.ts` | Copia la extensión a `extension-chrome/`; el enlace del marcador se genera en la web |
| Interfaz | `src/views/MatchDetail.tsx`, `src/components/BookIcon.tsx` | Comparador por columnas |

## Servidor puente (`bridge.js`, servicio `odds`)

| Ruta | Uso |
|---|---|
| `POST /odds` | Cuotas leídas (marcador o extensión). Se asignan a un partido por los equipos de la página; si no, al último partido abierto en la app |
| `POST /snapshot` | Foto de la página, que se guarda como `capturas/captura-<casa>-<nombre>.json` para ajustar lectores |
| `POST /auto/progress` | Progreso de la extensión por casa (`{ id, book, estado, msg }`) |
| `GET /ping` | Comprobación |
| `GET /auto?job=ID` | Página que abre la app en Chrome; la extensión la detecta (`pagina.js`) y empieza el trabajo |
| `GET /auto/job?id=` | La extensión recoge el trabajo (lo marca como cogido) y las URLs conocidas |
| `GET /auto/status?id=` | Estado del trabajo para la página `/auto` |
| `GET /jobs/next` | La extensión pregunta si hay trabajo (cada 30 s); coge el más antiguo, primero los manuales. `204` si no hay |

- **Trabajos** (`odds.jobs`). `source` es `manual` (botón) o `auto` (programado). Si en 15 s ninguna extensión coge un
  manual, se marca `sin extensión` y la app avisa de que hay que instalarla. Los programados esperan 10 min en cola;
  uno cogido que no termina en 15 min se cierra con error.
- **Importaciones.** Cada una se reemplaza por casa + partido + página (`payload.page`; si no viene, por mapa). Las
  importaciones de varias páginas de una misma casa se suman.
- **Direcciones aprendidas.** La dirección de cada partido en cada casa se guarda en `odds.book_urls`, así la
  próxima vez se va directo.
- **Tras cada importación** (`afterImport` en `odds.js`): se guarda la cuota de ganador en `odds.imports.ml` (para las
  tarjetas del calendario) y se actualiza `odds.price_history`.
- **Histórico** (`odds.price_history`, se guarda 365 días). Cada fila es un tramo: la cuota valió `price` desde `ts`
  hasta `last_seen`. Si una lectura ve la misma cuota, alarga `last_seen`; si cambia, abre otra fila. Así el `last_seen`
  más nuevo antes de `match_start` da la cuota de cierre, y una cuota cuyo `last_seen` se queda atrás es que la casa la
  ha quitado. `match_start` separa las revanchas (misma pareja con el inicio a más de 12 h). `POST /api/odds/history`
  con `{ match }` devuelve los tramos de un partido, del más antiguo al más nuevo.
- **Generación de la extensión.** `npm run extension` (`scripts/extension.js`) copia la extensión a `extension-chrome/`,
  pone el puerto y genera `lector.js` a partir de `marcador.js`.

## Lecturas programadas (`scheduler.js`)

- Cada minuto: limpia lo caducado y, si `oddsAutoEnabled`, pide el calendario de los tres deportes y se queda con los
  partidos **sin empezar**, con los dos equipos conocidos (sin TBD). No se leen partidos en directo.
- Frecuencia según lo que falte para el partido:

  | Falta | Se lee cada |
  |---|---|
  | Hasta `oddsAutoHours` (tenis: hasta 3 h como mucho) | `oddsRefreshMinutes` min |
  | Hasta 24 h | 60 min (tenis: 180 min) |
  | Hasta 48 h (tenis: no entra) | 180 min |

  Los dos tramos lejanos se apagan con `oddsFarEnabled`. Si `oddsRefreshMinutes` es mayor, manda ese valor.
- **Challenger** (sólo cuadro final, con `challengerOddsEnabled`): no siguen la tabla. Una lectura cuando faltan 12 h o
  menos (una al día) y la de cierre a 20 min de la hora prevista; si sigue sin empezar, cada 40 min hasta 5 h después.
  Van en su propio turno: el cierre con los cercanos y la de la mañana con los lejanos. Lo leído lo usa el motor de
  los Challenger (`/api/challenger/comparar`) para medirse con la casa.
- Crea un trabajo `auto` para cada uno que no tenga un trabajo abierto ni uno (manual o programado) de hace menos de
  lo que le toque, sin pasar de **10 en cola**. Entran primero los cercanos y luego los lejanos, y en cada grupo por
  turnos entre deportes, para que el tenis no deje sin sitio al baloncesto, que suele jugarse de noche.
- El lector hace **uno cada vez** (unos 35 s de media, unas 100 lecturas por hora): primero los manuales y luego el que
  empieza antes. Si no da abasto, lo que se retrasa son los partidos lejanos.
- `GET /api/odds/auto/status` da el estado para *Ajustes → Cuotas automáticas*: partidos cercanos, cuántos hay más
  adelante (`far`), cola, última pasada y última vez que el lector preguntó (`lastPoll`).

## Extensión (`background.js`)

1. Los trabajos llegan de dos formas:
   - **manual**: `pagina.js` corre en `http://127.0.0.1/*`, lee el id del trabajo de la página `/auto` y avisa al service worker;
   - **programado**: una alarma (`chrome.alarms`, cada 30 s) llama a `poll()`, que pide `GET /jobs/next` si no hay otro
     trabajo en marcha. Al acabar uno, vuelve a preguntar.
2. `runJob` pide el trabajo y lanza las tres casas en paralelo. Cada una se abre en una pestaña de fondo (`openTab`).
3. Cuando encuentra el partido, inyecta `lector.js` en el mundo `MAIN` con `window.__lolet_job`. El lector deja
   el resultado en `window.__lolet_fin = { ok, txt, payload }` y la foto en `window.__lolet_snap`; el service worker
   los manda a `/odds` y `/snapshot`.
4. Informa del progreso por casa y cierra las pestañas.

### Por casa

- **Winamax**:
  - lee los torneos de LoL del `PRELOADED_STATE` de la página;
  - busca el partido en su socket (`winamaxFind`) y abre `/match/ID`;
  - allí el lector pide el partido al socket y manda todos los mercados.
- **Betway**:
  - parte de `cat/esports`; la fila del partido tiene `data-eventid`;
  - si no está en esa portada, prueba las competiciones de esports, primero las de LoL;
  - en el evento recorre cada grupo (`data-navitemid`: `main-markets`, `map-1`, `map-1---player-specials`…) con `?marketGroup=`;
  - el lector despliega las secciones cerradas y lee cada tabla.
- **Bet365**:
  - entra por `#/AS/B151/` (eSports), pulsa la competición de LoL y luego el partido;
  - recorre todas las pestañas (`nav button[aria-selected]`) y guarda una foto de cada una (`pestana-N`);
  - si sale *"No se puede mostrar este contenido"*, recarga la página entera (la dirección ya lleva la pestaña, `/I11/`,
    `/I2/`…) hasta 2 veces; la última pone la pestaña delante un momento (sólo en las lecturas manuales: en las programadas
    no se le quita la pestaña al usuario).

## Lector (`marcador.js`)

- Funciona en dos modos:
  - **Manual (bookmarklet)**: enseña una capa con el resultado. Si Chrome no deja enviar, copia las cuotas al
    portapapeles para usar *Pegar del marcador* en la app.
  - **AUTO**: con `window.__lolet_job` puesto, no envía nada y deja el resultado en `window.__lolet_fin`.
- **Líneas de jugador** (`sections`):
  - títulos tipo "Kills de X en el mapa 1", con Más/Menos y línea;
  - se excluyen los títulos con nombres de equipo (sacados de `[data-testid=event-name]`), para que "Total de kills - Gen G"
    no cuente como jugador;
  - alias de nombres de jugador, por ejemplo Gobernante → Ruler.
- **Resto de mercados de Betway y Bet365** (`markets`):
  - formato `{ title, map, line, outcomes: [{ name, hcap, price }] }`;
  - Betway: el mapa sale de `marketGroup=map-N`.
  - Bet365 (todas las pestañas menos *Jugador*): busca bloques cuyo título es su primera línea y que tienen cuotas.
    Si el bloque es una rejilla (cabecera con los dos equipos y filas "Ganará", "Hándicap de víctimas",
    "Total de víctimas") cada fila es un mercado y la selección es el equipo de la columna; si no, lee selecciones
    sueltas "Nombre  cuota". El mapa sale del título o de la pestaña activa ("1º mapa"); sin mapa es del partido.
  - En las líneas de jugador de Bet365 se saltan los títulos de equipo ("Hándicap…", "Total de víctimas" a secas).

## Normalización (`odds.js`)

- **`orient` / `teamScore`**: emparejan los equipos de la casa con los de lolesports (quitando "Esports", "Gaming",
  "Team"…) y dan la vuelta a las cuotas si la casa los pone al revés.
- **Clase `Book`**: acumula mercados por clave canónica `tipo|periodo|lado|línea`, para que la misma línea de casas
  distintas caiga en la misma fila.
  - `addStd` sirve para ganador, hándicap y totales (incluidos los totales por equipo).
  - Los mercados propios de una casa usan la clave `casa|título|línea`.
- **Entradas por casa**:
  - `winamaxInto`: estado del partido de Winamax;
  - `sectionsInto`: líneas de jugador de Bet365 y Betway;
  - `marketsInto`: mercados genéricos de Betway y Bet365. "Ganará" cuenta como ganador y "Total de víctimas" como
    total de kills, así caen en las mismas filas que Winamax y Betway.
- **Salidas**:
  - `getMatchOdds(match)` devuelve `{ books, markets, sources }`;
  - `getBoardFor(events)` da la mejor cuota de ganador para las tarjetas del calendario.

## Comparador (interfaz)

- **Barra de casas**: icono, estado de cada casa y progreso de *Actualizar cuotas*.
- **Pestañas de sección** fijas arriba: Todo, Partido, Mapa N, Jugadores y Otros.
- **Mercados plegables**: el estado se guarda en `localStorage` con la clave `oddsClosed`, y hay *Plegar/Desplegar todo*.
- **Columnas**: una fija por casa destacada (`featuredBooks`), con su icono. Para usar iconos reales, deja
  `bet365.png`, `winamax.png` y `betway.png` en `src/assets/books/`; si no están, se pinta una insignia con los colores de la marca.
- **Mejor cuota**: va en verde sólo si hay al menos 2 casas con precio. Se enseña también la probabilidad sin margen.
- **Líneas de jugador** (`PlayerLines`): tabla jugador × línea × casa (Más/Menos), con pestañas por estadística y buscador.
- **Valor de las líneas de jugador** (`src/lib/edge.ts`): columnas *Estimado* (probabilidad de Más / Menos) y *Valor*
  (valor esperado de la mejor cuota, `p × cuota − 1`). La cuota con valor de al menos un 3 % se marca en ámbar y hay un
  filtro *Sólo con valor*. Al pasar el ratón se ve la media, cuántas veces superó la línea, la probabilidad implícita de
  cada casa y la de ganar el mapa.
  - Datos: `GET /api/stats/team-form` (una consulta a Leaguepedia por equipo, últimas 20 partidas de cada jugador con
    ese equipo). El jugador de la casa se busca por nombre normalizado (sin acentos ni lo que va entre paréntesis).
  - Modelo: binomial negativa con la media ponderada (las partidas recientes pesan más) y la dispersión de sus partidas.
    Se mezcla la forma en victorias y en derrotas según la probabilidad sin margen de que su equipo gane el mapa (cuota
    de ganador del mapa o, si no hay, la de la serie convertida a un mapa). Líneas enteras: la nula devuelve la apuesta.
  - Sólo se estiman líneas de un mapa y jugadores con al menos 5 partidas. No tiene en cuenta rival, campeones ni parche:
    es una referencia, no una garantía.
  - Columna *Fiabilidad* (0-100) y veredicto con las funciones comunes con la NBA (`src/lib/value.ts`, ver
    [08-baloncesto.md](08-baloncesto.md)): partidas con su equipo (25), regularidad (20), margen sobre la línea (15), modelo frente a
    histórico (10), ajuste por ganador (15, sólo si hay cuota de ganador) y forma reciente (15, días desde su última
    partida). *Sólo con valor* deja las líneas con veredicto *Apostar* o *Valor ligero*.
  - Al pulsar una fila se despliega el panel de valor (`ValuePanel`): veredicto, probabilidad y cuota justa de cada
    lado, EV y ventaja de la mejor casa, margen, stake con ¼ de Kelly y desglose de la fiabilidad, con *Registrar* y
    *Combinada*.
- **Clic en una cuota**: abre la apuesta ya rellena.
- **Clic derecho o Mayús+clic**: añade la cuota al boleto de combinada (ver [05-apuestas.md](05-apuestas.md)).

## Pendiente conocido

- Bet365 a veces dice *"No se puede mostrar este contenido"* en las pestañas *Jugador* y *1º mapa*. Ahora se recarga
  la página; si sigue bloqueada, revisar `capturas/captura-bet365-pestana-N.json`.
- El lector de mercados generales de bet365 se ha escrito sin captura delante: si algún mercado no sale o sale mal,
  ajustarlo con `capturas/captura-bet365-pestana-1.json`.
