# 07 · Backend (microservicios + PostgreSQL)

Desde la versión 0.3 la lógica y los datos viven en un backend aparte, que corre en Docker. Electron es sólo la
interfaz: `electron/main.js` reenvía cada canal IPC al gateway por HTTP.

## Arranque

```bash
npm run backend        # docker compose up -d --build (hace falta Docker Desktop encendido)
npm run backend:logs   # registros de todos los servicios
npm run backend:stop   # docker compose down (los datos se quedan en el volumen pgdata)
```

- `docker-compose.yml` está en la raíz y lee el `.env` de la raíz (credenciales y, opcional, `POSTGRES_*`).
- **Si cambias algo en `server/` hay que volver a ejecutar `npm run backend`** (reconstruye la imagen).
- Una imagen (`server/Dockerfile`, Node 24) para los servicios Node; cada contenedor arranca uno. El `lector` tiene la suya (`server/lector/Dockerfile`, Playwright con Chromium).

## Piezas

| Servicio | Código | Puerto | Esquema | Qué hace |
|---|---|---|---|---|
| `gateway` | `server/services/gateway/` | `127.0.0.1:47365` (único publicado) | — | Reparte por prefijo, CORS, `/ping`, `/api/health`, avisos en vivo por SSE (`/events`) |
| `bets` | `server/services/bets/` | 4003 (interno) | `bets` | Apuestas, combinadas, ajustes, importación de `data.json` |
| `esports` | `server/services/esports/` | 4001 (interno) | `esports` | lolesports (calendario, directo, detalle) y Leaguepedia (stats, con cola y caché) |
| `odds` | `server/services/odds/` | 4002 (interno) | `odds` | Puente de los lectores, normalizador (LoL y baloncesto), trabajos, programador, histórico |
| `basket` | `server/services/basket/` | 4004 (interno) | `basket` | Baloncesto: NBA y WNBA (ESPN), Euroliga y EuroCup (API de la Euroliga); partidos, plantillas, bajas y partidos de cada jugador |
| `tennis` | `server/services/tennis/` | 4005 (interno) | `tennis` | Tenis ATP y WTA (ESPN): partidos de los torneos en juego, sets, rankings |
| `lector` | `server/lector/` (imagen de Playwright) | — | — | Chromium sin cabeza: recoge los trabajos de `/jobs/next`, lee Winamax y Betway con `electron/bookmarklet/marcador.js` (montado en `/lector-src`) y manda las cuotas |
| `db` | `postgres:17-alpine` | `127.0.0.1:55432` (para depurar) | — | Volumen `pgdata` |
| `adminer` | `adminer` | `127.0.0.1:8080` (`ADMINER_PORT`) | — | Visor web de la base de datos (tema oscuro, servidor `db`) |

Código común en `server/shared/`:

- `db.js`: pool de `pg`, `tx()`, `migrate(esquema, carpeta)` y `notify(tipo, datos)`.
- `service.js`: servidor HTTP mínimo con rutas `[método, '/ruta/:param', handler]`.
- `client.js`: llamadas entre servicios y `settings()` (ajustes efectivos con caché de 10 s).
- `env.js`: variables del `.env` → nombres de ajuste.

Reglas:

- Cada servicio sólo toca su esquema. Para datos de otro, llama a su API (por ejemplo `odds` pide el calendario a
  `esports` y los ajustes a `bets` en `GET /internal/settings`).
- Las rutas `/api/*` y `/internal/*` responden `{ ok: true, data }` o `{ ok: false, error }`. Las del marcador y la
  extensión (`/odds`, `/auto/*`, `/jobs/next`…) mantienen su formato de siempre.
- `/internal/*` no lo publica el gateway: sólo se usa dentro de la red de Docker.

## Rutas del gateway

| Prefijo | Servicio |
|---|---|
| `/api/bets`, `/api/settings`, `/api/legacy` | bets |
| `/api/esports`, `/api/stats` | esports |
| `/api/odds`, `/odds`, `/bet365`, `/snapshot`, `/auto`, `/jobs` | odds |
| `/api/basket` | basket |
| `/api/tennis` | tennis |
| `/ping`, `/api/health`, `/events` | el propio gateway |

