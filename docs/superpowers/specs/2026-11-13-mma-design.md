# MMA (UFC): quinta app de Sharpex

Rama: `mma`. Fecha: 2026-11-13. Estado: pendiente de aprobación.

## Intención

Jordi quiere ver todo lo de MMA en Sharpex: carteleras y combates, estadísticas de luchadores, previsión de victoria
y, como en las otras apps, el comparador de cuotas de Winamax / Betway, el cupón y el registro de apuestas con
beneficio y ROI. Es la quinta app del selector (junto a LoL, Baloncesto, Tenis y Fútbol) y sigue el mismo patrón que
tenis y fútbol, sin romper nada de lo existente.

Jordi eligió construirlo **de una vez** (no por fases validadas una a una), incluidas las cuotas.

## Objetivos

- App `mma` en el selector (acento propio, apagado, según `data-app`), con vistas de **Combates** (carteleras por
  evento, combate principal y co-principal, en directo y resultados) y **Luchadores** (ficha: récord, métodos de victoria,
  estadísticas, historial, forma). Aparece en el buscador (Ctrl+K), en **Hoy** y en el menú lateral.
- **Previsión de victoria** por combate: probabilidad de cada luchador, y de método (KO/TKO, sumisión, decisión) y
  de duración si los datos lo permiten, con recomendaciones de valor como en tenis y fútbol y acierto del modelo en
  `bets.predictions`.
- **Cuotas** de Winamax y Betway leídas por el lector de Docker: ganador, método de victoria, total de asaltos y
  si llega a decisión (lo que ofrezcan las casas).
- **Cupón, registro de apuestas y resolución automática** con deporte `mma`.
- Móvil a 375 px, español, estilo sobrio del proyecto.

## No objetivos

- Otras organizaciones que no sean UFC y PFL (Bellator, ONE, KSW…). Jordi pidió **UFC, PFL y WOW**. El servicio se monta con una lista de ligas (`LEAGUES`: `ufc`, `pfl`, `wow`) para
  poder añadir otras más tarde con una línea.
- Cuotas en directo durante el combate, ni apuestas de asaltos concretos si las casas no las exponen de forma estable.
- Cualquier API de pago o de cuotas, y UFCStats u otras webs sin permiso claro (regla 1).

## WOW (organización española, wowmma.com)

ESPN no la tiene, así que es la única fuente que no es ESPN. Su web es estática (Webflow), el `robots.txt` permite rastrear todo
salvo rutas con parámetros (`/*?*`, que no se piden) y no hay API: el servicio lee el HTML de `/wow-fc-events`, `/wow-events/wow-NN-ciudad`
y `/mma-campeones`, con petición educada (User-Agent propio, caché larga, una petición cada vez). Cada combate trae lado rojo/azul, edad,
peso, altura, récord, categoría, y en los pasados ganador, método, asalto y tiempo. Limitaciones asumidas:
- La cartelera se publica tarde (WOW 34, del 21-nov, aún está vacía): hasta entonces no hay combates que mostrar ni cuotas.
- Sin API, un cambio de diseño de la web rompe la lectura: si falla, el resto de MMA sigue funcionando y se ve el aviso en la app.
- Sin estadísticas finas ni historial completo por luchador (solo récord y combates de WOW): el modelo de WOW usa Elo propio con el
  histórico de WOW más el récord, y se marca como menos fiable que el de UFC/PFL.
- Las cuotas dependen de que Winamax o Betway las publiquen (la web de WOW enlaza a Betway).

## Antiobjetivos (fracaso aunque funcione)

- Un modelo que presente probabilidades sin haberse medido: no se da por bueno sin `backtest.js`.
- Una apuesta mal resuelta automáticamente: ante la duda, `null` (a mano).
- Tocar el comportamiento de LoL, baloncesto, tenis o fútbol, o editar migraciones ya aplicadas.
- Disfrazar el navegador para saltarse el bloqueo de una casa (si bloquea, error visible en la app).

## Restricciones (de AGENTS.md)

Fuentes gratuitas; casas solo Winamax y Betway; UI y comentarios en español; sin datos personales en el repo; peticiones a
internet solo desde el backend; cada servicio solo toca su esquema (`mma`); migraciones nuevas, nunca editar las
aplicadas; nada de `git commit`/`push` sin que Jordi lo pida en ese momento.

## Aproximaciones consideradas

| | Qué es | Pros / contras |
|---|---|---|
| **A. Por fases, validando** | Datos → modelo → cuotas → apuestas, probando cada una | Detecta antes los fallos del lector; tarda más hasta ver las cuotas |
| **B. De una vez (elegida por Jordi)** | Las cuatro partes en un solo bloque de trabajo | Más rápido; el riesgo es no saber si un fallo viene de los datos o de las cuotas |

