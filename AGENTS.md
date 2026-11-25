# AGENTS.md

Guía para agentes de código (Claude Code, Codex, Copilot…) que trabajen en **Sharpex** (antes Statex, EsportsStalker y LoL Esports Tracker).
Los identificadores internos siguen siendo `lolet` (base de datos y usuario de PostgreSQL, cookie `lolet_session`, canal de avisos
`lolet`, `window.__lolet_*` del marcador): no los renombres, romperían los datos y las sesiones de un despliegue ya hecho.
Lee esto antes de tocar nada. Las especificaciones detalladas de cada parte están en [`docs/specs/`](docs/specs/).

## Qué es

Web con login, para el ordenador y el móvil, con backend en Docker, que son **cinco apps en una**, con un selector arriba:
**LoL** (esports, verde azulado), **Baloncesto** (NBA, WNBA, Euroliga, EuroCup y NBL, naranja), **Tenis** (ATP, Challengers y WTA, verde) y
**Fútbol** (LaLiga, Segunda, Premier, Serie A, Bundesliga, Ligue 1, competiciones europeas, Copa del Rey, selecciones: Nations League y amistosos, y femenino: Champions, Liga F y WSL, azul) y
**MMA** (UFC, PFL y WOW, la organización española; rojo apagado).
Cada una tiene sus partidos y directo, el comparador de cuotas de Winamax / Betway, sus stats y su registro de
apuestas con beneficio, ROI y gráficas. Cada usuario tiene su **cartera, común a las cinco apps**, y las cuotas que se pulsan van a un **cupón** desde
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
6. **Cada servicio sólo toca su esquema de PostgreSQL** (`bets`, `esports`, `odds`, `basket`, `tennis`, `football`, `mma`, `challenger`). Si necesita datos de otro, llama a
   su API. Los cambios de tablas van en una migración nueva (`migrations/NNN_*.sql`); nunca edites una ya aplicada.
7. **Los datos de cada usuario son suyos.** Toda consulta de `bets.bets` y `bets.user_settings` filtra por `user_id`, que sale
   de la cabecera `x-user-id` que pone el gateway tras comprobar la sesión; nunca de lo que mande el cliente. Toda ruta `/api`
   pide sesión salvo las públicas de `server/services/gateway/public.js` (entrar, y leer partidos, estadísticas y cuotas). Una ruta
   nueva de un deporte que sea de lectura queda abierta sin más: si es de un usuario o son recomendaciones, ciérrala ahí y en
   `server/test/publico.test.js`.
8. **Nada de `git commit` ni `git push` sin que lo pida explícitamente en ese momento Jordi, Hugo o Roberto** (basta con uno
   de los tres). Prepara los cambios y espera su confirmación.
9. **Los datos de producción** (la base de datos de la VM compartida, `/opt/stacks/sharpex`) **no se leen ni se tocan sin el
   permiso de Jordi, Hugo o Roberto** (basta con uno de los tres) para esa tarea. Aun con permiso, sólo lo que haga falta y en
   modo lectura (`SET default_transaction_read_only = on`), salvo que pidan expresamente cambiar algo; nada de copiar el `.env`
   ni los datos de los usuarios fuera de la VM.

## Comandos

```bash
npm install
npm run backend    # docker compose up -d --build: web (http://127.0.0.1:8090) + PostgreSQL + gateway + servicios (Docker Desktop encendido)
npm run dev        # Vite (http://127.0.0.1:5173) con recarga al momento; necesita el backend en marcha
npm run typecheck  # tsc --noEmit
npm test           # pruebas del servidor (node:test, sin base de datos) y de la lógica de la interfaz (Vitest, src/**/*.test.ts)
npm run test:ui    # Vitest en modo vigilancia, mientras se toca un modelo
npm run backend:debug  # como backend, más Adminer (http://127.0.0.1:8080); Adminer no arranca con npm run backend
npm run backend:prod   # producción: docker-compose.prod.yml (exige secretos en el .env, ver .env.example)
npm run db:backup      # copia de PostgreSQL en backups/ (ignorada por git); npm run db:restore -- <fichero> la restaura
npm run build      # typecheck + vite build
npm run extension  # prepara extension-chrome/, la extensión de reserva
npm run backend:logs  # registros del backend;  npm run backend:stop para pararlo
```

- Las pruebas son de lógica, sin base de datos ni navegador: las del servidor en `server/test/` (node:test) y las de la interfaz junto a su fichero (`src/lib/value.test.ts`, `basket-model.test.ts`; Vitest, que entiende el alias `@/`). Si tocas el valor, el veredicto, quitar el margen o un modelo de `src/lib/`, añade o ajusta su prueba. Antes de dar algo por terminado: `npm run typecheck` y `npm test` sin errores y probar en `npm run dev`. La CI (`.github/workflows/ci.yml`) pasa lo mismo en cada push.
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
  ├─ basket   :4004          server/services/basket/    NBA, WNBA y NBL (ESPN), Euroliga y EuroCup
  │                                                     (API de la Euroliga), días en hora de España → esquema basket
  ├─ tennis   :4005          server/services/tennis/    ATP y WTA (ESPN): partidos con sets, rankings. Puntos del juego (WTA, LiveScore)
  │                                                     y Challengers (LiveScore) → esquema tennis
  ├─ football :4006          server/services/football/  fútbol (ESPN): partidos por día en hora de España, ficha (goles, tarjetas,
  │                                                     estadísticas, alineaciones, forma), clasificaciones, modelo de goles y recomendaciones → esquema football
  ├─ mma      :4007          server/services/mma/       MMA: UFC y PFL (ESPN) y WOW (wowmma.com): combates por día en hora de España, ficha del luchador,
  │                                                     ranking y modelo Elo, previsión de victoria/método/duración y recomendaciones → esquema mma
  ├─ challenger :4008        server/services/challenger/ motor de valor de los Challenger (server/sharpex-tenis): Elo con el histórico de
  │                                                     Sackmann y TennisMyLife (volumen challenger, se reentrena cada día), escáner de
  │                                                     cuotas e historial de picks encadenado con hashes → esquema challenger
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
  subrayadas, en una línea que se desliza de lado en el móvil y partiéndose en dos desde `sm` (`SheetTabs`), filtros con contorno (`chip`, `TvTabs`) y cuotas en ficha
  rellena (`oddBtn`). La escala `zinc` está redefinida en `src/index.css` (grises neutros) y el acento por app va con las clases
  `amber` (verde azulado en LoL, naranja en baloncesto, verde en tenis, azul en fútbol, apagados, según `data-app`); verde `emerald` para lo
  positivo, `rose` para lo negativo y lo que está en juego. Una sola letra, Inter: `font-score` y `font-mono` apuntan a ella
  con cifras tabulares, para cifras, cuotas y dinero. Las etiquetas van en minúsculas normales (`label-data`, `th`), nunca en
  mayúsculas espaciadas. Piezas de partidos comunes a las apps de deporte en `src/components/sport.tsx` (tira de días, filtros, bloque de
  competición con tarjetas `MatchCard`, sección `LiveSection` de partidos en juego, marcador).
  Clases con `cn()` de `src/lib/format.ts`. Formato de números y dinero con `money`, `odd`, `pct`, `decimal`, `fmtDate`: **coma decimal en todo**, cuotas incluidas («2,10»). Las líneas que llegan del servidor con punto («MEM -9.5») se enseñan con `decEs`; no las cambies en el servidor ni en lo guardado, que el resolvedor lee esos textos. Lo que ESPN da en inglés se traduce: el estado del partido de baloncesto en el servidor (`statusEs` de `server/services/basket/espn.js`), y las bajas y posiciones sólo al pintarlas (`injuryEs`, `posEs` de `src/lib/basket-labels.ts`), porque el modelo busca «Out» en inglés.
