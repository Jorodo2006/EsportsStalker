# AGENTS.md

Guía para agentes de código (Claude Code, Codex, Copilot…) que trabajen en **EsportsStalker / LoL Esports Tracker**.
Lee esto antes de tocar nada. Las especificaciones detalladas de cada parte están en [`docs/specs/`](docs/specs/).

## Qué es

App de escritorio (Windows y Linux) para seguir los esports de League of Legends y llevar el control de apuestas:
partidos y directo, comparador de cuotas de Bet365 / Winamax / Betway, stats de jugadores y equipos, y registro de
apuestas simples y combinadas con beneficio, ROI y gráficas.

## Reglas del proyecto (no negociables)

1. **Nada de APIs de pago ni APIs de cuotas.** Todas las fuentes son gratuitas. Las cuotas se leen de las páginas
   de las casas en el Chrome del usuario (marcador o extensión), nunca de una API de cuotas (OddsPapi, Pinnacle,
   The Odds API… se quitaron a propósito; ver `OBSOLETE` en `electron/services/store.js`).
2. **Casas soportadas: Bet365, Winamax y Betway.** William Hill y el resto se quitaron a petición del usuario.
3. **La interfaz y los comentarios van en español.** Textos de la UI, mensajes de error y comentarios del código.
4. **Ningún dato personal en el repo:** ni `data.json`, ni capturas `captura-*.json`, ni `casas-urls.json`, ni el
   `.env` con las credenciales. Ya están en `.gitignore`; no los saques de ahí. Las credenciales nuevas van al `.env`
   (mapeo en `electron/services/env.js`) y se documentan en `.env.example`.
5. **Las peticiones a internet las hace el proceso principal** (`electron/`), nunca el renderer (`src/`).

## Comandos

```bash
npm install
npm run dev        # Vite (5173) + Electron con recarga del renderer
npm run typecheck  # tsc --noEmit: es la única comprobación automática que hay
npm run build      # typecheck + vite build
npm start          # build y abre Electron como en producción
npm run dist:win   # instalador Windows (nsis + portable) en release/
```

- No hay tests automáticos. Antes de dar algo por terminado: `npm run typecheck` sin errores y probar en `npm run dev`.
- **Si cambias algo en `electron/` (main, preload, services) hay que parar `npm run dev` y relanzarlo**: el
  renderer se recarga solo, el proceso principal y el preload no. Un error típico de no hacerlo es
  `window.api.x.y is not a function`.
- Si cambias `electron/extension/` o `electron/bookmarklet/marcador.js`, la app regenera `extension-chrome/` al
  arrancar y el usuario tiene que pulsar **Recargar** en `chrome://extensions`.

## Arquitectura en 30 segundos

```
src/ (React 19 + TS + Tailwind 4 + TanStack Query)        ← interfaz, sin acceso a red
  └─ window.api.*  (electron/preload.js, contextBridge)
       └─ ipcMain.handle(...)  (electron/main.js)          ← responde { ok, data } | { ok:false, error }
            ├─ services/lolesports.js   calendario, directo, detalle (API no oficial de lolesports.com)
            ├─ services/leaguepedia.js  stats (API Cargo de lol.fandom.com, con caché y cola)
            ├─ services/odds.js         normaliza y compara cuotas recibidas
            ├─ services/bridge.js       servidor local 127.0.0.1:47365 (marcador + extensión)
            ├─ services/store.js        data.json (apuestas + ajustes)
            └─ services/env.js          credenciales del .env (mandan sobre los ajustes)
Chrome del usuario
  ├─ marcador (bookmarklet)  electron/bookmarklet/marcador.js  → POST /odds
  └─ extensión MV3           electron/extension/               → abre las casas, inyecta el lector, POST /odds
```

Más detalle en [`docs/specs/01-arquitectura.md`](docs/specs/01-arquitectura.md).

## Cómo añadir una llamada nueva del renderer al proceso principal

1. `electron/main.js` → `handle('grupo:accion', (...args) => servicio.algo(...))` dentro de `registerIpc()`.
2. `electron/preload.js` → expónla en el objeto `api` con `call('grupo:accion', ...)`.
3. `src/lib/types.ts` → añade la firma en la interfaz `Api`.
4. Úsala en el renderer con TanStack Query (`useQuery({ queryKey, queryFn: () => window.api... })`).
5. Si el renderer puede ir por delante del preload (recarga en caliente), protege la llamada con un fallback.

## Convenciones de código

- **TypeScript estricto** con `noUnusedLocals` y `noUnusedParameters`: nada de imports o variables sin usar.
- Alias `@/` → `src/`. Componentes base en `src/components/ui.tsx` (`Button`, `Card`, `Dialog`, `Field`, `Input`,
  `Select`, `Badge`, `Tabs`, `Empty`, `Loading`, `th`/`td`…). Úsalos en vez de crear otros.
- Estilo: tema oscuro `zinc`, acento `amber`, verde `emerald` para lo positivo, `rose` para lo negativo. Clases con `cn()`
  de `src/lib/format.ts`. Formato de números y dinero con `money`, `odd`, `pct`, `fmtDate`.
- Estado global (vista, partido abierto, formulario de apuesta, boleto de combinada, avisos) en `src/lib/app-context.tsx`.
- El proceso principal es CommonJS (`require`), el renderer ESM. Comentarios cortos, en español, explicando el *porqué*.
- Nada de comentarios dentro de expresiones JSX (`{/* */}` entre props rompe el build en algunos sitios).
- Preferencias de UI por usuario (secciones plegadas, boleto) en `localStorage`, siempre dentro de `try/catch`.

## Cosas que se rompen con facilidad

- **Lectores de las casas** (`marcador.js` y `background.js`): dependen del HTML de Bet365, Winamax y Betway, que
  cambia sin aviso. Cada lectura guarda `captura-<casa>-<nombre>.json` en la carpeta de la app; úsalas para ajustar
  selectores. Bet365 usa clases con hash (`rct-*`): busca por texto y estructura, no por clase.
- **Emparejar equipos** entre lolesports y las casas (`orient`/`teamScore` en `odds.js`): nombres distintos
  ("Gen.G Esports" / "GEN" / "Gen G"). Prueba con varios equipos.
- **Leaguepedia** limita mucho las peticiones anónimas: no quites la cola ni la caché de `leaguepedia.js`.
- **Combinadas**: la cuota y el estado se recalculan en `store.js` (`normalizeCombo`) a partir de las selecciones; no
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