Mitigación de B: dentro del trabajo, el orden de construcción sigue siendo datos → modelo → cuotas → apuestas, y cada
parte se verifica (typecheck, `npm test`, backtest, llamada real a la ruta) antes de empezar la siguiente, aunque no se
pare a esperar aprobación entre ellas.

Modelo de predicción (mi decisión): solo datos de ESPN. Un Elo propio calculado sobre el historial de combates de cada
luchador (resultado y método), con ajuste por categoría de peso, inactividad, edad, alcance y racha, y calibración
medida con `backtest.js` (ajuste con un periodo y comprobación con otro, mirando la tabla de calibración y no solo el
Brier, como en tenis).

## Diseño técnico

- **Servicio `mma`** (`server/services/mma/`, puerto 4007, esquema `mma`, `migrations/001_inicial.sql`): ESPN
  `site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard` (eventos y combates) y `sports.core.api.espn.com/v2/sports/mma/...`
  (luchadores y estadísticas). Caché con `cachedJSON` (`mma.cache`), días en hora de España, fotos con `sized()`.
  Rutas bajo `/api/mma/...` y `search`. Módulos: `index.js`, `model.js`, `picks.js`, `backtest.js`, `photos.js`.
- **Gateway y Docker:** prefijo `/api/mma` en `ROUTES`, `mma` en `SEARCH`, servicio en `docker-compose.yml` y
  `docker-compose.prod.yml`, esquema creado en la inicialización.
- **Odds** (`odds.js`, `scheduler.js`, `bridge.js`, `server/lector/runner.js`): `sport: 'mma'` en `SPORT_CFG` (id de
  deporte de Winamax y categoría de Betway), `upcomingMma` en el programador (más seguidas cuanto más cerca el evento, y
  sin subir la frecuencia total), emparejado de luchadores con `alt` y `teamScore`, mercados normalizados con claves
  estables (`moneyline`, `method|...`, `rounds|...`). Los selectores se ajustan leyendo las páginas reales con el
  lector; si no se encuentran, se guarda captura como ya se hace.
- **Apuestas:** migración nueva en `bets` ampliando los `CHECK` de `sport` (`'mma'` en `bets` y `bet_legs`), `SPORTS` en
  `store.js` y `predictions.js`, `settle.js` con la resolución de ganador/método/asaltos desde el resultado de ESPN
  (con `null` si hay duda: anulado, sin resultado, empate técnico, no combate) y tests en `resolver.test.js`.
- **Interfaz:** `Sport` y app `mma` en `types.ts` / `app-context.tsx`, `api.ts`, vistas `MmaFights.tsx` y
  `MmaFighters.tsx`, componentes `MmaPicks.tsx` y ficha del luchador/combate reutilizando `viz.tsx`, `sport.tsx` y
  `ui.tsx`; entra en `TodayView` con su nota `mmaScore` (peleas de título y de los mejores clasificados). Consultas de
  cuotas con `oddsMeta`, como el resto.
- **Docs:** `docs/specs/12-mma.md`, y actualizar `AGENTS.md`, `07-backend.md`, `10-base-de-datos.md` y `README.md`.

## Limpieza (pedida por Jordi)

Se hace en el mismo trabajo, en commits/cambios separados de MMA:
- Borrar `server/services/mma/` vacío (se vuelve a crear con contenido).
- Borrar lo regenerable e ignorado por git: `capturas/` (JSON de depuración, incluidas las de Bet365), `dist/`,
  `extension-chrome/`, `backups/` vacío.
- Quitar los restos de Bet365 que ya no sirven (`src/assets/books/LEEME.txt`, restos en `BookIcon.tsx`, comentarios,
  `chrome/`), dejando el `OBSOLETE` de `bets/store.js`, que es intencionado, y lo que documenta el porqué en los specs.
- No se toca: `tareas.md` y `.claude/` (personales), `.env`, `node_modules`.
- Los ficheros sin `require` (`runner.js`, `reset-password.js`, los `backtest.js`) son puntos de entrada manuales: no se borran.
- La limpieza de ficheros del repo se revisa con `git status` antes de dar nada por hecho.

## Verificación

`npm run typecheck` y `npm test` sin errores; backtest de MMA con calibración razonable (cifras en `12-mma.md`);
`npm run backend` y llamadas reales a `/api/mma/...` con sesión; lector leyendo UFC 334 en Winamax y Betway (o error
claro y captura si bloquean); prueba en `npm run dev` en escritorio y a 375 px.

## Para el constructor

- Decide aquí quién resuelve cada duda menor (nombres de mercados, color del acento: rojo apagado (aprobado por Jordi; azul/verde ya están usados)).
- Si ESPN no da suficiente historial por luchador, el modelo cae a récord y estadísticas simples y se documenta.
- Si una casa no ofrece MMA en el momento de probar (sin evento próximo), se deja el lector listo y probado con lo que haya,
  y se dice.
