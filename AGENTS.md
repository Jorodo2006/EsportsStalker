# AGENTS.md

Guía para agentes de código (Claude Code, Codex, Copilot…) que trabajen en **EsportsStalker / LoL Esports Tracker**.
Lee esto antes de tocar nada. Las especificaciones detalladas de cada parte están en [`docs/specs/`](docs/specs/).

## Qué es

Web con login, para el ordenador y el móvil, con backend en Docker, que son **cuatro apps en una**, con un selector arriba:
**LoL** (esports, verde azulado), **Baloncesto** (NBA, WNBA, Euroliga y EuroCup, naranja), **Tenis** (ATP, Challengers y WTA, verde) y
**Fútbol** (LaLiga, Segunda, Premier, Serie A, Bundesliga, Ligue 1, competiciones europeas y Copa del Rey, azul).
Cada una tiene sus partidos y directo, el comparador de cuotas de Winamax / Betway, sus stats y su registro de
apuestas con beneficio, ROI y gráficas. Cada usuario tiene su **cartera, común a las cuatro apps**, y las cuotas que se pulsan van a un **cupón** desde
el que se registran como simples o combinada. La interfaz es React en el navegador; la lógica y los datos están en
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
5. **Las peticiones a internet las hace el backend** (`server/`). La interfaz (`src/`) sólo habla con `window.api`
   (`src/lib/api.ts`), que llama al gateway por el mismo origen. Sólo la web se abre a la red (puerto 8090); el gateway, PostgreSQL y
   Adminer se quedan en `127.0.0.1`.
6. **Cada servicio sólo toca su esquema de PostgreSQL** (`bets`, `esports`, `odds`, `basket`, `tennis`, `football`). Si necesita datos de otro, llama a
   su API. Los cambios de tablas van en una migración nueva (`migrations/NNN_*.sql`); nunca edites una ya aplicada.
7. **Los datos de cada usuario son suyos.** Toda consulta de `bets.bets` y `bets.user_settings` filtra por `user_id`, que sale
   de la cabecera `x-user-id` que pone el gateway tras comprobar la sesión; nunca de lo que mande el cliente. Toda ruta `/api`
   pide sesión salvo las de `PUBLIC` en el gateway.
8. **Nada de `git commit` ni `git push` sin que Jordi lo pida explícitamente en ese momento.** Prepara los cambios y
   espera su confirmación.

## Comandos

```bash
npm install
npm run backend    # docker compose up -d --build: web (http://127.0.0.1:8090) + PostgreSQL + gateway + servicios (Docker Desktop encendido)
npm run dev        # Vite (http://127.0.0.1:5173) con recarga al momento; necesita el backend en marcha
npm run typecheck  # tsc --noEmit
npm test           # pruebas del servidor (node:test, sin base de datos): validación de apuestas y firmas
npm run backend:debug  # como backend, más Adminer (http://127.0.0.1:8080); Adminer no arranca con npm run backend
npm run backend:prod   # producción: docker-compose.prod.yml (exige secretos en el .env, ver .env.example)
npm run db:backup      # copia de PostgreSQL en backups/ (ignorada por git); npm run db:restore -- <fichero> la restaura
npm run build      # typecheck + vite build
npm run extension  # prepara extension-chrome/, la extensión de reserva
npm run backend:logs  # registros del backend;  npm run backend:stop para pararlo
```

- Hay pocas pruebas automáticas (`npm test`, sólo lógica sin base de datos). Antes de dar algo por terminado: `npm run typecheck` y `npm test` sin errores y probar en `npm run dev`.
- `npm run dev` recarga los cambios de `src/` al momento. La web de `127.0.0.1:8090` es una imagen compilada: para verlos
  ahí hay que volver a ejecutar `npm run backend`.
- **Si cambias algo en `server/` hay que volver a ejecutar `npm run backend`** (reconstruye la imagen y reinicia los
  contenedores). Para probar una ruta sin la app hace falta la cookie de sesión: `curl -c c.txt -H "Content-Type: application/json" -d '{"username":"…","password":"…"}' http://127.0.0.1:47365/api/auth/login` y luego `curl -b c.txt http://127.0.0.1:47365/api/...`. Para mirar la base de
  datos: Adminer (con `npm run backend:debug`) en http://127.0.0.1:8080 (servidor `db`) o `docker compose exec db psql -U lolet -d lolet`.