- Estructura de pantalla (`src/App.tsx`), en tres columnas: desde `lg` un menú lateral (deportes, navegación,
  competiciones del día y cartera); desde 1400 px además una columna derecha de 300 px (el ancho de los anuncios) con el
  cupón fijo (`<Coupon docked />`), un anuncio de 300×250, los partidos en directo y otro de 300×600. Por debajo, cabecera
  arriba, barra inferior y cupón flotante. Los huecos de anuncios son `AdSlot` (`src/components/AdSlot.tsx`): con
  `ADSENSE_CLIENT` y los bloques en el `.env`, el anuncio de AdSense; sin ellos, el marcador en desarrollo y nada en producción. Las vistas de partidos publican
  sus competiciones para el menú con `useSections`; el partido abierto y el día los leen de la dirección (`useRouteMatch`, `useRouteDay`).
  Como el centro es más estrecho que la pantalla, las rejillas de dos columnas del contenido van con `2xl:`, no con `xl:`.
- La app se abre en **Partidos** del deporte elegido (vista `matches`), que ya empieza en el día de hoy y deja ir a otros días.
  La primera visita (sin deporte guardado) se abre en el que tiene más partidos en juego o, si no hay, más partidos hoy (`busiestSport` en `src/lib/live.ts`; `useLive` junta los partidos en juego de los cinco). Una lista vacía usa `NoGames` (`sport.tsx`): lo dice en palabras del usuario y ofrece el próximo día con partidos (`useNextDay`) y los deportes con algo en juego. Nada de «Prueba otro día» a secas ni mensajes técnicos.
  La portada *Hoy* (`TodayView`) se quitó en la rama `hugodev` porque repetía lo de *Partidos* y confundía. Si vuelve, está en el
  historial de git. Las recomendaciones de cada deporte van en su pantalla *Recomendaciones* (selector *Partidos / Recomendaciones*)
  y, en pantallas anchas, al lado de la lista: primero los partidos. El selector es `ModeSwitch` (`sport.tsx`), justo bajo el título:
  grande y con Recomendaciones teñida del acento, porque con dos botones pequeños nadie las encontraba. Hasta que se abren una vez
  (`picks-seen` en `localStorage`) da un salto corto al cargar (`.attn` en `index.css`, tres veces y para): es la única animación
  para llamar la atención que se admite, y no la conviertas en algo que lata sin fin. MMA enseña las suyas dentro de la lista y
  LoL no tiene.
- **Tenis · Partidos** (`src/components/TennisList.tsx`): cada torneo en su panel, con el logo del circuito (`tennis-logos.tsx`:
  ATP y WTA de 2025, en el color del texto; el del Challenger, `public/tennis/atp-challenger.png`; `CircuitBadge` es la placa y
  `CircuitMark`, la marca pequeña que llevan las recomendaciones para que se vea si son de ATP, WTA o Challenger), la superficie y la ciudad;
  las banderas de los que no salen de ESPN (Challenger, previas) se sacan del país con `server/services/tennis/flags.js`;
  dentro, sus rondas y una fila por partido. Los que están en juego se quedan en su torneo. Al lado, el partido elegido
  (`TennisSpotlight`) y las más fiables del día.
- **Sin cuenta** se ve la app (`AuthGate` ya no para en la entrada): partidos, directo, fichas, estadísticas y cuotas, para
  Google y AdSense. Lo que pide cuenta lo envuelve `MemberOnly`/`memberOnly` (`src/components/MemberOnly.tsx`; las recomendaciones
  de los cuatro deportes) o lo comprueba con `useMember()` y abre la entrada con `askLogin({ why })` (apuntar una apuesta, el cupón,
  favoritos, leer cuotas a mano). Consulta de algo del usuario: `enabled: useMember()` (o `useBets()`), para no pedirla sin sesión.
  Aviso legal, privacidad y cookies en `src/views/LegalView.tsx` (vista `legal`, direcciones `/aviso-legal`, `/privacidad` y
  `/cookies`): si cambia lo que se guarda o se añade una cookie, cámbialo también ahí. Detalle en `docs/specs/07-backend.md`.
- **Ajustes y cuenta:** *Ajustes* (`SettingsView`) es sólo del administrador y vale para todos los usuarios; el servidor rechaza
  con 403 los ajustes comunes que mande otro y avisa por SSE (`settings:changed`) para que se recarguen. Lo de cada uno
  (contraseña, banca inicial, avisos) está en *Tu cuenta* (`AccountView`). Un ajuste nuevo es común salvo que sea del usuario
  (`USER_KEYS` en `server/services/bets/store.js`). Una cuenta nueva ve una vez la bienvenida (`src/components/Welcome.tsx`: banca
  inicial y deporte favorito) y al cerrarla se guarda `welcomed`; no sale a quien ya tiene banca o apuestas. Sin banca inicial, la
  cartera no enseña un saldo (saldría en negativo con la primera apuesta) sino «Pon tu banca», que lleva a *Tu cuenta*.
  *Mis apuestas* empieza por las que están en juego (`Pending`) y, sin ninguna apuesta del deporte, por cómo apuntar la primera.
  El historial va por semanas (`src/views/bets/History.tsx`, `src/lib/bet-weeks.ts`), con su barra y calendario (`WeekBar`); con el
  buscador, el estado o un periodo (`src/lib/bet-period.ts`) se ve todo agrupado por semanas y arriba lo que suman las que quedan.
  Las simples pendientes se resuelven desde la lista: ganada y perdida a la vista, y nula (azul, como su etiqueta) en el menú «⋯» de
  la fila (en *En juego*, los tres botones). Todo beneficio de esa pantalla lleva entre paréntesis las unidades (`ProfitText`,
  `src/views/bets/Profit.tsx`): la unidad es el ajuste de usuario `unitSize` o el 1 % de la banca (`useUnit`), y sin ninguna de las
  dos no salen.
