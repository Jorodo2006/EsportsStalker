# 06 · Ajustes y pendientes

## Ajustes (`src/views/SettingsView.tsx`, valores por defecto en `server/services/bets/store.js`, tabla `bets.settings`)

| Ajuste | Por defecto | Uso |
|---|---|---|
| `currency` | `€` | Moneda de las cantidades |
| `initialBankroll` | 0 | Banca inicial, que se suma al beneficio |
| `featuredBooks` | `Bet365,Winamax,Betway` | Columnas del comparador y su orden |
| `refreshSeconds` | 30 | Refresco del calendario y del directo (mínimo 10) |
| `oddsAutoEnabled` | `true` | Lecturas de cuotas programadas (las hace la extensión) |
| `oddsRefreshMinutes` | 5 | Cada cuántos minutos se vuelve a leer cada partido (2–240) |
| `oddsAutoHours` | 6 | Se leen los partidos que empiezan en las próximas N horas (1–48) |
| `favoriteLeagues` | `[]` | Ligas que salen primero |
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
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Base de datos (por defecto `lolet`). Sólo cuentan antes del primer arranque |

- Lo que venga del `.env` manda sobre lo guardado: `GET /internal/settings` de `bets` devuelve `{ ...ajustes, ...env }`.
- `GET /api/settings` no manda esos valores a la interfaz: los vacía y añade `envKeys` (cuáles vienen del `.env`) y `envFile`.
  En Ajustes esos campos salen desactivados con el texto *Definido en .env*.
- `PUT /api/settings` ignora esas claves, para que nunca acaben copiadas en la base de datos.

Secciones de la pantalla:

- **Preferencias.**
- **Fuentes de datos**: incluye *Probar conexiones* para comprobar lolesports y Leaguepedia.
- **Cuotas automáticas**: activar, cada cuántos minutos y qué horizonte, más el estado (extensión conectada, cola,
  partidos que entran ahora).
- **Extensión de Chrome**: carpeta de la extensión, con un botón para abrirla y los pasos para cargarla en
  `chrome://extensions` con *Cargar descomprimida*.
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