- Si cambias `chrome/extension/` o `chrome/bookmarklet/marcador.js` y usas la extensión de reserva, ejecuta
  `npm run extension` y pulsa **Recargar** en `chrome://extensions`.

## Arquitectura en 30 segundos

```
src/ (React 19 + TS + Tailwind 4 + TanStack Query)        ← interfaz en el navegador
  └─ window.api.*  (src/lib/api.ts)                        ← { ok, data } | { ok:false, error } y avisos en vivo (SSE /events)
       │ HTTP, mismo origen: /api y /events
Docker Compose (docker-compose.yml)
  web      0.0.0.0:8090      web/                       nginx: la web compilada y proxy al gateway (sólo /api y /events)
  gateway  127.0.0.1:47365   server/services/gateway/   comprueba la sesión, reparte por prefijo, SSE (LISTEN lolet)
  ├─ bets     :4003          server/services/bets/      usuarios, apuestas, combinadas, ajustes → esquema bets
  ├─ esports  :4001          server/services/esports/   lolesports + Leaguepedia (cola, caché) → esquema esports
  ├─ odds     :4002          server/services/odds/      puente, normalizador, trabajos,
  │                                                     programador cada X min, histórico     → esquema odds
  ├─ basket   :4004          server/services/basket/    NBA y WNBA (ESPN), Euroliga y EuroCup
  │                                                     (API de la Euroliga), días en hora de España → esquema basket
  ├─ tennis   :4005          server/services/tennis/    ATP y WTA (ESPN): partidos con sets, rankings. Puntos del juego (WTA, LiveScore)
  │                                                     y Challengers (LiveScore) → esquema tennis
  ├─ football :4006          server/services/football/  fútbol (ESPN): partidos por día en hora de España, ficha (goles, tarjetas,
  │                                                     estadísticas, alineaciones, forma), clasificaciones → esquema football
  ├─ lector                  server/lector/             Chromium sin cabeza (Playwright): GET /jobs/next cada 5 s,
  │                                                     abre Winamax y Betway, pasa el lector del marcador, POST /odds
  └─ db       PostgreSQL 17  (volumen pgdata; 127.0.0.1:55432 para depurar)
Chrome del usuario (reserva; ya no hace falta)
  ├─ marcador (bookmarklet)  chrome/bookmarklet/marcador.js  → POST /odds (el mismo lector que usa el contenedor)
  └─ extensión MV3           chrome/extension/                 → GET /jobs/next cada 30 s (chrome.alarms)
```

Más detalle en [`docs/specs/01-arquitectura.md`](docs/specs/01-arquitectura.md) y
[`docs/specs/07-backend.md`](docs/specs/07-backend.md).

## Cómo añadir una llamada nueva de la interfaz al backend

1. En el servicio que toque (`server/services/<servicio>/index.js`) añade la ruta `['GET', '/api/grupo/accion', handler]`.
   Si usa un prefijo nuevo, añádelo a `ROUTES` en el gateway. Si es de un usuario, léelo de `req.headers['x-user-id']`. Relanza con `npm run backend`.
2. `src/lib/types.ts` → añade la firma en la interfaz `Api`.
3. `src/lib/api.ts` → impleméntala con `get` o `call`.
4. Úsala con TanStack Query (`useQuery({ queryKey, queryFn: () => window.api... })`).

## Convenciones de código

- **TypeScript estricto** con `noUnusedLocals` y `noUnusedParameters`: nada de imports o variables sin usar.
- Alias `@/` → `src/`. Piezas de las fichas, paneles planos (`TvFrame`, `TvHeader`, `TvBand`, `TvRow`, `TvPortrait`, `TvTabs`, `Panel`, `KpiStrip`; colores `--tv-*` en `src/index.css`) en
  `src/components/viz.tsx`. Componentes base en `src/components/ui.tsx` (`Button`, `Card`, `Dialog`, `Field`, `Input`,
  `Select`, `Badge`, `Tabs`, `Empty`, `Loading`, `th`/`td`…). Úsalos en vez de crear otros.
