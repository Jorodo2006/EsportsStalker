# AGENTS.md

Guía para agentes de código (Claude Code, Codex, Copilot…) que trabajen en **EsportsStalker / LoL Esports Tracker**.
Lee esto antes de tocar nada. Las especificaciones detalladas de cada parte están en [`docs/specs/`](docs/specs/).

## Qué es

App de escritorio (Windows y Linux) con backend en Docker que son **tres apps en una**, con un selector arriba:
**LoL** (esports, turquesa), **Baloncesto** (NBA, WNBA, Euroliga y EuroCup, naranja) y **Tenis** (ATP y WTA, verde).
Cada una tiene sus partidos y directo, el comparador de cuotas de Winamax / Betway, sus stats y su registro de
apuestas con beneficio, ROI y gráficas. La **cartera es común** y las cuotas que se pulsan van a un **cupón** desde
el que se registran como simples o combinada. Electron es la interfaz; la lógica y los datos están en
microservicios Node con PostgreSQL (`server/`, `docker-compose.yml`). Las cuotas las lee solo, cada pocos minutos,
un Chromium sin cabeza dentro de Docker (contenedor `lector`).

## Reglas del proyecto (no negociables)

1. **Nada de APIs de pago ni APIs de cuotas.** Todas las fuentes son gratuitas. Las cuotas se leen de las páginas
   de las casas con el lector de Docker (`server/lector`, Chromium sin cabeza) o, de reserva, con el marcador o la
   extensión en el Chrome del usuario; nunca de una API de cuotas (OddsPapi, Pinnacle, The Odds API… se quitaron a
   propósito; ver `OBSOLETE` en `server/services/bets/store.js`). **Sin trucos anti-bot:** si una casa bloquea el
   lector, el trabajo termina con error y se ve en la app; no se disfraza el navegador.
2. **Casas soportadas: Winamax y Betway.** Bet365 se quitó porque no se deja leer desde Docker; William Hill y el
   resto, a petición del usuario.
3. **La interfaz y los comentarios van en español.** Textos de la UI, mensajes de error y comentarios del código.
4. **Ningún dato personal en el repo:** ni volcados de la base de datos, ni `data.json`, ni capturas
   (`capturas/`, `captura-*.json`), ni `casas-urls.json`, ni ficheros `*.migrado-*`, ni el `.env` con las credenciales.
   Ya están en `.gitignore`; no los saques de ahí. Las credenciales nuevas van al `.env` (mapeo en
   `server/shared/env.js`) y se documentan en `.env.example`.
5. **Las peticiones a internet las hace el backend** (`server/`). El renderer (`src/`) no hace peticiones: habla con
   `window.api`, y el proceso principal (`electron/`) las reenvía al gateway.
6. **Cada servicio sólo toca su esquema de PostgreSQL** (`bets`, `esports`, `odds`, `basket`, `tennis`). Si necesita datos de otro, llama a
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
  ├─ basket   :4004          server/services/basket/    NBA y WNBA (ESPN), Euroliga y EuroCup
  │                                                     (API de la Euroliga), días en hora de España → esquema basket
  ├─ tennis   :4005          server/services/tennis/    ATP y WTA (ESPN): partidos con sets, rankings → esquema tennis
  ├─ lector                  server/lector/             Chromium sin cabeza (Playwright): GET /jobs/next cada 5 s,
  │                                                     abre Winamax y Betway, pasa el lector del marcador, POST /odds
  └─ db       PostgreSQL 17  (volumen pgdata; 127.0.0.1:55432 para depurar)
Chrome del usuario (reserva; ya no hace falta)
  ├─ marcador (bookmarklet)  electron/bookmarklet/marcador.js  → POST /odds (el mismo lector que usa el contenedor)
  └─ extensión MV3           electron/extension/               → GET /jobs/next cada 30 s (chrome.alarms)
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
- Alias `@/` → `src/`. Piezas de las fichas, con aspecto de rótulo de retransmisión (`TvFrame`, `TvHeader`, `TvBand`, `TvRow`, `TvPortrait`, `TvTabs`, `Panel`, `KpiStrip`; colores `--tv-*` en `src/index.css`) en
  `src/components/viz.tsx`. Componentes base en `src/components/ui.tsx` (`Button`, `Card`, `Dialog`, `Field`, `Input`,
  `Select`, `Badge`, `Tabs`, `Empty`, `Loading`, `th`/`td`…). Úsalos en vez de crear otros.
