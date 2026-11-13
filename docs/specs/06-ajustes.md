# 06 · Ajustes y pendientes

## Ajustes (`src/views/SettingsView.tsx`, valores por defecto en `server/services/bets/store.js`, tablas `bets.settings` y `bets.user_settings`)

Los ajustes son **de la app entera**: la página *Ajustes* sólo la ve el administrador, y lo que cambie vale al momento para
todos (el servidor manda el aviso SSE `settings:changed` y cada navegador conectado los recarga). Si otro usuario manda un ajuste
común, `PUT /api/settings` responde 403, y a los demás tampoco les llegan las claves (`SECRET_KEYS`).

De cada usuario quedan sólo dos cosas (`USER_KEYS`, en `bets.user_settings`): `initialBankroll`, porque cada uno tiene su
cartera, y `favoriteLeagues`, el filtro de ligas de la lista de LoL. La banca inicial se cambia en **Tu cuenta**
(`src/views/AccountView.tsx`), que ven todos, junto con la contraseña, salir y los avisos de su navegador. La moneda, las
casas del comparador y el refresco eran de cada usuario hasta la migración `bets/010_ajustes_comunes.sql`, que dejó para
todos los del primer administrador.

| Ajuste | Por defecto | Uso |
|---|---|---|
| `currency` | `€` | Moneda de las cantidades |
| `initialBankroll` | 0 | Banca inicial de cada usuario (en *Tu cuenta*), que se suma a su beneficio |
| `featuredBooks` | `Bet365,Winamax,Betway` | Columnas del comparador y su orden |
| `refreshSeconds` | 30 | Refresco del calendario y del directo (mínimo 10) |
| `oddsAutoEnabled` | `true` | Lecturas de cuotas programadas (las hace el lector de Docker) |
| `oddsRefreshMinutes` | 5 | Cada cuántos minutos se vuelve a leer cada partido cercano (2–240) |
| `oddsAutoHours` | 6 | Son cercanos los partidos que empiezan en las próximas N horas (1–48) |
| `oddsFarEnabled` | `true` | Leer también los de más adelante: cada hora hasta 24 h antes y cada 3 h hasta 48 h antes (tenis: cada 3 h y sólo desde 24 h antes) |
| `favoriteLeagues` | `[]` | Filtro de ligas de la lista de LoL, de cada usuario |
| `signupOpen` | `true` | Si se pueden crear cuentas desde la pantalla de entrada |
| `lolesportsKey` | clave pública de lolesports.com | Cabecera `x-api-key` |
| `leaguepediaUser` / `leaguepediaPassword` | vacío | *Bot password* de Fandom (opcional). **Sólo en la base de datos o en el `.env`, nunca en el repo** |

### Fichero `.env`

Está en la raíz del proyecto, junto a `docker-compose.yml`. Docker Compose lo pasa a los servicios del backend
(`env_file`, opcional) y `server/shared/env.js` traduce las variables a ajustes. Tras cambiarlo: `npm run backend`.
Variables (plantilla en `.env.example`):

| Variable | Ajuste |
|---|---|
| `LEAGUEPEDIA_USER` | `leaguepediaUser` |
| `LEAGUEPEDIA_PASSWORD` | `leaguepediaPassword` |
| `LOLESPORTS_KEY` | `lolesportsKey` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `PUBLIC_URL` | Entrar con Google (no son ajustes: los lee `bets/google.js`; ver `07-backend.md`) |
| `WEB_PORT` / `WEB_BIND` | Puerto de la web (8090) e interfaz donde escucha (`0.0.0.0`; `127.0.0.1` la cierra a la red) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Base de datos (por defecto `lolet`). Sólo cuentan antes del primer arranque |

- Lo que venga del `.env` manda sobre lo guardado: `GET /internal/settings` de `bets` devuelve `{ ...ajustes, ...env }`.
- `GET /api/settings` no manda esos valores a la interfaz: los vacía y añade `envKeys` (cuáles vienen del `.env`) y `envFile`.
  En Ajustes esos campos salen desactivados con el texto *Definido en .env*.
- `PUT /api/settings` ignora esas claves, para que nunca acaben copiadas en la base de datos.

Secciones de la pantalla:

- **Tu cuenta**: cambiar la contraseña, salir y, si eres administrador, abrir o cerrar el registro.
- **Preferencias.**
- **Fuentes de datos**: incluye *Probar conexiones* para comprobar lolesports y Leaguepedia.
- **Cuotas automáticas** (administrador): activar, cada cuántos minutos y qué horizonte, más el estado (lector, cola,
  partidos que entran ahora).
- **Extensión de Chrome** (administrador): `npm run extension` y los pasos para cargarla en `chrome://extensions`.
- **Marcador de cuotas**: un enlace que se arrastra a la barra de favoritos.

Al cargar los ajustes:

- las listas antiguas de casas pasan a la nueva (`OLD_FEATURED`);
- se ignoran los ajustes de las antiguas APIs de cuotas (`OBSOLETE`: Pinnacle, OddsPapi, Kambi, `oddsProvider`).

## Historial de decisiones

- **Se quitaron las APIs de cuotas** (Pinnacle, OddsPapi, Unibet/Kambi) porque el usuario no quiere fuentes de pago
  ni APIs de cuotas. Desde entonces las cuotas sólo se leen de las páginas, con el marcador o la extensión.
- **Se quitó William Hill.** Se quedan Bet365, Winamax y Betway.
- **Se eligió la extensión de Chrome** para automatizar, frente a un navegador controlado por la app, porque usa el
  Chrome real del usuario, sin bloqueos anti-bot.
- **Rediseño del comparador**: tres columnas fijas por casa con icono, mercados plegables y pestañas de sección.
- **Combinadas** con boleto flotante, formulario por selecciones y historial desplegable.
- **Backend con microservicios y PostgreSQL** (v0.3): gateway + `bets`, `esports` y `odds` en Docker Compose, en vez
  de `data.json` y servicios dentro de Electron. Se eligió PostgreSQL + Docker frente a SQLite embebido.
- **Cuotas automáticas**: cada 5 minutos, partidos que empiezan en las próximas 6 h. La extensión pregunta con
  `chrome.alarms` y hace los trabajos de uno en uno.

## Pendientes

- Lector de los mercados generales de Bet365, que necesita una captura con contenido (ver [03-cuotas.md](03-cuotas.md)).
- Iconos reales de las casas en `src/assets/books/` (opcional).
