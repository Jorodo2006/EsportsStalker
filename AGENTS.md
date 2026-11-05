# AGENTS.md

Guía para agentes de código (Claude Code, Codex, Copilot…) que trabajen en **EsportsStalker / LoL Esports Tracker**.
Lee esto antes de tocar nada. Las especificaciones detalladas de cada parte están en [`docs/specs/`](docs/specs/).

## Qué es

Web con login, para el ordenador y el móvil, con backend en Docker, que son **tres apps en una**, con un selector arriba:
**LoL** (esports, turquesa), **Baloncesto** (NBA, WNBA, Euroliga y EuroCup, naranja) y **Tenis** (ATP y WTA, verde).
Cada una tiene sus partidos y directo, el comparador de cuotas de Winamax / Betway, sus stats y su registro de
apuestas con beneficio, ROI y gráficas. Cada usuario tiene su **cartera, común a las tres apps**, y las cuotas que se pulsan van a un **cupón** desde
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
6. **Cada servicio sólo toca su esquema de PostgreSQL** (`bets`, `esports`, `odds`, `basket`, `tennis`). Si necesita datos de otro, llama a
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
npm run typecheck  # tsc --noEmit: es la única comprobación automática que hay
npm run build      # typecheck + vite build
npm run extension  # prepara extension-chrome/, la extensión de reserva
npm run backend:logs  # registros del backend;  npm run backend:stop para pararlo
```

- No hay tests automáticos. Antes de dar algo por terminado: `npm run typecheck` sin errores y probar en `npm run dev`.
- `npm run dev` recarga los cambios de `src/` al momento. La web de `127.0.0.1:8090` es una imagen compilada: para verlos
  ahí hay que volver a ejecutar `npm run backend`.
- **Si cambias algo en `server/` hay que volver a ejecutar `npm run backend`** (reconstruye la imagen y reinicia los
  contenedores). Para probar una ruta sin la app hace falta la cookie de sesión: `curl -c c.txt -H "Content-Type: application/json" -d '{"username":"…","password":"…"}' http://127.0.0.1:47365/api/auth/login` y luego `curl -b c.txt http://127.0.0.1:47365/api/...`. Para mirar la base de
  datos: Adminer en http://127.0.0.1:8080 (servidor `db`) o `docker compose exec db psql -U lolet -d lolet`.
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
  ├─ tennis   :4005          server/services/tennis/    ATP y WTA (ESPN): partidos con sets, rankings → esquema tennis
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
- Alias `@/` → `src/`. Componentes base en `src/components/ui.tsx` (`Button`, `Card`, `Dialog`, `Field`, `Input`,
  `Select`, `Badge`, `Tabs`, `Empty`, `Loading`, `th`/`td`…). Úsalos en vez de crear otros.
- Estilo: tema azul tinta (la escala `zinc` está redefinida en `src/index.css`) y acento por app con las clases
  `amber` (turquesa en LoL, naranja en baloncesto, según `data-app`); verde `emerald` para lo positivo, `rose` para lo
  negativo. Barlow para el texto y `font-score` (Barlow Condensed) para marcadores y cifras. Piezas de partidos comunes
  a las dos apps en `src/components/sport.tsx` (tira de días, filtros, bloque de competición, fila, marcador).
  Clases con `cn()` de `src/lib/format.ts`. Formato de números y dinero con `money`, `odd`, `pct`, `fmtDate`.
- Estado global (app activa `lol` | `basket` | `tennis`, vista, partido abierto, formulario de apuesta, boleto de combinada, avisos) en `src/lib/app-context.tsx`.
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
- **Emparejar equipos** entre lolesports / ESPN / la Euroliga y las casas (`orient`/`teamScore` en
  `server/services/odds/equipos.js`, `pageFind`/`winamaxFind` en el lector): nombres distintos ("Gen.G Esports" / "GEN",
  "Real" / "Real Madrid" / "R. Madrid"). Los equipos llevan `alt` con sus otros nombres. Prueba con varios equipos.
- **Leaguepedia** limita mucho las peticiones anónimas: no quites la cola ni la caché de `leaguepedia.js`.
- **Lecturas programadas** (`server/services/odds/scheduler.js`): LoL, baloncesto y tenis, más seguidas cuanto más cerca
  está el partido; el lector las hace de una en una, primero las más cercanas. No subas mucho la frecuencia: las casas
  pueden bloquear.
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
| [`docs/specs/09-tenis.md`](docs/specs/09-tenis.md) | App de tenis: datos de ESPN, cuotas por sets y juegos |
