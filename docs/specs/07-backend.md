# 07 · Backend (microservicios + PostgreSQL)

La lógica y los datos viven en un backend que corre en Docker. La interfaz es una web servida por nginx (`web/`, en
el puerto 8090), que reenvía `/api` y `/events` al gateway.

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
| `gateway` | `server/services/gateway/` | `127.0.0.1:47365` (único publicado) | — | Comprueba la sesión, reparte por prefijo, CORS para el marcador, `/ping`, `/api/health`, avisos en vivo por SSE (`/events`) |
| `bets` | `server/services/bets/` | 4003 (interno) | `bets` | Apuestas, combinadas, ajustes, importación de `data.json` |
| `esports` | `server/services/esports/` | 4001 (interno) | `esports` | lolesports (calendario, directo, detalle) y Leaguepedia (stats, con cola y caché) |
| `odds` | `server/services/odds/` | 4002 (interno) | `odds` | Puente de los lectores, normalizador (LoL y baloncesto), trabajos, programador, histórico |
| `basket` | `server/services/basket/` | 4004 (interno) | `basket` | Baloncesto: NBA y WNBA (ESPN), Euroliga y EuroCup (API de la Euroliga); partidos, plantillas, bajas y partidos de cada jugador |
| `tennis` | `server/services/tennis/` | 4005 (interno) | `tennis` | Tenis ATP y WTA (ESPN): partidos de los torneos en juego, sets, rankings |
| `lector` | `server/lector/` (imagen de Playwright) | — | — | Chromium sin cabeza: recoge los trabajos de `/jobs/next`, lee Winamax y Betway con `chrome/bookmarklet/marcador.js` (montado en `/lector-src`) y manda las cuotas |
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
| `/api/auth`, `/api/bets`, `/api/settings` | bets |
| `/api/esports`, `/api/stats` | esports |
| `/api/odds`, `/odds`, `/bet365`, `/snapshot`, `/auto`, `/jobs` | odds |
| `/api/basket` | basket |
| `/api/tennis` | tennis |
| `/ping`, `/api/health`, `/events` | el propio gateway |

API de la web (la usa `src/lib/api.ts`):

| Ruta | Método de `window.api` (grupo:método) |
|---|---|
| `GET /api/settings`, `PUT /api/settings` | `settings:get`, `settings:set` |
| `GET /api/bets`, `POST /api/bets`, `DELETE /api/bets/:id`, `POST /api/bets/import` | `bets:*` (export lee la lista y escribe el fichero en local) |
| `GET /api/esports/leagues`, `/schedule?leagueIds=&pageToken=`, `/live`, `/events/:id`, `/live-window/:gameId` | `esports:*` |
| `GET /api/stats/players?q=`, `/teams?q=`, `/resolve-team?name=&code=`, `/player-games?page=`, `/team-games?team=`, `/team-roster?team=` | `stats:*` |
| `POST /api/odds/match`, `/board`, `/jobs`, `/paste`; `GET /api/odds/auto/status` | `odds:*`, `marcador:paste` |
| `GET /api/health` | `backend:status` |

## Avisos en vivo

Los servicios hacen `pg_notify('lolet', { type, data })`. El gateway escucha (`LISTEN lolet`) y lo reenvía por SSE
en `/events`. `src/lib/api.ts` se conecta a `/events` (y se reconecta solo) y lo pasa a las vistas:

| Aviso | Quién lo recibe |
|---|---|
| `odds:imported` | `odds:imported` (el comparador se recarga) |
| `odds:auto` | `odds:auto` (progreso de un trabajo, manual o programado) |
| conexión / caída del SSE | `backend:status` (la interfaz enseña un aviso si el backend no responde) |

## Base de datos

Migraciones en `server/services/<servicio>/migrations/NNN_nombre.sql`. Se aplican al arrancar cada servicio, en orden,
y se apuntan en `<esquema>.migraciones`. **Nunca edites una migración ya aplicada: añade una nueva.**