- **Administración** (`server/services/bets/admin.js`, reglas puras en `admin-rules.js`, accesos en `auth-events.js`; migración 018; spec en `docs/superpowers/specs/2026-11-18-panel-admin-design.md`): rutas `/api/admin/*`, sólo administradores. El gateway las cierra (`isAdminPath` en `public.js`) y `bets` lo vuelve a comprobar (`adminOf`). Cada cambio de cuenta escribe en `bets.admin_log` en la misma transacción y toma un candado para que nunca quede un sitio sin administrador activo. Una cuenta suspendida no abre sesión (`openSession`, también con Google) ni conserva las que tenía (`userOf`). Se guarda la IP de entradas, fallos y altas en `bets.auth_events` 90 días (y el registro de administradores 365): si cambia lo que se guarda, cámbialo también en `LegalView`. Un acceso fallido sólo anota el nombre si la cuenta existe. El administrador nunca ve apuestas, dinero ni mensajes de otro usuario: sólo cuántas apuestas tiene. *Acierto del modelo* (`src/views/admin/ModelTab.tsx`, `/api/admin/predictions`) también es sólo de administradores: son las recomendaciones de la app resueltas, no apuestas de nadie. Su «Estado del registro» separa lo pendiente (por jugar, en juego, esperando resultado, sin resolver): casi todo son líneas de baloncesto de partidos por jugar. El resolvedor (`predictions.settle`) coge primero las nunca intentadas y apunta `tried_at` en las que no puede resolver (migración 019): no vuelvas a ordenar sólo por antigüedad, que las que no tienen resultado tapaban a las demás durante 4 días.
- **Plan de apuestas** (vista `plan`, común a los deportes; `src/views/PlanView.tsx`, `src/components/plan/`; spec en `docs/superpowers/specs/2026-11-18-plan-apuestas-design.md`): dinero inicial, cuota a la que se quiere llegar (1,50, 1,75, 2,00 u otra), deportes (los cuatro con recomendaciones) y tipo → la mejor apuesta para esa cuota: *Combinada*, la más probable de las que llegan, con cualquier línea de cada partido y nunca dos del mismo (`bestCombo`); *Simple*, la sencilla más probable que paga la cuota (`bestSingle`). Enseña hasta 5 opciones que no comparten partido (alternativas, cada una con todo el dinero) y, si dos o más son muy fiables (todas sus selecciones con fiabilidad ≥ 75), qué pasaría al juntarlas. Usa todas las líneas calculadas (`picksBoard`, `picksLines`, `useBasketPicks`), no sólo la más fiable de cada partido. Los grupos de botones van en `fieldset`, no en `Field`, que es una `<label>`. El reparto y el riesgo son puros (`src/lib/plan.ts`) y los adaptadores de cada deporte están en `plan-sources.ts`; si cambias el modelo de un deporte o la forma de sus recomendaciones del día (`picksDay`), ajusta su adaptador y `plan-sources.test.ts`. El usuario elige además cuándo empiezan (2, 5, 10, 24 o 48 h; `WINDOWS`, nunca más de 48 h, que es cuando se leen las cuotas) y qué competiciones de cada deporte entran (`skipLeagues` con `leagueKey`; con todas puestas, tocar una deja sólo esa). La pantalla son pasos (`PlanSetup`) y el resultado al lado (`OptionCard`, `BestCard`), y cada opción se puede llevar al cupón. Se filtra por fiabilidad ≥ 45, valor esperado ≥ −10 % y cuota 1,10–15, **no por veredicto**: las recomendaciones más fiables salen «No apostar» (cuota baja y valor esperado ligeramente negativo) y el plan se quedaría vacío. Por eso el aviso de valor esperado negativo no se quita, y ningún texto del plan puede hablar de beneficio asegurado. Una apuesta por partido, para que los tickets sean independientes. Es una pantalla de cálculo: no apunta apuestas ni lee cuotas (las opciones se llevan al cupón y allí se apuntan).
- **Entrar con Google** (`server/services/bets/google.js`, `docs/specs/07-backend.md`): sólo sale si están `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET` y `PUBLIC_URL` en el `.env`. No quites la comprobación del `state` ni la del `id_token` (`claimsOf`), y
  las cuentas nuevas siguen las reglas del registro (primero administrador, registro cerrado, límite por IP).
