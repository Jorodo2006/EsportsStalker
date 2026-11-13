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
| `basket` | `server/services/basket/` | 4004 (interno) | `basket` | Baloncesto: NBA, WNBA y NBL (ESPN), Euroliga y EuroCup (API de la Euroliga); partidos, plantillas, bajas y partidos de cada jugador |
| `tennis` | `server/services/tennis/` | 4005 (interno) | `tennis` | Tenis ATP y WTA (ESPN): partidos de los torneos en juego, sets, rankings |
| `football` | `server/services/football/` | 4006 (interno) | `football` | Fútbol (ESPN): partidos por día, ficha del partido, clasificaciones |
| `mma` | `server/services/mma/` | 4007 (interno) | `mma` | MMA: UFC y PFL (ESPN) y WOW (wowmma.com): combates, fichas, ranking Elo, previsión y recomendaciones (`docs/specs/12-mma.md`) |
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
| `/api/football` | football |
| `/api/mma` | mma |
| `/ping`, `/api/health`, `/events` | el propio gateway |
| `/api/search?q=` | el propio gateway: pregunta a la vez a `/api/<esports\|basket\|tennis\|football\|mma>/search` (8 s como mucho cada uno; si uno falla salen los demás) y junta los resultados |

**Buscador** (`/api/search`, componente `src/components/Search.tsx`, Ctrl+K o "/"): partidos de ayer a dentro de una semana
y competiciones de los cinco deportes. Cada servicio busca en lo suyo con `server/shared/search.js` (sin tildes ni
mayúsculas; cada palabra al principio de una palabra del nombre, también en los otros nombres de equipos y selecciones) y
devuelve `{ matches, competitions }`. Orden: lo que está en juego, lo que encaja por equipo o jugador antes que por
competición y lo más cercano a ahora. Al elegir un partido la app cambia de deporte, lleva la lista a su día
(`setFocusDay` + `useFocus(open, has, setDate)`) y lo abre; en LoL se abre directamente con el partido que trae el resultado.
Pruebas: `server/test/buscador.test.js`.

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
| `bets.user_settings` | Lo de cada usuario: banca inicial y filtro de ligas (el resto de ajustes son comunes, `bets.settings`) |
| `bets.bets` | Apuestas (simples y combinadas), de `user_id`. `seq` guarda el orden de alta; `sport`: `lol`, `basket`, `tennis`, `football`, `mma` o `mix` (migraciones 002, 003, 004, 007 y 012) |
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

## Entrar con Google

`server/services/bets/google.js`, rutas abiertas `GET /api/auth/google` y `GET /api/auth/google/callback` (están en `PUBLIC` del
gateway). OAuth 2.0 con OpenID Connect, flujo de código con PKCE, sin librerías:

1. `/api/auth/google` guarda en la cookie `lolet_google` (10 minutos, `HttpOnly`, `SameSite=Lax`, sólo para `/api/auth/google`) un
   `state` y un verificador PKCE al azar, y manda a Google con `prompt=select_account`. Con `?link=1` es para vincular Google a
   la cuenta con la que ya se ha entrado.
2. Google vuelve a `/callback` con `code` y `state`. Si el `state` no coincide con el de la cookie, se descarta: así nadie puede
   meter su cuenta de Google en la sesión de otro.
3. El código se cambia por el `id_token` directamente con Google por HTTPS, y se comprueban emisor, destinatario (`aud` = el ID de
   cliente), caducidad y correo verificado (`claimsOf`). Al venir de Google por TLS no hace falta comprobar la firma (OpenID
   Connect, 3.1.3.7).
4. Si ese `sub` de Google ya tiene usuario, se abre la sesión. Si no, se crea con las reglas del registro: el primero es el
   administrador, con el registro cerrado no se crea y cuenta para el límite de altas por IP. El usuario sale de la parte del
   correo antes de la `@` (`usernameBase`, `freeUsername`). No tiene contraseña (`password_hash` nulo, migración `011_google.sql`)
   hasta que se la pone en *Tu cuenta*.
5. Vuelve a `/` (o a `/?google=vinculada`); los errores, en `/?login_error=…`, que la pantalla de entrada o *Tu cuenta* enseñan
   y quitan de la barra.

