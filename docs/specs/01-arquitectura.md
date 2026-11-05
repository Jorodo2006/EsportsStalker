# 01 · Arquitectura

## Procesos

| Proceso | Código | Qué hace |
|---|---|---|
| Backend (Docker) | `server/`, `docker-compose.yml` | Gateway + microservicios sobre PostgreSQL. Todas las peticiones a internet, los datos y el puente de las cuotas. Ver [07-backend.md](07-backend.md) |
| Web (nginx en Docker) | `web/`, puerto 8090 abierto a la red | Sirve la interfaz compilada y reenvía sólo `/api` y `/events` al gateway |
| Interfaz (React 19 + TS, en el navegador) | `src/` | Las vistas sólo hablan con `window.api` (`src/lib/api.ts`), que llama al backend por el mismo origen. No llama a internet |
| Chrome del usuario (reserva) | `chrome/bookmarklet/marcador.js`, `chrome/extension/` | Lee las cuotas de las casas si bloquean al lector de Docker y las manda al gateway (`127.0.0.1:47365`) |

En desarrollo (`npm run dev`) Vite sirve la interfaz en `127.0.0.1:5173` y hace de proxy al gateway, igual que nginx.
Las respuestas del backend son `{ ok: true, data }` o `{ ok: false, error }`; `api.ts` devuelve `data` o lanza el error.
Si el backend no responde, el error dice cómo arrancarlo (`npm run backend`).

**Red:** sólo la web se abre a la red, para entrar desde el móvil (`http://<IP del equipo>:8090`); `WEB_BIND=127.0.0.1` en el
`.env` la cierra. Va por HTTP, así que sólo es para una red de confianza: fuera de casa haría falta HTTPS o una VPN. Sin HTTPS
el móvil tampoco puede leer el portapapeles, de modo que *Pegar del marcador* sólo funciona en el propio equipo.

**Sesión:** `AuthGate` (`src/components/AuthGate.tsx`) enseña la pantalla de entrada hasta que hay sesión. Ver
[07-backend.md](07-backend.md).

## `window.api`

| Grupo | Métodos | Backend |
|---|---|---|
| `auth` | `me`, `config`, `login`, `register`, `logout`, `changePassword` | bets |
| `settings` | `get`, `set(patch)` | bets |
| `bets` | `list`, `save(bet)`, `delete(id)`, `export()`, `import()` | bets. Exportar descarga un CSV e importar acepta CSV o JSON, los dos en el navegador (`src/lib/csv.ts`) |
| `esports` | `leagues`, `schedule({leagueIds, pageToken})`, `live`, `eventDetails(id)`, `liveWindow(gameId)` | esports |
| `stats` | `searchPlayers(q)`, `searchTeams(q)`, `resolveTeam(name, code)`, `playerGames(page)`, `teamGames(team)`, `teamRoster(team)` | esports |
| `odds` | `match(m)`, `board(events)`, `auto(m)`, `autoStatus()` | odds |
| `tennis`, `basket` | partidos, directo, rankings, plantillas y estadísticas | tennis, basket |
| `marcador` | `url()`, `paste(match)` | el enlace se genera en el navegador; el pegado lee el portapapeles y va a odds |
| `backend` | `status()` | gateway (`/api/health`) |
| eventos | `onOddsImported(cb)`, `onOddsAuto(cb)`, `onBackendStatus(cb)` | SSE del gateway (`/events`), se reconecta solo |
| otros | `openExternal(url)` | sólo `http(s)://`, en otra pestaña |

Los tipos de todo esto están en `src/lib/types.ts` (interfaz `Api`).

## Interfaz

- `src/App.tsx`: barra lateral (Partidos, Jugadores, Apuestas, Ajustes), aviso si el backend no responde
  (`BackendBanner`), contenido, formulario de apuesta, boleto flotante de combinada y avisos (toasts).
- `src/lib/app-context.tsx`: estado global. Contiene `view`/`go(view, param)`, `openMatch`, `betDraft`/`openBet`/`closeBet`,
  `slip`/`addToSlip`/`removeFromSlip`/`clearSlip` y `toast`.
- Datos con TanStack Query. Claves usadas: `settings`, `bets`, `leagues`, `live`, `schedule`, `board`, `event`, `odds`,
  `window`, `backend`, `autoStatus`. Cuando el backend vuelve, se invalidan todas.
- Vistas en `src/views/`, componentes en `src/components/`, utilidades de formato en `src/lib/format.ts`.

## Datos

| Qué | Dónde | En git |
|---|---|---|
| Usuarios, apuestas, ajustes, cuotas, histórico, trabajos, direcciones de las casas, caché de Leaguepedia | PostgreSQL en Docker (volumen `pgdata`) | No |
| Preferencias de la interfaz (secciones plegadas, boleto) | `localStorage` del navegador | No |
| Credenciales (`.env`) | raíz del proyecto, junto a `docker-compose.yml` | No (sí `.env.example`) |
| Extensión generada | `extension-chrome/` (`npm run extension`) | No |
| Fotos de las páginas de las casas | `capturas/captura-<casa>-<nombre>.json` (volumen del servicio `odds`) | No |
