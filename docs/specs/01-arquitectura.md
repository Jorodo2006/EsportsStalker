# 01 · Arquitectura

## Procesos

| Proceso | Código | Qué hace |
|---|---|---|
| Principal (Node, CommonJS) | `electron/main.js`, `electron/services/*` | Ventana, todas las peticiones a internet, datos locales, servidor puente para las cuotas |
| Preload | `electron/preload.js` | Expone `window.api` con `contextBridge`. Cada llamada es `ipcRenderer.invoke(canal)` y lanza un error si la respuesta trae `ok: false` |
| Renderer (React 19 + TS) | `src/` | Interfaz. No hace peticiones a internet: todo pasa por `window.api` |
| Chrome del usuario | `electron/bookmarklet/marcador.js`, `electron/extension/` | Lee las cuotas de las casas donde no hay bloqueos anti-bot y las manda al servidor puente |

`main.js` envuelve cada canal con `handle(canal, fn)`, que devuelve `{ ok: true, data }` o `{ ok: false, error }`.

## Canales IPC (`window.api`)

| Grupo | Métodos | Servicio |
|---|---|---|
| `settings` | `get`, `set(patch)` | `store.js` |
| `bets` | `list`, `save(bet)`, `delete(id)`, `export()`, `import()` | `store.js` + diálogos de fichero en `main.js` (CSV o JSON) |
| `esports` | `leagues`, `schedule({leagueIds, pageToken})`, `live`, `eventDetails(id)`, `liveWindow(gameId)` | `lolesports.js` |
| `stats` | `searchPlayers(q)`, `searchTeams(q)`, `resolveTeam(name, code)`, `playerGames(page)`, `teamGames(team)`, `teamRoster(team)` | `leaguepedia.js` |
| `odds` | `match(m)`, `board(events)`, `auto(m)` | `odds.js` + `bridge.js` |
| `extension` | `folder()`, `open()` | carpeta `extension-chrome/` |
| `marcador` | `url()`, `paste(match)` | `bridge.js` (enlace del bookmarklet y pegado desde el portapapeles) |
| eventos | `onOddsImported(cb)`, `onOddsAuto(cb)` | avisos del principal al renderer (`odds:imported`, `odds:auto`) |
| otros | `openExternal(url)` | sólo `http(s)://` |

Los tipos de todo esto están en `src/lib/types.ts` (interfaz `Api`).

## Interfaz

- `src/App.tsx`: barra lateral (Partidos, Jugadores, Apuestas, Ajustes), contenido, formulario de apuesta,
  boleto flotante de combinada y avisos (toasts).
- `src/lib/app-context.tsx`: estado global. Contiene `view`/`go(view, param)`, `openMatch`, `betDraft`/`openBet`/`closeBet`,
  `slip`/`addToSlip`/`removeFromSlip`/`clearSlip` y `toast`.
- Datos con TanStack Query. Claves usadas: `settings`, `bets`, `leagues`, `live`, `schedule`, `board`, `event`, `odds`, `window`.
- Vistas en `src/views/`, componentes en `src/components/`, utilidades de formato en `src/lib/format.ts`.

## Datos locales

| Qué | Dónde | En git |
|---|---|---|
| Credenciales (`.env`) | carpeta del proyecto en desarrollo; junto al `.exe` o en la carpeta de datos si está empaquetada | No (sí `.env.example`) |
| Apuestas y ajustes | `%APPDATA%\LoL Esports Tracker\data.json` (Windows), `~/.config/LoL Esports Tracker/data.json` (Linux) | No |
| Caché de Leaguepedia | carpeta de datos del usuario | No |
| Extensión generada | `extension-chrome/` (en desarrollo, junto al proyecto; empaquetada, en la carpeta de datos) | No |
| Direcciones aprendidas de cada partido en cada casa | `casas-urls.json` | No |
| Fotos de las páginas de las casas | `captura-<casa>-<nombre>.json` | No |

Si `data.json` está corrupto, `store.js` guarda una copia antes de empezar de cero.