Configuración: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `PUBLIC_URL` en el `.env` (pasos en `.env.example`); la dirección de
vuelta autorizada en Google tiene que ser exactamente `<PUBLIC_URL>/api/auth/google/callback`. Sin las tres, `GET /api/auth/config`
da `google: false` y el botón no sale. Las cuentas de Google no se enlazan solas por correo con las de usuario y contraseña (éstas no
guardan correo): se vinculan a mano desde *Tu cuenta*.

Al vincular, si esa cuenta de Google ya tiene usuario: si es una cuenta **vacía** (la que se crea sola al entrar con Google:
sin contraseña, sin apuestas ni ajustes propios y sin ser administrador), el vínculo pasa a la cuenta actual y la vacía se
borra, porque es la misma persona entrando dos veces. Si tiene algo suyo, no se toca y se dice de qué usuario es. El resultado
sale en *Tu cuenta* hasta que se cierra (no en un aviso de unos segundos, que tras volver de Google no se ve).

## Rendimiento de la web

- **Compresión y caché** (`web/nginx.conf`, `web/Dockerfile`): la compilación deja una copia `.gz` (nivel 9) de cada fichero
  de texto y nginx la sirve con `gzip_static`; el JSON de la API se comprime al vuelo (`gzip_proxied any`). `/assets/` (con
  hash en el nombre) va con `Cache-Control: public, max-age=31536000, immutable` e `index.html` con `no-cache`. Las
  cabeceras de seguridad están en `web/cabeceras.conf` y se incluyen en cada `location` que pone las suyas, porque nginx no
  hereda `add_header`. Medido en la portada: JS de 1,15 MB a 342 KB y API al abrir de 3,6 MB a 359 KB.
- **`/events` sin comprimir ni almacenar**: comprimido o en búfer, nginx retendría los avisos. Lo mismo vale para el proxy
  con HTTPS que se ponga delante en producción: `/events` sin búfer (`X-Accel-Buffering`/`flush_interval -1` según el proxy)
  y sin compresión, y con HTTP/2 para el resto.
- **Cuotas por aviso** (`src/lib/odds-live.ts`): las consultas de cuotas llevan la clave del partido en `meta` (`oddsMeta`) y
  se recargan con el aviso `odds:imported`, que trae esa clave; al reconectar se recarga todo lo que esté en pantalla. Sólo
  hay un sondeo de respaldo cada 10 minutos. Antes eran 13 peticiones por minuto (1,2 MB) en la portada.
- **Imágenes a su tamaño** (`sized` en `src/lib/img.ts`): las de ESPN pasan por su redimensionador (`combiner`) y las de la
  Euroliga por `?width=` de su CDN, al doble de lo que se pintan; si fallan, `fallbackTo` pone la original. De 30–130 KB a 2–8 KB
  por escudo.
- **Servir lo caducado mientras se renueva** (stale-while-revalidate): las cachés de ESPN (`basket/cache.js`, y
  `shared/cached.js` para tenis y fútbol), la de lolesports (`esports/http.js`) y las de los puntos de tenis devuelven al
  momento lo caducado hace poco (hasta 10 minutos; 45 s en los directos de 15 s) y lo renuevan por detrás. Más viejo, se
  espera a lo nuevo. Recién arrancado se aprovecha lo guardado en `<esquema>.cache`, con su hora. ESPN tardaba 1–2,5 s.
- **Precalentado** (`warmEvery` en `shared/cached.js`): baloncesto, tenis y fútbol piden cada 4 minutos los partidos de ayer
  a mañana y los directos (y las bajas de la NBA), para que el primero que entre no espere. Medido: de 1,1–2,6 s a 5–50 ms.
- **Recomendaciones de baloncesto de la portada sólo a la vista** (`useSeen` en `src/views/TodayView.tsx`): necesitan los
  partidos de los jugadores de todos los equipos que juegan (tres cuartas partes de lo que bajaba la portada). Se calculan
  cuando el panel está a 300 px de verse, y sólo desde que han cargado los partidos (antes, el panel saldría arriba). En el
  móvil la portada pasa de 44 llamadas (394 KB comprimidos) a 15 (23 KB).