- Estilo sobrio, que no parezca hecho con una IA: fondo oscuro neutro, paneles `panelCls` (superficie `bg-surface`, borde
  fino, esquinas de 10 px; controles a 6 px) y sin degradados, neones, brillos, sombras de color ni puntos que laten. Nada de
  barritas de color delante de los títulos, cajas con borde discontinuo e icono en un círculo, ni todo en píldoras. Cada tipo
  de control tiene su forma, con los estilos de `ui.tsx`: acción principal rellena del acento (`Button`), secundaria gris,
  pestañas en selector segmentado con la elegida en gris claro (`segWrap` + `seg`, `Tabs`), las de la ficha del partido
  subrayadas y partiéndose en dos líneas si no caben (`SheetTabs`), filtros con contorno (`chip`, `TvTabs`) y cuotas en ficha
  rellena (`oddBtn`). La escala `zinc` está redefinida en `src/index.css` (grises neutros) y el acento por app va con las clases
  `amber` (verde azulado en LoL, naranja en baloncesto, verde en tenis, azul en fútbol, apagados, según `data-app`); verde `emerald` para lo
  positivo, `rose` para lo negativo y lo que está en juego. Una sola letra, Inter: `font-score` y `font-mono` apuntan a ella
  con cifras tabulares, para cifras, cuotas y dinero. Las etiquetas van en minúsculas normales (`label-data`, `th`), nunca en
  mayúsculas espaciadas. Piezas de partidos comunes a las apps de deporte en `src/components/sport.tsx` (tira de días, filtros, bloque de
  competición con tarjetas `MatchCard`, sección `LiveSection` de partidos en juego, marcador).
  Clases con `cn()` de `src/lib/format.ts`. Formato de números y dinero con `money`, `odd`, `pct`, `fmtDate`.
- Estructura de pantalla (`src/App.tsx`), en tres columnas: desde `lg` un menú lateral (deportes, navegación,
  competiciones del día y cartera); desde 1400 px además una columna derecha con el cupón fijo (`<Coupon docked />`) y
  los partidos en directo. Por debajo, cabecera arriba, barra inferior y cupón flotante. Las vistas de partidos publican
  sus competiciones para el menú con `useSections` y abren el partido pedido desde la columna derecha con `useFocus`.
  Como el centro es más estrecho que la pantalla, las rejillas de dos columnas del contenido van con `2xl:`, no con `xl:`.
- Estado global (app activa `lol` | `basket` | `tennis` | `football`, vista, partido abierto, formulario de apuesta, boleto de combinada, avisos, competiciones del menú lateral) en `src/lib/app-context.tsx`.
- El backend es CommonJS (`require`), la interfaz ESM. El backend no usa framework: sólo
  `node:http` (`server/shared/service.js`) y `pg`. Comentarios cortos, en español, explicando el *porqué*.
- Nada de comentarios dentro de expresiones JSX (`{/* */}` entre props rompe el build en algunos sitios).
- Preferencias de UI (secciones plegadas, boleto) en `localStorage`, siempre dentro de `try/catch`; el boleto se borra al salir.
- **Móvil:** todo tiene que caber en 375 px sin que la página se desplace de lado. Se diseña de móvil hacia arriba con `sm:` y `lg:`; desde `lg` se ve la navegación de escritorio, y por debajo la barra inferior. Las tablas anchas van dentro de `overflow-x-auto` o tienen versión en tarjetas (`BetCard`).

## Cosas que se rompen con facilidad

- **Lectores de las casas** (`marcador.js`, `server/lector/runner.js` y `background.js`): dependen del HTML y del
  socket de Winamax y Betway, que cambian sin aviso. Cuando no encuentran algo guardan
  `capturas/captura-<casa>-<nombre>.json`; úsalas para ajustar selectores. `marcador.js` se monta en el contenedor
  `lector` y se vuelve a leer en cada trabajo: no hace falta reconstruir para probar un cambio.
