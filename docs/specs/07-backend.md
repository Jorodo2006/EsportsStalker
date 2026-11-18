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
| `challenger` | `server/services/challenger/` y el motor `server/sharpex-tenis/` | 4008 (interno) | `challenger` | Motor de valor de los Challenger: baja el histórico (Sackmann y TennisMyLife) al volumen `challenger` y reentrena cada día en un proceso aparte (256 MB), escáner de cuotas e historial de picks. Ver `server/sharpex-tenis/README.md` |
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
| `/api/auth`, `/api/bets`, `/api/settings`, `/api/friends`, `/api/shared` | bets (amigos y apuestas compartidas en `friends.js`: `GET/POST /api/friends`, `POST /api/friends/:id/accept`, `DELETE /api/friends/:id`, `GET/POST /api/friends/:id/chat`, `POST /api/bets/:id/share`, `GET /api/shared`, `POST /api/shared/seen`, `POST /api/shared/:id/copied`, `DELETE /api/shared/:id`) |
| `/api/esports`, `/api/stats` | esports |
| `/api/odds`, `/odds`, `/bet365`, `/snapshot`, `/auto`, `/jobs` | odds |
| `/api/basket` | basket |
| `/api/tennis` | tennis |
| `/api/football` | football |
| `/api/mma` | mma |
| `/api/challenger` | challenger: `POST escanear`, `GET historial`, `POST picks/:id/cierre`, `POST picks/:id/resultado`, `GET estado`, `POST actualizar` (escribir y actualizar, sólo el administrador) |
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
| `chat:new`, `chat:read` | `onChat` (amigos, apuestas recibidas y chat se recargan). Llevan `data.to`: el gateway sólo se lo manda a las conexiones de ese usuario |
| conexión / caída del SSE | `backend:status` (la interfaz enseña un aviso si el backend no responde) |

Un aviso con `data.to` es de un usuario: el gateway guarda el usuario de cada conexión a `/events` y no se lo reenvía a nadie más.
No metas en él datos del usuario (el texto de un mensaje, una apuesta): que la interfaz los pida a la API con su sesión.

## Base de datos

Migraciones en `server/services/<servicio>/migrations/NNN_nombre.sql`. Se aplican al arrancar cada servicio, en orden,
y se apuntan en `<esquema>.migraciones`. **Nunca edites una migración ya aplicada: añade una nueva.**

| Tabla | Contenido |
|---|---|
| `bets.users` | Cuentas: `username` (único sin distinguir mayúsculas), contraseña con scrypt, `is_admin`, `suspended_at` y `last_seen_at` (migración 018) |
| `bets.sessions` | Sesiones de 30 días. Sólo se guarda el SHA-256 del token |
| `bets.admin_log` | Lo que hace cada administrador sobre las cuentas (migración 018). Sin clave foránea: sobrevive al borrado de las cuentas. Se conserva 365 días |
| `bets.auth_events` | Entradas, intentos fallidos y altas con la IP (migración 018). Datos personales: 90 días, y se dice en la política de privacidad |
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
- **Gateway.** En cada ruta `/api` y en `/events` pregunta a `bets` de quién es la sesión (`/internal/auth/session`), tira
  las cabeceras `x-user-*` que vengan de fuera y pone las suyas; sin sesión responde 401, salvo en lo público (ver *Parte pública*). La API exige JSON en `POST` y `PUT` y no
  lleva CORS, para que otra web abierta en el navegador no pueda escribir en ella. `/jobs`, `/odds` y el resto del lector no piden
  sesión: nginx no las publica, sólo se llega a ellas desde este equipo y no tienen datos de ningún usuario.
- **Fuerza bruta.** Tras 5 contraseñas mal, ese usuario queda bloqueado un minuto (en memoria).
- **Contraseña olvidada.** `docker compose exec bets node services/bets/reset-password.js <usuario> <nueva>`.
- **Apuestas ajenas.** El id de la apuesta lo manda el cliente y es único entre todos: guardar con un id de otro usuario da 404, e importar
  el CSV de otro le da ids nuevos.

## Administración

Pantalla *Administración* (`src/views/AdminView.tsx`, sólo administradores). Diseño: `docs/superpowers/specs/2026-11-18-panel-admin-design.md`; esta es la fase 1 (Usuarios y Actividad).