- Estado global (app activa `lol` | `basket` | `tennis` | `football` | `mma`, vista, partido abierto, formulario de apuesta, boleto de combinada, avisos, competiciones del menú lateral) en `src/lib/app-context.tsx`.
- **Direcciones y atrás del navegador** (`docs/specs/02-partidos-y-directo.md`): deporte, sección, partido abierto y día van en la dirección (`/futbol/partido/<id>?dia=…`, `src/lib/route.ts`), y sólo `src/lib/history.ts` toca `window.history`. Abre partidos con `openGame`/`setOpenMatch` y ciérralos con `closeMatch` (nunca con un estado local `openId`); el día de la lista, con `useRouteDay()`. Toda ficha, chat o panel nuevo que tape la pantalla y tenga su «Volver» lleva `useBackLayer(abierta, cerrar)`; las ventanas `Dialog` ya lo traen. No uses `history.replaceState(null, …)`: borra la posición que guarda cada entrada. Buscador de los cuatro deportes (Ctrl+K): `src/components/Search.tsx` y `/api/search` en el gateway, que pregunta a la ruta `search` de cada servicio (`docs/specs/07-backend.md`).
- **Subir ticket** (`src/components/TicketScan.tsx`, `server/services/bets/scan.js`, `ticket.js`, `ocr.js`; `docs/specs/05-apuestas.md`): la captura de una apuesta de la casa se lee con Tesseract en el servicio `bets` (gratuito, dentro del contenedor; la imagen no se guarda) y vuelve como borrador enlazado a su partido. `ticket.js` es puro y sus pruebas (`server/test/ticket.test.js`) usan el texto del OCR de capturas reales de Winamax y bet365: si cambia cómo se escribe un ticket, añade el caso ahí. Las claves que saca `marketOf` son las de `odds.js` y `settle.js`. Ante la duda no enlaza: una apuesta enlazada al partido equivocado se resolvería mal. Si cambia lo que se hace con las capturas, cámbialo también en `LegalView`.
- **Partido y mercado a mano** (`src/components/GamePicker.tsx`): fuera de LoL, el formulario de apuesta elige el partido de los del día de su deporte, con el nombre que lee la resolución (`gameOf` de `ticket.js`; si cambias uno, cambia el otro), y sugiere los jugadores (alineación, plantillas o los dos rivales). Si la app no entiende el mercado (`/api/bets/understand`, `understands` de `ticket.js`), `MarketHint` lo dice y deja enseñarle qué es: se guarda en el ajuste de usuario `marketAliases` (`cleanAliases`) y lo usa el resolvedor (`guessRef`). Al guardar una apuesta se lanza una pasada del resolvedor a los 3 s para que se enlace ya.
- **Tus apuestas** (`src/components/MyBetsLive.tsx`, `src/lib/bet-track.ts`; `docs/specs/05-apuestas.md`): arriba de Partidos, encima de los favoritos, las pendientes de hoy con su partido (`ref`) y cómo van (barra frente a la línea, o quién va por delante). `trackOf` lee las mismas claves de mercado que `settle.js`: si cambias una, ajusta los dos y `bet-track.test.ts`. Pulsar una línea de jugador de baloncesto abre el partido en *Estadísticas* con el de ese jugador (`focusPlayer`).
- **Favoritos** (`src/components/Favorites.tsx`): la estrella junto al nombre en la ficha del partido (`Scoreboard` en `sport.tsx` y la cabecera del fútbol) guarda el equipo, jugador o luchador en el ajuste de usuario `favorites` (`cleanFavorites` en `server/services/bets/store.js` lo valida: deporte, nombre y escudo https; 60 como mucho). Arriba de Partidos de cada deporte, `FavoritesStrip` enseña su partido en juego o el próximo, buscándolo con `/api/search` (la misma clave de consulta que el buscador), y se abre con `useOpenMatch` de `Search.tsx`. En *Tu cuenta* se ven todos y se quitan. Se identifican por deporte y nombre: si una fuente cambia el nombre de un equipo, ese favorito deja de encontrar sus partidos.
- **Amigos** (`src/views/FriendsView.tsx`, `server/services/bets/friends.js`, tablas `bets.friends`, `bets.shared_bets` y `bets.messages`): añadir por nombre de usuario, aceptar, un chat con cada amigo (mensajes y apuestas pasadas por fecha) y pasarse apuestas desde el chat o desde Mis apuestas (`ShareDialog`). El aviso de mensaje nuevo (`chat:new`, `chat:read`) lleva `data.to` y el gateway sólo se lo manda a ese usuario, sin el texto: cualquier aviso de un usuario, igual. Lo que se envía es una copia **sin el importe, el cobro ni las notas** (`shareable`; si añades un campo a las apuestas, decide si debe viajar y ajusta `server/test/amigos.test.js`). El estado (ganada, perdida, pendiente…) no va en la copia: es el de ahora, leído de la apuesta original (`bet_id`, migración 015) con `stateJoin`/`stateOf`, que sólo sacan el estado y sólo de una apuesta de quien la pasó (`ob.user_id = s.from_user`). Es la única lectura de `bets.bets` de otro usuario fuera del resolvedor y del panel de administración (que sólo cuenta cuántas apuestas tiene cada uno, filtrando por `user_id`): no le añadas columnas. Una ya resuelta no se puede copiar (`open`). Sólo se comparten apuestas propias (`store.getOwnBet`, nunca `getBet`) y sólo con amigos aceptados.
- **Recomendaciones, mismo formato en los cinco deportes** (`src/components/PickParts.tsx`): probabilidad y valor con su nombre debajo (`PickNums`), la cuota con su casa entera (`PickOdd`, o `PickOddText` dentro de una fila que ya es botón) y la ayuda ⓘ junto al título (`PicksTitle`/`PickHelp`). El mercado no se corta: `line-clamp-2`, no `truncate`. Arriba de la pantalla, el periodo y la liga; el resto de filtros, en «Más filtros» (`FoldOnPhone always`). En el móvil las cifras de resumen se quedan en una línea para que la mejor opción salga en la primera pantalla.
- **Por qué sale arriba una recomendación** (`src/components/PickWhy.tsx`): una línea bajo la de arriba de cada deporte. En baloncesto se elige por valor; en tenis, fútbol y MMA es la más fiable, que puede pagar poco. No confundas en la interfaz probabilidad (lo a menudo que acierta), fiabilidad del cálculo y valor.
- **Vista de fútbol:** `src/views/FootballMatches.tsx` es la lista y la ficha que junta las pestañas; cada parte de la ficha está en `src/views/football/` (`MatchHeader`, `Timeline`, `Stats`, `Lineups`, `PlayerStats`, `Shots`, `Form`, y lo común en `shared.ts`). Sigue esa forma si otra vista crece demasiado.
- El backend es CommonJS (`require`), la interfaz ESM. El backend no usa framework: sólo
  `node:http` (`server/shared/service.js`) y `pg`. Comentarios cortos, en español, explicando el *porqué*.
- Cada pantalla va dentro de `ScreenGuard` (`src/components/ScreenGuard.tsx`, en `App.tsx`): si falla al pintarse sale un aviso
  con «Reintentar» en su sitio, en vez de quedarse la app en negro. No es excusa para no arreglar el fallo: mira la consola.
- **Avisos de juego**: `FooterJuego` (`src/components/FooterJuego.tsx`: «El juego es un riesgo», +18, AutoProhibición,
  juegoseguro.es, FEJAR y que Sharpex no es operador, con los colores del tema y sólo el +18 en rojo) al final de cada
  pantalla (`App.tsx`) y de la entrada; `PlayNotice`
  (`ui.tsx`, «+18 · Juega con responsabilidad») en el cupón. Lo pide el Real Decreto 958/2020 (arts. 10.3 y 11.3) porque se
  enseñan cuotas de las casas: no los quites, y pon el aviso en cualquier sitio nuevo con cuotas que quede fuera de esa estructura.
  Nada de sellos «Juego Seguro» / «Juego Autorizado» de la DGOJ ni logos de pago: son de operadores con licencia.
- Rutas: dos rutas con el mismo método y camino en un servicio no dan error, gana la primera (así se rompió la búsqueda de
  jugadores de baloncesto). `/api/<servicio>/search` es la del buscador de la cabecera; no la reutilices.
