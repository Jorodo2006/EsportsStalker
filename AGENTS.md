# AGENTS.md

Guía para agentes de código (Claude Code, Codex, Copilot…) que trabajen en **EsportsStalker / LoL Esports Tracker**.
Lee esto antes de tocar nada. Las especificaciones detalladas de cada parte están en [`docs/specs/`](docs/specs/).

## Qué es

App de escritorio (Windows y Linux) con backend en Docker para seguir los esports de League of Legends y llevar el control de apuestas:
partidos y directo, comparador de cuotas de Bet365 / Winamax / Betway, stats de jugadores y equipos, y registro de
apuestas simples y combinadas con beneficio, ROI y gráficas. Electron es la interfaz; la lógica y los datos están en
microservicios Node con PostgreSQL (`server/`, `docker-compose.yml`). Las cuotas se actualizan solas cada pocos minutos.

## Reglas del proyecto (no negociables)

1. **Nada de APIs de pago ni APIs de cuotas.** Todas las fuentes son gratuitas. Las cuotas se leen de las páginas
   de las casas en el Chrome del usuario (marcador o extensión), nunca de una API de cuotas (OddsPapi, Pinnacle,
   The Odds API… se quitaron a propósito; ver `OBSOLETE` en `server/services/bets/store.js`).
2. **Casas soportadas: Bet365, Winamax y Betway.** William Hill y el resto se quitaron a petición del usuario.
3. **La interfaz y los comentarios van en español.** Textos de la UI, mensajes de error y comentarios del código.
4. **Ningún dato personal en el repo:** ni volcados de la base de datos, ni `data.json`, ni capturas
   (`capturas/`, `captura-*.json`), ni `casas-urls.json`, ni ficheros `*.migrado-*`, ni el `.env` con las credenciales.
   Ya están en `.gitignore`; no los saques de ahí. Las credenciales nuevas van al `.env` (mapeo en
   `server/shared/env.js`) y se documentan en `.env.example`.
5. **Las peticiones a internet las hace el backend** (`server/`). El renderer (`src/`) no hace peticiones: habla con
   `window.api`, y el proceso principal (`electron/`) las reenvía al gateway.
6. **Cada servicio sólo toca su esquema de PostgreSQL** (`bets`, `esports`, `odds`). Si necesita datos de otro, llama a
   su API. Los cambios de tablas van en una migración nueva (`migrations/NNN_*.sql`); nunca edites una ya aplicada.
7. **Nada de `git commit` ni `git push` sin que Jordi lo pida explícitamente en ese momento.** Prepara los cambios y
   espera su confirmación.

## Comandos

```bash
npm install
npm run backend    # docker compose up -d --build: PostgreSQL + gateway + servicios (Docker Desktop encendido)
npm run dev        # Vite (5173) + Electron con recarga del renderer
npm run typecheck  # tsc --noEmit: es la única comprobación automática que hay
npm run build      # typecheck + vite build
npm start          # build y abre Electron como en producción
npm run dist:win   # instalador Windows (nsis + portable) en release/
npm run backend:logs  # registros del backend;  npm run backend:stop para pararlo
```

- No hay tests automáticos. Antes de dar algo por terminado: `npm run typecheck` sin errores y probar en `npm run dev`.
- **Si cambias algo en `electron/` (main, preload, services) hay que parar `npm run dev` y relanzarlo**: el
  renderer se recarga solo, el proceso principal y el preload no. Un error típico de no hacerlo es
  `window.api.x.y is not a function`.
- **Si cambias algo en `server/` hay que volver a ejecutar `npm run backend`** (reconstruye la imagen y reinicia los
  contenedores). Para probar una ruta sin la app: `curl http://127.0.0.1:47365/api/...`. Para mirar la base de
  datos: Adminer en http://127.0.0.1:8080 (servidor `db`) o `docker compose exec db psql -U lolet -d lolet`.
- Si cambias `electron/extension/` o `electron/bookmarklet/marcador.js`, la app regenera `extension-chrome/` al
  arrancar y el usuario tiene que pulsar **Recargar** en `chrome://extensions`.

## Arquitectura en 30 segundos

```
src/ (React 19 + TS + Tailwind 4 + TanStack Query)        ← interfaz, sin acceso a red
  └─ window.api.*  (electron/preload.js, contextBridge)
       └─ ipcMain.handle(...)  (electron/main.js)          ← responde { ok, data } | { ok:false, error }
            ├─ services/backend.js     cliente HTTP del gateway + avisos en vivo (SSE /events)
            └─ services/extension.js   genera extension-chrome/ y el marcador
                 │ HTTP
Docker Compose (docker-compose.yml)
  gateway  127.0.0.1:47365   server/services/gateway/   reparte por prefijo, CORS, SSE (LISTEN lolet)
  ├─ bets     :4003          server/services/bets/      apuestas, combinadas, ajustes        → esquema bets
  ├─ esports  :4001          server/services/esports/   lolesports + Leaguepedia (cola, caché) → esquema esports
  ├─ odds     :4002          server/services/odds/      puente, normalizador, trabajos,
  │                                                     programador cada X min, histórico     → esquema odds
  └─ db       PostgreSQL 17  (volumen pgdata; 127.0.0.1:55432 para depurar)
Chrome del usuario
  ├─ marcador (bookmarklet)  electron/bookmarklet/marcador.js  → POST /odds
  └─ extensión MV3           electron/extension/               → GET /jobs/next cada 30 s (chrome.alarms) o
                                                                 página /auto; abre las casas, inyecta el lector, POST /odds
```