- **Baloncesto en las casas** (`winamaxBasketInto` y `marketsInto` en `server/services/odds/odds.js`): los periodos
  salen del título ("1ª mitad - …") o de la pestaña de Betway (`marketGroup=1st-half`); las líneas de jugador usan la
  clave `player|<estadística>|<jugador>|<línea>`, con los mismos nombres de estadística que `BASKET_MARKETS`.
- **Fútbol en las casas** (`winamaxFootballInto` y `betwayFootballInto` en `odds.js`): el periodo sale sólo del título,
  nunca de la pestaña (la "1er Tiempo" de Betway repite los mercados del partido). El 1X2 lleva empate (`x`). Los nombres
  del partido (`targetOfFootball` y `upcomingFootball`) tienen que coincidir, porque son la clave en `odds`
  (`docs/specs/11-futbol.md`).
- **Emparejar equipos** entre lolesports / ESPN / la Euroliga y las casas (`orient`/`teamScore` en
  `server/services/odds/equipos.js`, `pageFind`/`winamaxFind` en el lector): nombres distintos ("Gen.G Esports" / "GEN",
  "Real" / "Real Madrid" / "R. Madrid"). Los equipos llevan `alt` con sus otros nombres. Prueba con varios equipos.
- **Leaguepedia** limita mucho las peticiones anónimas: no quites la cola ni la caché de `leaguepedia.js`.
- **Lecturas programadas** (`server/services/odds/scheduler.js`): LoL, baloncesto y tenis, más seguidas cuanto más cerca
  está el partido; el lector las hace de una en una, primero las más cercanas. No subas mucho la frecuencia: las casas
  pueden bloquear.
- **Escáner de líneas y puntos de equipo** (`scanLine` en `src/lib/basket-model.ts`, `src/lib/basket-teams.ts`): el escáner debe dar la misma probabilidad que el analizador, y los parámetros de los puntos están ajustados con datos (cifras y límites en `docs/specs/08-baloncesto.md`). No guardes logs de ESPN enteros en la caché: pesan 700 KB cada uno (`remember` y `bulk` en `cache.js`).
- **Recomendaciones de baloncesto** (`src/lib/basket-picks.ts`, `blendWithMarket` y `tooFar` en `src/lib/value.ts`): no ordenes por el EV del modelo a secas. Sube a la cabeza sus propios errores: en la prueba salían EV de +65 % con el modelo diciendo 29 % y la casa 10 %. Los pesos frente a la casa son una decisión, no una medida (`docs/specs/08-baloncesto.md`).
- **Puntos y Challengers de tenis** (`points.js`, `livescore.js`): salen de APIs sin documentar que pueden cambiar sin aviso. Si fallan, el marcador tiene que seguir saliendo. Los Challenger no deben entrar en las lecturas programadas ni en el modelo. Antes de añadir otra fuente, mira su `robots.txt` (`docs/specs/09-tenis.md`).
- **Modelo de tenis** (`server/services/tennis/model.js`): si tocas algo, repite `backtest.js` antes de darlo por bueno. Mira la tabla de calibración y los juegos medios, no sólo el Brier, y ajusta siempre con un periodo distinto del que evalúas.
- **Combinadas**: la cuota y el estado se recalculan en `server/services/bets/store.js` (`normalizeCombo`) a partir de las selecciones; no
  confíes en lo que mande el renderer.
- **Resolución automática** (`server/services/bets/settle.js`): depende de que las claves de mercado del comparador
  (`odds.js`) y los nombres de estadística de jugador no cambien; si cambias una, ajusta `evaluate` y repite `npm test`
  (`resolver.test.js`). Ante la duda, que devuelva `null` (se resuelve a mano): una apuesta mal resuelta mueve dinero.
  Es lo único que lee las apuestas de todos los usuarios (`getBet`): nunca lo expongas en una ruta.

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
| [`docs/specs/11-futbol.md`](docs/specs/11-futbol.md) | App de fútbol: ligas de ESPN, ficha del partido, clasificaciones y lo que falta (cuotas y modelo) |
| [`docs/specs/10-base-de-datos.md`](docs/specs/10-base-de-datos.md) | Esquema de PostgreSQL: tablas, relaciones, diagramas y puntos a vigilar |