- Nada de comentarios dentro de expresiones JSX (`{/* */}` entre props rompe el build en algunos sitios).
- Preferencias de UI (secciones plegadas, boleto) en `localStorage`, siempre dentro de `try/catch`; el boleto se borra al salir.
- **Logo e iconos** en `public/` (Vite los sirve tal cual y `web/Dockerfile` los copia): `logo.png` (icono y nombre, fondo transparente, es el de la cabecera, el menú y la entrada), `logo-mark.png` (sólo el icono), `favicon.ico`/`favicon-32.png`, `apple-touch-icon.png`, `icon-192/512.png`, `icon-maskable-512.png` y `manifest.webmanifest` (la app se puede instalar). Salen del logo original; si se cambia, hay que regenerarlos. Sin `og:image`: necesita la URL absoluta de la web desplegada.
- **Aspecto de app en el móvil** (`src/index.css`, `App.tsx`): la cabecera es `sticky` dentro del scroll y se esconde al bajar con `transform` (no cambies su alto al esconderla: haría tiritar el scroll) y deja el margen de la muesca con `env(safe-area-inset-top)`. Las filas que se deslizan de lado llevan `fade-x`/`fade-r`. Con `pointer: coarse` se quitan barras de scroll y resaltado del toque, y los campos van a 16 px (si no, iOS amplía la pantalla al enfocarlos). Todo esto es sólo del móvil (por debajo de `lg`): el escritorio no cambia. En las listas, `StateFilterBar` deja fijas la tira de días y los filtros bajo la cabecera (`--head` la publica `App.tsx`); en `MatchCard` y las filas de tenis, tocar una cuota la añade al cupón en el móvil y en el ordenador (`src/lib/card-odds.ts`: mejor casa del ganador, `moneyline|0||`) y el resto de la tarjeta abre el partido; `OddsLegend` encima de la lista lo dice y explica la resaltada (la del favorito). Si el nombre del equipo no cabe en la tarjeta sale el corto (`alt` de `RowTeam`: «Knicks»). Los filtros de recomendaciones se pliegan con `FoldOnPhone`. Las fichas abren con `<SheetScroll />` (arriba, y al volver recuperan la posición de la lista); ponlo en las nuevas.
- **Móvil:** todo tiene que caber en 375 px sin que la página se desplace de lado. Se diseña de móvil hacia arriba con `sm:` y `lg:`; desde `lg` se ve la navegación de escritorio, y por debajo la barra inferior. Las tablas anchas van dentro de `overflow-x-auto` o tienen versión en tarjetas (`BetCard`).

## Cosas que se rompen con facilidad

- **Lectores de las casas** (`marcador.js`, `server/lector/runner.js` y `background.js`): dependen del HTML y del
  socket de Winamax y Betway, que cambian sin aviso. Cuando no encuentran algo guardan
  `capturas/captura-<casa>-<nombre>.json`; úsalas para ajustar selectores. Si la red desvía la casa a una página de bloqueo
  (la del instituto), el lector lo dice en vez de «No encuentro el partido» (`server/lector/red.js`): no es un fallo del lector.
  Cada lectura tiene 4 min como mucho (`JOB_MAX` en `runner.js`) y sus peticiones al gateway, 15 s: antes una lectura que se
  colgaba (al cambiar de red a mitad) dejaba al lector parado y ninguna otra, tampoco *Actualizar cuotas*, se hacía hasta reiniciar.
  Los botones de *Actualizar cuotas* siguen su lectura por su número con `waitJob` (`src/lib/odds-read.ts`: aviso en vivo y, si se
  pierde, preguntando cada 6 s); no los vuelvas a fiar sólo del aviso, que se quedaban en «Leyendo…» para siempre. `marcador.js` se monta en el contenedor
  `lector` y se vuelve a leer en cada trabajo: no hace falta reconstruir para probar un cambio. El socket de Winamax manda el
  partido a trozos (unos 5 mercados y luego el resto): el lector espera a tener `moreBets + 1`; no lo cambies por una espera fija.
  Las lecturas pedidas desde una recomendación o el cupón llevan el mercado (`job.match.focus`) y de Betway sólo se leen sus
  pestañas (`server/lector/foco.js`, con pruebas en `server/test/foco.test.js`): unos 10 s en vez de 40. Si Betway cambia los
  nombres de sus pestañas (`main-markets`, `1st-half`, `points-rebounds`…), ajústalo ahí; lo que no reconoce se lee entero.
- **Baloncesto en las casas** (`winamaxBasketInto` y `marketsInto` en `server/services/odds/odds.js`): los periodos
  salen del título ("1ª mitad - …") o de la pestaña de Betway (`marketGroup=1st-half`); las líneas de jugador usan la
  clave `player|<estadística>|<jugador>|<línea>`, con los mismos nombres de estadística que `BASKET_MARKETS`. Si el partido no
  tiene esa pestaña (la NBL usa `half`), Betway devuelve la del partido entero: `isPeriodCopy` la descarta si se parece a
  cualquier página principal de Betway del partido, sea de la lectura que sea (con las lecturas ligeras cada página sólo
  sustituye a la suya: exigir la misma lectura dejó pasar "1.er cuarto: menos de 188,5" en noviembre de 2026). Por si se cuela,
  `dropImpossiblePeriods` quita los totales de mitad o cuarto que se acercan al del partido (en `Book.result` y en `afterImport`);
  pruebas en `server/test/periodos.test.js`.
- **Fútbol en las casas** (`winamaxFootballInto` y `betwayFootballInto` en `odds.js`): el periodo sale sólo del título,
  nunca de la pestaña (la "1er Tiempo" de Betway repite los mercados del partido). El 1X2 lleva empate (`x`). Los nombres
  del partido (`targetOfFootball` y `upcomingFootball`) tienen que coincidir, porque son la clave en `odds`
  (`docs/specs/11-futbol.md`). Las selecciones (`national: true` en `LEAGUES`) se piden a ESPN en español y llevan en `NATIONAL` los nombres que ESPN deja en inglés y los de las casas ("República Checa", "Holanda").
- **Mismos equipos otra vez** (`server/services/odds/otro-partido.js`, `runJob` en `server/lector/runner.js`): las direcciones de las
  casas (`odds.book_urls`) se guardan por los nombres, y en la NBA, el tenis o LoL los mismos equipos se repiten. Una lectura de
  Winamax de otro partido (más de 12 h de diferencia, o terminado cuando el nuestro no ha empezado) se rechaza y se olvida su
  dirección; si una casa falla con la dirección guardada, el lector busca el partido otra vez en la misma lectura. Sin esto, cada
  lectura traía las cuotas del partido anterior y nunca cambiaban.
- **Emparejar equipos** entre lolesports / ESPN / la Euroliga y las casas (`orient`/`teamScore` en
  `server/services/odds/equipos.js`, `pageFind`/`winamaxFind` en el lector): nombres distintos ("Gen.G Esports" / "GEN",
  "Real" / "Real Madrid" / "R. Madrid"). Los equipos llevan `alt` con sus otros nombres. Prueba con varios equipos.
  Una letra de diferencia en una palabra ("Riga Zelli" / "Rigas Zelli") ya cuenta como el mismo equipo, y en baloncesto el lector
  acepta una palabra distintiva en común (sólo ahí: en tenis los nombres de pila se repiten). Lo que no se parece en nada
  ("Derthona" / "Tortona Basket" en Winamax) va en `ALIAS` de `server/services/basket/euroleague.js`. Pruebas en `server/test/equipos.test.js`.
