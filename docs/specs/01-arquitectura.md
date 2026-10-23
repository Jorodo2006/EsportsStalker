# 01 · Arquitectura

## Procesos

| Proceso | Código | Qué hace |
|---|---|---|
| Backend (Docker) | `server/`, `docker-compose.yml` | Gateway + microservicios `bets`, `esports` y `odds` sobre PostgreSQL. Todas las peticiones a internet, los datos y el puente de las cuotas. Ver [07-backend.md](07-backend.md) |
| Principal (Node, CommonJS) | `electron/main.js`, `electron/services/*` | Ventana, reenvío de cada canal IPC al gateway (`backend.js`), diálogos de fichero, portapapeles, abrir Chrome, generar la extensión y el marcador (`extension.js`) |
| Preload | `electron/preload.js` | Expone `window.api` con `contextBridge`. Cada llamada es `ipcRenderer.invoke(canal)` y lanza un error si la respuesta trae `ok: false` |
| Renderer (React 19 + TS) | `src/` | Interfaz. No hace peticiones a internet ni al backend: todo pasa por `window.api` |
| Chrome del usuario | `electron/bookmarklet/marcador.js`, `electron/extension/` | Lee las cuotas de las casas donde no hay bloqueos anti-bot y las manda al gateway (`127.0.0.1:47365`) |

`main.js` envuelve cada canal con `handle(canal, fn)`, que devuelve `{ ok: true, data }` o `{ ok: false, error }`.
Si el backend no responde, el error dice cómo arrancarlo (`npm run backend`).

## Canales IPC (`window.api`)

| Grupo | Métodos | Backend |
|---|---|---|
| `settings` | `get`, `set(patch)` | bets |
| `bets` | `list`, `save(bet)`, `delete(id)`, `export()`, `import()` | bets + diálogos de fichero en `main.js` (CSV o JSON) |
| `esports` | `leagues`, `schedule({leagueIds, pageToken})`, `live`, `eventDetails(id)`, `liveWindow(gameId)` | esports |
| `stats` | `searchPlayers(q)`, `searchTeams(q)`, `resolveTeam(name, code)`, `playerGames(page)`, `teamGames(team)`, `teamRoster(team)` | esports |
| `odds` | `match(m)`, `board(events)`, `auto(m)`, `autoStatus()` | odds |
| `extension` | `folder()`, `open()` | local: carpeta `extension-chrome/` |
| `marcador` | `url()`, `paste(match)` | local (enlace del bookmarklet) + odds (pegado desde el portapapeles) |
| `backend` | `status()` | gateway (`/api/health`) |
| eventos | `onOddsImported(cb)`, `onOddsAuto(cb)`, `onBackendStatus(cb)` | SSE del gateway reenviado por `main.js` |
| otros | `openExternal(url)` | sólo `http(s)://` |

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
| Apuestas, ajustes, cuotas, histórico, trabajos, direcciones de las casas, caché de Leaguepedia | PostgreSQL en Docker (volumen `pgdata`) | No |
| Credenciales (`.env`) | raíz del proyecto, junto a `docker-compose.yml` | No (sí `.env.example`) |
| Extensión generada | `extension-chrome/` (en desarrollo, junto al proyecto; empaquetada, en la carpeta de datos) | No |
| Fotos de las páginas de las casas | `capturas/captura-<casa>-<nombre>.json` (volumen del servicio `odds`) | No |
| `data.json` y `casas-urls.json` antiguos | se importan a la base de datos y se renombran a `*.migrado-*` | No |