- **Rutas** `/api/admin/*` en `bets` (`admin.js`): `GET users`, `PATCH users/:id` (`username`, `isAdmin`, `suspended`), `POST users/:id/password`,
  `POST users/:id/sessions/close`, `DELETE users/:id` (con `{ confirm }`: el nombre exacto), `GET log` y `GET auth-events` (`limit`, `before`, `kind`).
- **Quién puede.** El gateway exige sesión y administrador en todo `/api/admin/*` (`isAdminPath`, 401 sin sesión y 403 si no lo es) y `bets` lo
  vuelve a comprobar con la firma de las cabeceras (`adminOf`). Las reglas están en `admin-rules.js` (puras, con prueba): nunca queda un sitio sin
  administrador activo, no te quitas el rol ni te suspendes ni te borras a ti mismo, y sólo se borra una cuenta ya suspendida confirmando su nombre.
  Cada cambio se hace en una transacción con un candado (`pg_advisory_xact_lock`) y escribe su fila en `bets.admin_log`, sin contraseñas.
- **Suspender.** Cierra sus sesiones; `openSession` rechaza a una cuenta suspendida (también con Google) y `userOf` no la reconoce aunque conserve la cookie.
- **Accesos** (`auth-events.js`): `login_ok`, `login_fail`, `register` y `register_blocked`, con la IP. Un acceso fallido sólo guarda el nombre si la cuenta
  existe, para no registrar una contraseña escrita por error en el campo de usuario. Los accesos con Google no se registran todavía. Limpieza al arrancar y cada 24 h.
- **Último acceso** (`last_seen_at`): se actualiza como mucho cada 5 min por usuario.
- **Privacidad.** El administrador sólo ve cuántas apuestas tiene cada cuenta (una subconsulta por `user_id`), nunca su contenido.

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

`server/services/bets/google.js`, rutas abiertas `GET /api/auth/google` y `GET /api/auth/google/callback` (abiertas en
`gateway/public.js`). OAuth 2.0 con OpenID Connect, flujo de código con PKCE, sin librerías:

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

## Parte pública

Sin cuenta se ve la web, no sólo la entrada: AdSense no aprueba una web que no puede ver su revisor, y así llegan visitas de
los buscadores. `server/services/gateway/public.js` decide qué se abre:

- **Abierto:** entrar y registrarse; los `GET` de `esports`, `stats`, `basket`, `tennis`, `football` y `mma` salvo `/picks`;
  `POST /api/odds/match`, `/board` y `/history` (leen, aunque lleven el partido en el cuerpo), `POST /api/football/photos`,
  `/api/search`, `/api/settings/public` (los ajustes comunes sin credenciales), `/api/public/config` y `/events` (sólo los avisos
  sin destinatario).
- **Con cuenta:** lo de cada usuario (`bets`, `settings`, `friends`, `shared`), las recomendaciones (`/picks` de tenis, fútbol y
  MMA; las de baloncesto se calculan en el navegador y las tapa la interfaz), leer cuotas a mano (`/api/odds/jobs`) y los
  Challenger. Con sesión, también en lo público se pasa el usuario.
- **Límites sin cuenta:** 300 peticiones por minuto y IP (una pantalla de partidos hace unas 30) y 6 conexiones a `/events` por IP.
  La IP es la de `X-Real-IP`, que nginx saca de `CF-Connecting-IP`.

En la interfaz, `AuthGate` deja pasar sin cuenta y saca la entrada encima de la app cuando se pide (`askLogin`), con «Seguir sin
cuenta» para volver donde se estaba. Al entrar o salir se vuelven a pedir todas las consultas (`resetAllBut`).

`public/robots.txt` deja rastrear todo, también `/api`: la app pide ahí sus datos al pintarse y sin ellos Google vería una página
vacía.

### Anuncios (AdSense) y cookies

- **Cuenta:** `ADSENSE_CLIENT` (ca-pub-…) y los bloques `ADSENSE_SLOT_RECT` (300×250) y `ADSENSE_SLOT_HALF` (300×600) en el `.env`
  (pasos en `.env.example`). Llegan a la interfaz por `/api/public/config`; sin `ADSENSE_CLIENT` no se carga nada de Google.
  `/ads.txt` lo genera el gateway (nginx lo pasa a `/api/public/ads.txt`).