- **Leaguepedia** limita mucho las peticiones anónimas: no quites la cola ni la caché de `leaguepedia.js`.
- **Lecturas programadas** (`server/services/odds/scheduler.js`): los cinco deportes, desde 48 h antes y más seguidas cuanto más
  cerca está el partido (tenis, fútbol y MMA, cada 8 h a más de un día); el lector las hace de una en una, primero las más cercanas.
  No subas mucho la frecuencia: las casas pueden bloquear. La interfaz repite esos plazos para decir desde cuándo habrá cuotas
  (`src/lib/odds-window.ts`, con sus pruebas): si cambias uno, cambia el otro. Cuando una casa no tiene el partido, lo que dijo
  en la última lectura llega en `sources` (`bridge.lastJob`) y se enseña en la pestaña de cuotas.
- **Escáner de líneas y puntos de equipo** (`scanLine` en `src/lib/basket-model.ts`, `src/lib/basket-teams.ts`): el escáner debe dar la misma probabilidad que el analizador, y los parámetros de los puntos están ajustados con datos (cifras y límites en `docs/specs/08-baloncesto.md`). No guardes logs de ESPN enteros en la caché: pesan 700 KB cada uno (`remember` y `bulk` en `cache.js`).
- **Proyección de baloncesto** (`PROJ` en `src/lib/basket-model.ts`: lo que vale la temporada pasada, minutos altos, varianza): medida con `scripts/calib-basket.ts` en líneas de toda la escalera, no sólo en la proyección. Si la tocas, repítela y compara el sesgo de 26-27 y la log-loss por temporada (`docs/specs/08-baloncesto.md`). De baloncesto se guardan en `bets.predictions` todas las líneas calculadas, no sólo las de valor: así se puede medir el peso frente a la casa sin sesgo.
- **B2B y vuelta de baja en el modelo** (`gameCtx` en `src/lib/basket-context.ts`, `CTX_FACTORS` en `basket-model.ts`): los factores están medidos con `scripts/backtest-basket.ts`. Si tocas el modelo, repítelo (ajuste y comprobación con periodos distintos) y mira la calibración. El contexto tiene que calcularse igual en el analizador, el escáner y las recomendaciones, también las bajas de compañeros (`matesOut` de `src/lib/basket-mates.ts`), que no cambian la proyección: bajan la fiabilidad de los "menos" y, mientras dure una baja reciente, el "menos" no se recomienda (`noFreshUnder` en el analizador y en `basket-picks.ts`). La NBA Cup (`cup` del partido, de la nota de ESPN) y la pista neutral (`neutral`) entran por `gameExtras` en los tres sitios: en la fase de grupos se rinde igual que en la liga (medido) y no cambia nada; la eliminatoria sólo baja la fiabilidad; en pista neutral no hay ventaja de campo (props y `projectGame`). Cifras en `docs/specs/08-baloncesto.md`.
- **Bajas en los puntos de equipo** (`src/lib/basket-absences.ts`): la proyección resta el 5 % de lo que anotan los habituales que
  faltan, sólo con bajas de 20 puntos o más, porque es lo único que mejoró la proyección con partidos que no se usaron para ajustar
  (`scripts/backtest-puntos.ts`, cifras en `docs/specs/08-baloncesto.md`). Parece poco (GS sin Curry: −1), pero restar todo lo que
  anota el que falta la empeoraba: los compañeros absorben sus tiros. Si lo tocas, repite la prueba. La pestaña *Puntos* y las
  recomendaciones tienen que calcularlo igual (`teamOuts` + `withOuts` + el aviso de `analyzePoints`).
- **Acierto del modelo** (`bets.predictions`, `src/lib/predictions.ts`): las claves de mercado son las de las apuestas; si cambias una en `odds.js`, las recomendaciones dejarán de resolverse.
- **Recomendaciones de baloncesto** (`src/lib/basket-picks.ts`, `blendWithMarket` y `tooFar` en `src/lib/value.ts`): no ordenes por el EV del modelo a secas. Sube a la cabeza sus propios errores: en la prueba salían EV de +65 % con el modelo diciendo 29 % y la casa 10 %. Los pesos frente a la casa son una decisión, no una medida (`docs/specs/08-baloncesto.md`). Con el filtro *Casa* se calcula sólo con las cuotas de esa casa (`onlyBook`): no mezcles la cuota de una con la probabilidad de la otra, que no se puede comprobar en ninguna web.
- **Puntos y Challengers de tenis** (`points.js`, `livescore.js`): salen de APIs sin documentar que pueden cambiar sin aviso. Si fallan, el marcador tiene que seguir saliendo. Los Challenger no entran en el modelo de tenis ni en las lecturas programadas del resto del tenis: sólo con su política propia de dos lecturas (una hasta 12 h antes y la de cierre, `challengerOddsEnabled`, `scheduler.js`), que no hay que hacer más seguida: son decenas al día y las casas pueden bloquear. Antes de añadir otra fuente, mira su `robots.txt` (`docs/specs/09-tenis.md`).
- **Modelo de fútbol** (`server/services/football/model.js`, `picks.js`): si tocas algo, repite `backtest.js` dentro del contenedor (ajusta con un periodo y comprueba con otro; cifras en `docs/specs/11-futbol.md`). Los resultados pasados (`hist:` en `football.cache`) no se borran con la limpieza.
- **Noticias de fútbol y baloncesto** (lo común en `server/shared/news.js`; lo de cada deporte, fuentes y apodos `NICK`, en `server/services/football/news.js` y `basket/news.js`; tabla `news` de cada esquema; pestaña *Noticias* con `src/components/MatchNews.tsx`; `docs/specs/11-futbol.md` y `08-baloncesto.md`): ESPN y RSS de prensa, unidos a los equipos de los próximos partidos por su nombre (`teamsIn`; un nombre que llevan dos equipos no cuenta). En baloncesto la clave del equipo lleva la liga delante (`nba:19`): los ids de ESPN de la NBA y la WNBA se repiten. Las etiquetas (baja, duda…) son palabras del titular. Junto a las recomendaciones (`NewsHint`, `keyNews` y `withNews` de `src/lib/news.ts`, la misma regla que `keyNews` del servidor) sale la noticia que puede cambiarlas, y una de baja, duda, sanción o rotación que nombra al jugador le baja 20 puntos la fiabilidad (`NEWS_PENALTY`): es una decisión, no una medida. No toques la probabilidad con noticias sin medir con los backtests que mejoran. No bajes de 5 min entre lecturas ni añadas una fuente sin mirar su `robots.txt`. Pruebas en `server/test/noticias.test.js` y `src/lib/news.test.ts`.
- **WOW** (`server/services/mma/wow.js`): se lee del HTML de wowmma.com (Webflow, sin API); si rediseñan la web deja de salir y sólo queda el aviso en el log. Su `robots.txt` permite todo menos `/*?*`: nunca pidas URLs con parámetros. La cartelera se publica tarde. Cuotas de WOW: Betway y Winamax no las listan siempre.
- **Modelo de MMA** (`server/services/mma/model.js`, `history.js`, `picks.js`): bien calibrado pero discrimina poco (57,6 % de ganadores acertados; cifras en `docs/specs/12-mma.md`). Si lo tocas, repite `docker compose exec mma node services/mma/backtest.js` (ajusta con un periodo y comprueba con otro). Las claves de mercado de MMA (`moneyline|0||`, `method|0|<ko|sub|dec>|`, `distance|0||`, `total_rounds|0||<línea>`) las usan las recomendaciones y `settle.js`: si cambias una en `odds.js`, ajusta los dos. En los mercados de método la casa no suma 100 % entre A y B (`open` en `picks.js`).
- **Motor de los Challenger** (`server/sharpex-tenis`, servicio `challenger`): si tocas el modelo, repite `validar` (ajuste con un
  año, evaluación con otro, sólo Challengers) con los datos de `sharpex-tenis datos`; cifras en su `README.md`. Es Elo más saque y
  resto (`src/stats.js`, copia de la idea de `server/services/tennis/model.js` porque el motor es un paquete aparte) más la
  actividad y el factor local (`src/form.js`, fase 2), con los pesos de `fitWeights`; la segunda versión del motor está en `docs/superpowers/specs/2026-11-19-motor-challenger-v2-design.md`, y cada
  variable nueva entra sólo si mejora la log-loss de la evaluación sin empeorar la calibración. Entrenar tiene que seguir cabiendo
  en los 256 MB del servicio (`--max-old-space-size=256`). Las dos fuentes usan
  identificadores distintos y se juntan en `mergeSources` (`src/data.js`): si cambias algo ahí, mira cuántos jugadores se emparejan y
  cuántos partidos se cuentan dos veces. `challenger.historial` sólo admite añadir (un disparador lo impide): nunca metas picks de
  prueba en la base de datos de verdad, no se pueden borrar.