| Tabla | Contenido |
|---|---|
| `bets.users` | Cuentas: `username` (único sin distinguir mayúsculas), contraseña con scrypt e `is_admin` |
| `bets.sessions` | Sesiones de 30 días. Sólo se guarda el SHA-256 del token |
| `bets.user_settings` | Preferencias de cada usuario |
| `bets.bets` | Apuestas (simples y combinadas), de `user_id`. `seq` guarda el orden de alta; `sport`: `lol`, `basket`, `tennis` o `mix` (migraciones 002, 003 y 004) |
| `bets.bet_legs` | Selecciones de las combinadas (`bet_id`, `pos`, `sport`) |
| `bets.settings` | Ajustes comunes clave/valor (`jsonb`). Las credenciales del `.env` nunca se guardan aquí |
| `esports.cache` | Caché de Leaguepedia (6 h) |
| `basket.cache` | Respuestas de ESPN y de la Euroliga; se usan si la fuente no responde. Los box scores terminados se guardan toda la temporada |
| `odds.matches` | Partidos abiertos en la app o programados; sirven para asignar las cuotas recibidas |
| `odds.imports` | Lo que manda el lector, tal cual, durante 6 h. `ml` = cuota de ganador para el calendario |
| `odds.price_history` | Histórico de 365 días: una fila por tramo de cuota de una casa (`ts` a `last_seen`), con `match_start` para separar revanchas |
| `odds.jobs` | Trabajos del lector (`source`: `manual` o `auto`), con el progreso por casa y el inicio del partido (`start`), que ordena la cola |
| `odds.book_urls` | Dirección de cada partido en cada casa |

Para mirar la base de datos: Adminer (arranca con `npm run backend:debug`, no con `npm run backend`) en http://127.0.0.1:8080 (Sistema *PostgreSQL*, servidor `db`, usuario, clave y
base de datos los de `POSTGRES_*`, por defecto `lolet`) o `docker compose exec db psql -U lolet -d lolet`.

## Usuarios y sesiones

- **Registro.** La primera cuenta es la de administrador y se queda con las apuestas y las preferencias que hubiera sin dueño
  (`claimExisting`). Después se puede registrar quien llegue a la web, salvo que el administrador cierre el registro.
- **Sesión.** Cookie `lolet_session` (`HttpOnly`, `SameSite=Lax`). No lleva `Secure` porque la web va por HTTP en la red de casa.
- **Gateway.** En cada ruta `/api` (menos `PUBLIC`) y en `/events` pregunta a `bets` de quién es la sesión (`/internal/auth/session`), tira
  las cabeceras `x-user-*` que vengan de fuera y pone las suyas; sin sesión responde 401. La API exige JSON en `POST` y `PUT` y no
  lleva CORS, para que otra web abierta en el navegador no pueda escribir en ella. `/jobs`, `/odds` y el resto del lector no piden
  sesión: nginx no las publica, sólo se llega a ellas desde este equipo y no tienen datos de ningún usuario.
- **Fuerza bruta.** Tras 5 contraseñas mal, ese usuario queda bloqueado un minuto (en memoria).
- **Contraseña olvidada.** `docker compose exec bets node services/bets/reset-password.js <usuario> <nueva>`.
- **Apuestas ajenas.** El id de la apuesta lo manda el cliente y es único entre todos: guardar con un id de otro usuario da 404, e importar
  el CSV de otro le da ids nuevos.

## Producción y seguridad entre servicios

- **`docker-compose.prod.yml`** se usa junto al normal (`npm run backend:prod`). Exige en el `.env`: `POSTGRES_PASSWORD`,
  `INTERNAL_SECRET`, `LECTOR_TOKEN`, `ADMIN_USER` y `ADMIN_PASSWORD`; si falta alguno Docker Compose no arranca y dice
  cuál. Ni PostgreSQL ni el gateway publican puertos; la web sólo escucha en `127.0.0.1` (la publica un proxy con HTTPS) y
  la cookie de sesión lleva `Secure`.
- **`INTERNAL_SECRET`**: el gateway firma `x-user-id` y `x-user-admin` con un HMAC (`x-user-sig`, ver
  `server/shared/internal.js`) y `bets` lo comprueba en cada petición. Sin él (desarrollo) no se firma ni se exige.
- **`LECTOR_TOKEN`**: con él, las rutas del lector del gateway (`/jobs`, `/odds`, `/snapshot`, `/auto`…) exigen la
  cabecera `x-lector-token` y dejan de responder con CORS; el contenedor `lector` la manda. Sin él (desarrollo) siguen
  abiertas para el marcador y la extensión de reserva, que no funcionan con el token puesto.
- **`ADMIN_USER` / `ADMIN_PASSWORD`**: si no hay usuarios, `bets` crea ese administrador al arrancar. Si ya los hay, no
  hace nada.
- **Límites de intentos** (en memoria, `bets/auth.js`): login por IP y usuario (5 fallos → 1 min) y por IP (30 → 10 min);
  registro 5 por IP y hora. La IP la pone nginx en `X-Real-IP`.
- **Copias de seguridad**: `npm run db:backup` (`pg_dump -Fc` desde el contenedor `db`, conserva las últimas 14) y
  `npm run db:restore -- <fichero>`. En producción: `COMPOSE_FILES=docker-compose.yml,docker-compose.prod.yml` y
  programarlo con cron.