Más detalle en [`docs/specs/01-arquitectura.md`](docs/specs/01-arquitectura.md) y
[`docs/specs/07-backend.md`](docs/specs/07-backend.md).

## Cómo añadir una llamada nueva del renderer al backend

1. En el servicio que toque (`server/services/<servicio>/index.js`) añade la ruta `['GET', '/api/grupo/accion', handler]`.
   Si usa un prefijo nuevo, añádelo a `ROUTES` en el gateway. Relanza con `npm run backend`.
2. `electron/main.js` → `handle('grupo:accion', (...args) => backend.get('/api/grupo/accion', {...}))` dentro de `registerIpc()`.
3. `electron/preload.js` → expónla en el objeto `api` con `call('grupo:accion', ...)`.
4. `src/lib/types.ts` → añade la firma en la interfaz `Api`.
5. Úsala en el renderer con TanStack Query (`useQuery({ queryKey, queryFn: () => window.api... })`).
6. Si el renderer puede ir por delante del preload (recarga en caliente), protege la llamada con un fallback.

## Convenciones de código

- **TypeScript estricto** con `noUnusedLocals` y `noUnusedParameters`: nada de imports o variables sin usar.
- Alias `@/` → `src/`. Componentes base en `src/components/ui.tsx` (`Button`, `Card`, `Dialog`, `Field`, `Input`,
  `Select`, `Badge`, `Tabs`, `Empty`, `Loading`, `th`/`td`…). Úsalos en vez de crear otros.
- Estilo: tema oscuro `zinc`, acento `amber`, verde `emerald` para lo positivo, `rose` para lo negativo. Clases con `cn()`
  de `src/lib/format.ts`. Formato de números y dinero con `money`, `odd`, `pct`, `fmtDate`.
- Estado global (vista, partido abierto, formulario de apuesta, boleto de combinada, avisos) en `src/lib/app-context.tsx`.
- El proceso principal y el backend son CommonJS (`require`), el renderer ESM. El backend no usa framework: sólo
  `node:http` (`server/shared/service.js`) y `pg`. Comentarios cortos, en español, explicando el *porqué*.
- Nada de comentarios dentro de expresiones JSX (`{/* */}` entre props rompe el build en algunos sitios).
- Preferencias de UI por usuario (secciones plegadas, boleto) en `localStorage`, siempre dentro de `try/catch`.

## Cosas que se rompen con facilidad

- **Lectores de las casas** (`marcador.js` y `background.js`): dependen del HTML de Bet365, Winamax y Betway, que
  cambia sin aviso. Cada lectura guarda `capturas/captura-<casa>-<nombre>.json` en el proyecto; úsalas para ajustar
  selectores. Bet365 usa clases con hash (`rct-*`): busca por texto y estructura, no por clase.
- **Emparejar equipos** entre lolesports y las casas (`orient`/`teamScore` en `server/services/odds/equipos.js`): nombres distintos
  ("Gen.G Esports" / "GEN" / "Gen G"). Prueba con varios equipos.
- **Leaguepedia** limita mucho las peticiones anónimas: no quites la cola ni la caché de `leaguepedia.js`.
- **Lecturas programadas**: la extensión las hace de una en una y sólo con Chrome abierto. No subas mucho la
  frecuencia (Bet365 puede bloquear). En las programadas la pestaña nunca se pone delante.
- **Combinadas**: la cuota y el estado se recalculan en `server/services/bets/store.js` (`normalizeCombo`) a partir de las selecciones; no
  confíes en lo que mande el renderer.

## Especificaciones

| Fichero | Contenido |
|---|---|
| [`docs/specs/01-arquitectura.md`](docs/specs/01-arquitectura.md) | Procesos, IPC, carpetas, datos locales |
| [`docs/specs/02-partidos-y-directo.md`](docs/specs/02-partidos-y-directo.md) | Calendario, detalle del partido, partida en vivo |
| [`docs/specs/03-cuotas.md`](docs/specs/03-cuotas.md) | Servidor puente, marcador, extensión, lectores por casa, comparador |
| [`docs/specs/04-estadisticas.md`](docs/specs/04-estadisticas.md) | Jugadores y equipos (Leaguepedia), buscador con sugerencias |
| [`docs/specs/05-apuestas.md`](docs/specs/05-apuestas.md) | Registro de apuestas, combinadas, boleto, estadísticas, CSV |
| [`docs/specs/06-ajustes.md`](docs/specs/06-ajustes.md) | Ajustes, fuentes de datos y pendientes conocidos |
| [`docs/specs/07-backend.md`](docs/specs/07-backend.md) | Microservicios, gateway, PostgreSQL, migraciones, avisos en vivo |