- **Previa del tenis** (`roundEs` y `withQualifying` en `server/services/tennis/index.js`): toda ronda de previa tiene que empezar por
  «Previa», que es lo que miran el interruptor *Previa*, las lecturas programadas y las recomendaciones. ESPN pone nombres nuevos sin
  aviso: «Qualifying Final» se quedó sin traducir y pasaba por cuadro final. La que ESPN no trae sale de LiveScore; la de los
  Challenger, de los PDF de ProTennisLive (`protennislive.js`, `ptlpdf.js`): no bajes de 5 min por torneo (es lo que dura su caché)
  ni de 8 s entre peticiones, que responde 429; y si cambian sus PDF, ajusta la lectura con `server/test/ptl.test.js`.
- **Dobles de tenis** (`server/services/tennis/doubles.js`, `GET /api/tennis/doubles`, ids `dbl:…`; `docs/specs/09-tenis.md`):
  - Van en su propia ruta y no en `/api/tennis/games` a propósito, porque lo que lee esa da por hecho un jugador por lado: lecturas programadas, modelo, motor de los Challenger, buscador. `/days` los cuenta aparte (`doubles`), y sólo los suma la tira de días con el interruptor *Dobles* encendido (lo está de entrada).
  - Sin modelo ni recomendaciones. Sus cuotas sólo se leen a mano (`doubles` en el partido del trabajo).
  - La pareja se llama «Nombre Apellido / Nombre Apellido», y ese formato es lo que reconocen como pareja `teamScore` (`equipos.js`), `winamaxFind` (`server/lector/winamaxfind.js`) y `pageFind`, cada uno con su copia. Si cambias cómo se empareja una pareja, cambia los tres y sus pruebas.
  - Un dobles sin las dos parejas reconocidas no se lee: con el orden supuesto, las cuotas salían cambiadas de lado.
  - El súper tie-break llega como un set 1-0 con los puntos en `tiebreaks` (`mtb`). La resolución no resuelve sola los juegos del partido ni el tercer set de esos partidos.
  - Si añades un fichero al lector, ponlo también en el `COPY` de `server/lector/Dockerfile`.
- **Recomendaciones de tenis** (ATP y WTA): la probabilidad y los descartes están en `server/services/tennis/picks.js`. Qué es la más fiable, las tres listas y los filtros están en `src/lib/tennis-picks.ts`. La pestaña del partido, la pantalla *Recomendaciones* y la banda de la lista usan esas mismas reglas: no las copies en otro sitio. Los Challenger no entran: tienen su propio motor (servicio `challenger`), con sus recomendaciones en `src/components/ChallengerPicks.tsx` (*Alta probabilidad* siempre con «sin ventaja sobre la casa», con su probabilidad mínima por tramo de cuota en `PICKS.tramos` de `server/sharpex-tenis/src/picks.js`: 72 % hasta 1,50 y 58 % hasta 2,00 desde el 23-11-2026; *Valor* visible (`VALUE_VISIBLE`) desde esa fecha por decisión de Hugo, siempre con el aviso de que en la fase 0 perdió un 7,2 % frente a la cuota de cierre: no quites ese aviso. Desde esa fecha entra también la previa; los dobles no, porque no tienen modelo). Detalle en `docs/specs/09-tenis.md`.
- **Perfil del tenista, pestaña *Líneas*** (`src/components/TennisLines.tsx`, `src/lib/tennis-lines.ts`; `docs/specs/09-tenis.md`):
  su histórico partido a partido (`gamelogOf` de `tml.js`, ruta pública `/api/tennis/gamelog`) y su próximo partido con lo que
  espera el modelo y sus líneas de las casas (`playerLines` de `picks.js`, `/api/tennis/picks/player`, pide cuenta). `picksFor` y
  `playerLines` comparten el cálculo del partido (`matchContext`): si tocas uno, que sigan dando las mismas cifras
  (`server/test/tenis-lineas.test.js`, con `fixtures/tenis-picks-antes.json`; si cambias el modelo a propósito, regenera ese fichero).
  Los jugadores de los Challenger también tienen ficha, de TennisMyLife: circuito `'challenger'` en `tml.js` y en las rutas de la
  ficha, con el **nombre** como id (`challengerProfile`, `playerName`); en *Líneas*, sólo su histórico.