- Estilo: tema azul tinta (la escala `zinc` está redefinida en `src/index.css`) y acento por app con las clases
  `amber` (turquesa en LoL, naranja en baloncesto, según `data-app`); verde `emerald` para lo positivo, `rose` para lo
  negativo. Barlow para el texto y `font-score` (Barlow Condensed) para marcadores y cifras. Piezas de partidos comunes
  a las dos apps en `src/components/sport.tsx` (tira de días, filtros, bloque de competición, fila, marcador).
  Clases con `cn()` de `src/lib/format.ts`. Formato de números y dinero con `money`, `odd`, `pct`, `fmtDate`.
- Estado global (app activa `lol` | `basket` | `tennis`, vista, partido abierto, formulario de apuesta, boleto de combinada, avisos) en `src/lib/app-context.tsx`.
- El proceso principal y el backend son CommonJS (`require`), el renderer ESM. El backend no usa framework: sólo
  `node:http` (`server/shared/service.js`) y `pg`. Comentarios cortos, en español, explicando el *porqué*.
- Nada de comentarios dentro de expresiones JSX (`{/* */}` entre props rompe el build en algunos sitios).
- Preferencias de UI por usuario (secciones plegadas, boleto) en `localStorage`, siempre dentro de `try/catch`.

## Cosas que se rompen con facilidad

- **Lectores de las casas** (`marcador.js`, `server/lector/runner.js` y `background.js`): dependen del HTML y del
  socket de Winamax y Betway, que cambian sin aviso. Cuando no encuentran algo guardan
  `capturas/captura-<casa>-<nombre>.json`; úsalas para ajustar selectores. `marcador.js` se monta en el contenedor
  `lector` y se vuelve a leer en cada trabajo: no hace falta reconstruir para probar un cambio.
- **Baloncesto en las casas** (`winamaxBasketInto` y `marketsInto` en `server/services/odds/odds.js`): los periodos
  salen del título ("1ª mitad - …") o de la pestaña de Betway (`marketGroup=1st-half`); las líneas de jugador usan la
  clave `player|<estadística>|<jugador>|<línea>`, con los mismos nombres de estadística que `BASKET_MARKETS`.
- **Emparejar equipos** entre lolesports / ESPN / la Euroliga y las casas (`orient`/`teamScore` en
  `server/services/odds/equipos.js`, `pageFind`/`winamaxFind` en el lector): nombres distintos ("Gen.G Esports" / "GEN",
  "Real" / "Real Madrid" / "R. Madrid"). Los equipos llevan `alt` con sus otros nombres. Prueba con varios equipos.
- **Leaguepedia** limita mucho las peticiones anónimas: no quites la cola ni la caché de `leaguepedia.js`.
- **Lecturas programadas** (`server/services/odds/scheduler.js`): LoL y baloncesto de las próximas N horas; el lector
  las hace de una en una. No subas mucho la frecuencia: las casas pueden bloquear.
- **Modelo de tenis** (`server/services/tennis/model.js`): si tocas algo, repite `backtest.js` antes de darlo por bueno. Mira la tabla de calibración y los juegos medios, no sólo el Brier, y ajusta siempre con un periodo distinto del que evalúas.
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
| [`docs/specs/08-baloncesto.md`](docs/specs/08-baloncesto.md) | App de baloncesto, lector de Docker, modelo de props y valor/fiabilidad común con LoL |
| [`docs/specs/09-tenis.md`](docs/specs/09-tenis.md) | App de tenis: datos de ESPN, cuotas por sets y juegos, modelo y recomendaciones |