- **Huecos:** `AdSlot` pone el `<ins class="adsbygoogle">` y `src/lib/ads.ts` carga el script de Google una vez.
- **Consentimiento:** el mensaje de «Reglamentos europeos» de Privacidad y mensajes de AdSense, certificado para el TCF (lo exige
  Google en el EEE desde 2024). No hay otro banner: las cookies propias (`lolet_session`, `lolet_google`) son necesarias, y las
  preferencias van en `localStorage`. «Configurar cookies» del pie vuelve a abrir el mensaje de Google (`openCookieSettings`).
- **Anuncios de juego:** en la cuenta de AdSense hay que bloquear la categoría sensible «Juegos de azar y apuestas». Es una
  decisión, no una exigencia de Google (su restricción del contenido de juego no se aplica a las visitas desde España), por el
  Real Decreto 958/2020: los anuncios de casas de apuestas tienen horario y condiciones, y Sharpex no controla cuáles sirve Google.
- **CSP:** scripts con el nonce de cada petición y `'strict-dynamic'` (la forma que admite AdSense); `frame-src` y `connect-src`
  abiertos a `https:` para los marcos y las peticiones de los anuncios. Ver `web/cabeceras.conf` y `location = /index.html`.
- **Páginas legales:** `src/views/LegalView.tsx`, en `/aviso-legal`, `/privacidad` y `/cookies` (nginx sirve `index.html` y la app
  abre la vista por la dirección). El responsable sale de `LEGAL_OWNER`, `LEGAL_NIF`, `LEGAL_ADDRESS` y `LEGAL_EMAIL` del `.env`;
  lo que falte sale como «pendiente de publicar». Lo que dicen tiene que coincidir con lo que guarda la app.

## Avisos de cuotas

La app vigila las cuotas sola y avisa en una campana (cabecera del móvil y menú lateral), en vivo y, si se activa en *Tu cuenta*,
como notificación del sistema aunque la app esté cerrada (Web Push).

- **Caídas y subidas** (`server/services/odds/moves.js`): en cada lectura, `recordPrices` compara cada cuota con la anterior de la
  misma casa. Cuenta un cambio del 10 % o más, con cuotas entre 1,15 y 10, en los mercados que se siguen (ganador, hándicap,
  totales, los de fútbol y MMA del partido y las líneas de jugador). `odds` se los manda a `bets` por `/internal/alerts/odds`.
- **A quién** (`server/services/bets/alerts.js`, `targetsOf`): a quien tiene una apuesta pendiente en ese mercado y selección (se
  reconoce por la clave, la hora y los equipos del texto del partido), a quien lo tiene en el cupón (el navegador manda las
  selecciones con `PUT /api/alerts/watch` y se guardan en `bets.user_settings`, clave `oddsWatch`) y a quien sigue a uno de los
  equipos (sólo el ganador). Lo mismo no se repite antes de 3 h.
- **Nuevas con valor**: cada 10 minutos, las líneas del día y del siguiente de tenis (tablero), fútbol y MMA (escáneres) con
  EV de 2 % o más y fiabilidad de 55 o más (la regla de «apostar»), y las de baloncesto que algún navegador ha calculado en las
  últimas 2 h con EV de 8 % y fiabilidad de 65 (las fuertes). Como mucho cinco por usuario en cada pasada; cada una, una vez.
- **Preferencias** (`GET/PUT /api/alerts/prefs`, clave `alertPrefs`): caídas, subidas y nuevas con valor, encendidas al empezar.
- **Entrega**: `bets.alerts` (se borran a los 14 días), el aviso `alerts:new` con `data.to` (sólo a su usuario, sin el texto) y
  `push.send` a cada suscripción del usuario (20 al día como mucho; el resto, sólo en la campana).
- **Notificaciones** (`push.js`, `src/lib/push.ts`, `public/sw.js`): claves VAPID del `.env` o generadas la primera vez y
  guardadas en `bets.vapid`. El navegador se suscribe con la pública y manda la suscripción a `POST /api/alerts/push`; sólo se
  admiten servicios de push de navegadores (`PUSH_HOSTS`), porque el servidor hace peticiones a esa dirección. Las caducadas
  (404/410) se borran. Necesita https (o localhost) y, en el iPhone, la app en la pantalla de inicio. El Chromium de código
  abierto (el del lector) no puede suscribirse: no lleva las claves de Google; Chrome, Edge, Firefox y Safari sí.
- **CSP**: `worker-src 'self'` para `sw.js`, que nginx sirve sin caché.

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