- **Estadísticas de partido de tenis** (`server/services/tennis/matchstats.js`): WTA de su web oficial (al momento) y, si no, TennisMyLife (días después). ESPN no las tiene. No uses LiveScore para esto: su robots.txt prohíbe `/api/` y se decidió no ampliar su uso ahora que la web es pública (`docs/specs/09-tenis.md`).
- **Modelo de tenis** (`server/services/tennis/model.js`): si tocas algo, repite `backtest.js` antes de darlo por bueno. Mira la tabla de calibración y los juegos medios, no sólo el Brier, y ajusta siempre con un periodo distinto del que evalúas.
- **CSP con nonce** (`web/cabeceras.conf`, `location = /index.html` de `web/nginx.conf`): nginx pone el nonce de cada petición
  (`$request_id`) en los `<script>` de `index.html` y en la cabecera, con `'strict-dynamic'`, como admite AdSense. No vuelvas a
  servir `index.html.gz` (sub_filter no toca lo comprimido) ni pongas scripts en línea sin nonce.
- **Rendimiento** (`docs/specs/07-backend.md`, "Rendimiento de la web"): las consultas de cuotas no sondean cada minuto;
  llevan `meta: oddsMeta(partido)` y las recarga el aviso `odds:imported` (`src/lib/odds-live.ts`). Si añades una, haz lo
  mismo. Las imágenes de ESPN y de la Euroliga van con `sized(src, píxeles)` (`src/lib/img.ts`), no con el original de
  500 px. Si tocas `web/nginx.conf`, las cabeceras de seguridad van en `web/cabeceras.conf`. Las cachés de las fuentes sirven lo
  caducado hace poco mientras lo renuevan y hay un precalentado cada 4 minutos (`server/shared/cached.js`): una caché nueva de
  tenis o fútbol, con `cachedJSON`; y no alargues `STALE` en datos de directo.
- **Cupón al día** (`src/lib/slip-live.ts`, con sus pruebas): cada selección lleva `live` (el partido como lo pide el comparador,
  la clave del mercado y la selección; sólo vive en el cupón, no se guarda en la apuesta). Al entrar se compara con la última
  lectura y «Actualizar cuotas» lanza el lector; si la línea ya no está, se avisa. Si añades otro sitio que mande cuotas al cupón,
  ponle `live` (`OddsTarget.match` o `src/lib/odds-targets.ts`), o esa selección no se podrá actualizar, y `ref` (partido, clave y
  selección), o la apuesta no saldrá en «Tus apuestas» ni se resolverá sola (pasaba con las recomendaciones de fútbol y tenis y el plan). En las recomendaciones,
  `RefreshOdds` (`src/components/RefreshOdds.tsx`) lee el partido de esa fila y vuelve a pedir cuotas y recomendaciones. Va uno
  a uno a propósito: no pongas un botón que lea todos los partidos del día, serían decenas de lecturas y las casas pueden bloquear.
- **Combinadas**: la cuota y el estado se recalculan en `server/services/bets/store.js` (`normalizeCombo`) a partir de las selecciones; no
  confíes en lo que mande el renderer. La única excepción: si alguna selección va sin cuota (0, «Crear apuesta» o cuota mejorada), la
  cuota es la total que se manda; el formulario pide una sola «Cuota total» en las combinadas.
- **Resolución automática** (`server/services/bets/settle.js`): depende de que las claves de mercado del comparador
  (`odds.js`) y los nombres de estadística de jugador no cambien; si cambias una, ajusta `evaluate` y repite `npm test`
  (`resolver.test.js`). Ante la duda, que devuelva `null` (se resuelve a mano): una apuesta mal resuelta mueve dinero.
  Es lo único que lee las apuestas de todos los usuarios (`getBet`), junto con los avisos de cuotas: nunca lo expongas en una ruta.
- **Avisos de cuotas** (`server/services/bets/alerts.js`, `push.js`, `server/services/odds/moves.js`; campana en
  `src/components/Alerts.tsx`; pruebas en `server/test/avisos.test.js`): `odds` detecta en cada lectura las caídas y subidas de
  10 % o más (`movesOf`, en `recordPrices`) y se las manda a `bets` (`/internal/alerts/odds`), que las cruza con las apuestas
  pendientes de todos, los cupones (`oddsWatch`, lo manda `WatchSync`) y los favoritos, y avisa sólo al dueño. Esa lectura de
  apuestas ajenas sólo sirve para eso: no la expongas ni le añadas columnas. Las nuevas con valor salen cada 10 min de las
  líneas de tenis, fútbol y MMA y de las de baloncesto que ha calculado algún navegador (`bets.predictions`). El aviso en vivo
  (`alerts:new`) lleva `data.to`, sin el texto. Las suscripciones a notificaciones sólo admiten servicios de push de navegadores
  (`PUSH_HOSTS` en `push.js`): no lo abras a cualquier https, el servidor hace peticiones a esa dirección. `public/sw.js` no
  guarda nada en caché a propósito. Pulsar una notificación lleva al partido del aviso: la notificación ya trae su dirección
  (`/futbol/partido/<id>?dia=…&aviso=<id>`, `urlOf` en `alerts.js`, la misma forma que `hrefOf` de `src/lib/route.ts`: si cambias
  una, cambia la otra). Con la app abierta, `sw.js` le pasa el número y la dirección por mensaje a la pestaña que se ve (navegar la
  pestaña falla si no la controla) y la app va directa; si no, la abre en esa dirección. `?aviso=<id>` lo lee `Alerts.tsx` al cargar
  el módulo, antes de que `startHistory` reescriba la dirección, para marcarlo leído. Las notificaciones viejas (a `/?aviso=<id>`)
  siguen funcionando buscando el aviso.
  Si a alguien no le llegan, *Tu cuenta → Probar* dice qué responde el servicio de push y rehace la suscripción si hace falta; una
  suscripción hecha con otras claves VAPID se rehace sola al abrir la app (`sameKey`). Sin `PUBLIC_URL` con https ni `VAPID_SUBJECT`,
  Apple rechaza todos los avisos a los iPhone (detalle en `docs/specs/07-backend.md`).

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
| [`docs/specs/11-futbol.md`](docs/specs/11-futbol.md) | App de fútbol: ligas de ESPN, ficha del partido, clasificaciones, cuotas, modelo de goles y recomendaciones, selecciones y femenino |
| [`docs/specs/12-mma.md`](docs/specs/12-mma.md) | App de MMA: UFC y PFL de ESPN, WOW de wowmma.com, modelo Elo y su prueba, cuotas de Winamax y Betway, resolución de apuestas |
| [`docs/specs/10-base-de-datos.md`](docs/specs/10-base-de-datos.md) | Esquema de PostgreSQL: tablas, relaciones, diagramas y puntos a vigilar |
