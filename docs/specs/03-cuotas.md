# 03 · Cuotas

**Regla:** no se usa ninguna API de cuotas. Las cuotas se leen de las páginas de **Bet365, Winamax y Betway** en el
Chrome normal del usuario, donde no hay bloqueos anti-bot, y llegan a la app por un servidor local.

## Piezas

| Pieza | Fichero | Papel |
|---|---|---|
| Servidor puente | `electron/services/bridge.js` | HTTP en `127.0.0.1:47365`; guarda las importaciones durante 3 h |
| Lector (marcador) | `electron/bookmarklet/marcador.js` | Lee la página de la casa abierta. Funciona como bookmarklet o inyectado por la extensión |
| Extensión Chrome MV3 | `electron/extension/` (`manifest.json`, `background.js`, `pagina.js`) | Botón *Actualizar cuotas*: abre las casas en pestañas de fondo, busca el partido, lo lee y cierra |
| Normalizador | `electron/services/odds.js` | Convierte lo recibido en filas comparables entre casas |
| Interfaz | `src/views/MatchDetail.tsx`, `src/components/BookIcon.tsx` | Comparador por columnas |

## Servidor puente (`bridge.js`)

| Ruta | Uso |
|---|---|
| `POST /odds` | Cuotas leídas (marcador o extensión). Se asignan a un partido por los equipos de la página; si no, al último partido abierto en la app |
| `POST /snapshot` | Foto de la página, que se guarda como `captura-<casa>-<nombre>.json` para ajustar lectores |
| `POST /auto/progress` | Progreso de la extensión por casa (`{ id, book, estado, msg }`) |
| `GET /ping` | Comprobación |
| `GET /auto?job=ID` | Página que abre la app en Chrome; la extensión la detecta (`pagina.js`) y empieza el trabajo |
| `GET /auto/job?id=` | La extensión recoge el trabajo (lo marca como cogido) y las URLs conocidas |
| `GET /auto/status?id=` | Estado del trabajo para la página `/auto` |

- **Trabajos.** Si en 15 s ninguna extensión coge el trabajo, se marca `sin extensión` y la app avisa de que hay que instalarla.
- **Importaciones.** Cada una se reemplaza por casa + partido + página (`payload.page`; si no viene, por mapa). Las
  importaciones de varias páginas de una misma casa se suman.
- **Direcciones aprendidas.** La dirección de cada partido en cada casa se guarda en `casas-urls.json`, así la
  próxima vez se va directo.
- **Generación de la extensión.** La app copia la extensión al arrancar con `writeExtension`. Pone el puerto y genera
  `lector.js` a partir de `marcador.js`.

## Extensión (`background.js`)

1. `pagina.js` corre en `http://127.0.0.1/*`, lee el id del trabajo y avisa al service worker.
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
  - si sale *"No se puede mostrar este contenido"*, reintenta hasta 3 veces; la última pone la pestaña delante un momento.

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
- **Resto de mercados de Betway** (`markets`):
  - formato `{ title, map, line, outcomes: [{ name, hcap, price }] }`;
  - el mapa sale de `marketGroup=map-N`.

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
  - `marketsInto`: mercados genéricos de Betway.
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
- **Clic en una cuota**: abre la apuesta ya rellena.
- **Clic derecho o Mayús+clic**: añade la cuota al boleto de combinada (ver [05-apuestas.md](05-apuestas.md)).

## Pendiente conocido

- Bet365 a veces no devuelve los mercados generales (ganador, hándicap) en pestañas de fondo: sale *"No se puede
  mostrar este contenido"*. Ya hay reintentos. Falta escribir el lector de esas pestañas con una captura que tenga
  contenido (`captura-bet365-pestana-N.json`).