API de la app (la usa `electron/main.js`):

| Ruta | Canal IPC |
|---|---|
| `GET /api/settings`, `PUT /api/settings` | `settings:get`, `settings:set` |
| `GET /api/bets`, `POST /api/bets`, `DELETE /api/bets/:id`, `POST /api/bets/import` | `bets:*` (export lee la lista y escribe el fichero en local) |
| `GET /api/esports/leagues`, `/schedule?leagueIds=&pageToken=`, `/live`, `/events/:id`, `/live-window/:gameId` | `esports:*` |
| `GET /api/stats/players?q=`, `/teams?q=`, `/resolve-team?name=&code=`, `/player-games?page=`, `/team-games?team=`, `/team-roster?team=` | `stats:*` |
| `POST /api/odds/match`, `/board`, `/jobs`, `/paste`; `GET /api/odds/auto/status` | `odds:*`, `marcador:paste` |
| `GET /api/health` | `backend:status` |

## Avisos en vivo

Los servicios hacen `pg_notify('lolet', { type, data })`. El gateway escucha (`LISTEN lolet`) y lo reenvía por SSE
en `/events`. `electron/services/backend.js` se conecta a `/events` (y se reconecta solo) y lo pasa al renderer:

| Aviso | Canal del renderer |
|---|---|
| `odds:imported` | `odds:imported` (el comparador se recarga) |
| `odds:auto` | `odds:auto` (progreso de un trabajo, manual o programado) |
| conexión / caída del SSE | `backend:status` (la interfaz enseña un aviso si el backend no responde) |

## Base de datos

Migraciones en `server/services/<servicio>/migrations/NNN_nombre.sql`. Se aplican al arrancar cada servicio, en orden,
y se apuntan en `<esquema>.migraciones`. **Nunca edites una migración ya aplicada: añade una nueva.**

| Tabla | Contenido |
|---|---|
| `bets.bets` | Apuestas (simples y combinadas). `seq` guarda el orden de alta; `sport`: `lol`, `basket`, `tennis` o `mix` (migraciones 002, 003 y 004) |
| `bets.bet_legs` | Selecciones de las combinadas (`bet_id`, `pos`, `sport`) |
| `bets.settings` | Ajustes clave/valor (`jsonb`). Las credenciales del `.env` nunca se guardan aquí |
| `esports.cache` | Caché de Leaguepedia (6 h) |
| `basket.cache` | Respuestas de ESPN y de la Euroliga; se usan si la fuente no responde. Los box scores terminados se guardan toda la temporada |
| `odds.matches` | Partidos abiertos en la app o programados; sirven para asignar las cuotas recibidas |
| `odds.imports` | Lo que manda el lector, tal cual, durante 3 h. `ml` = cuota de ganador para el calendario |
| `odds.price_history` | Histórico: una fila cada vez que cambia una cuota de una casa |
| `odds.jobs` | Trabajos de la extensión (`source`: `manual` o `auto`), con el progreso por casa |
| `odds.book_urls` | Dirección de cada partido en cada casa |

Para mirar la base de datos: Adminer en http://127.0.0.1:8080 (Sistema *PostgreSQL*, servidor `db`, usuario, clave y
base de datos los de `POSTGRES_*`, por defecto `lolet`) o `docker compose exec db psql -U lolet -d lolet`.

## Paso de los datos locales

La primera vez que Electron conecta con el backend (`migrateLegacy` en `main.js`):

- `data.json` (carpeta de datos del usuario) → `POST /api/legacy/import`. Las apuestas se añaden si no existen; los
  ajustes sólo si la tabla está vacía.
- `casas-urls.json` → `POST /api/odds/legacy-urls`.
- Después cada fichero se renombra a `*.migrado-AAAA-MM-DD` (no se borra).
