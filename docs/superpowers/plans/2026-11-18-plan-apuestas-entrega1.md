# Plan de apuestas por objetivo, entrega 1 (núcleo y tres deportes) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una pantalla *Plan* donde se pone dinero inicial y beneficio aproximado y la app reparte el dinero entre apuestas de tenis, fútbol y MMA, con un índice de riesgo.

**Architecture:** Todo en el navegador, sin rutas nuevas. Un módulo puro (`src/lib/plan.ts`) elige y reparte las apuestas y calcula el riesgo; un módulo de adaptadores (`src/lib/plan-sources.ts`) convierte las recomendaciones del día de cada deporte a una forma común; la vista consulta los tres deportes de las próximas 48 h y pinta el resultado.

**Tech Stack:** React 19 + TypeScript + Tailwind 4 + TanStack Query; Vitest para la lógica pura.

**Spec:** [docs/superpowers/specs/2026-11-18-plan-apuestas-design.md](../specs/2026-11-18-plan-apuestas-design.md). Esta es la entrega 1 de 2; la entrega 2 (baloncesto) tendrá su plan.

## Global Constraints

- Sólo partidos que empiezan en las **próximas 48 h**; el aviso de las 48 h va **arriba de la pantalla**, siempre visible, con el recuento por deporte.
- Apuestas elegibles: `rel` ≥ 45, `ev` ≥ −0.10, cuota entre 1,10 y 15, `start` posterior a ahora y anterior a ahora + 48 h.
- Reparto: se usa **todo** el dinero (los importes suman exactamente `budget`, en céntimos); cada apuesta se usa una sola vez; una combinada no lleva dos patas del mismo partido; ningún ticket lleva más del 60 % del dinero si hay al menos 3 tickets posibles; hasta 12 tickets; salida determinista y menos de 200 ms con 80 apuestas.
- Objetivo del reparto: maximizar la probabilidad de devolver al menos `budget + target`.
- Índice por `pReach`: ≥ 60 % bajo, 35–60 % medio, 15–35 % alto, < 15 % muy alto. Siempre con texto, nunca sólo color.
- Avisos: cuota necesaria `1 + target/budget` mayor de 3; valor esperado del plan menor que el dinero (`expectedReturn < budget`) dicho de forma explícita; y uno fijo (probabilidades del modelo, apuestas supuestas independientes, cuotas que pueden haber cambiado).
- Nada de lenguaje de «garantizado», «seguro», «asegurado» ni «gana» en ningún texto. El riesgo se enseña antes que el beneficio.
- La interfaz sólo habla con `window.api` (regla 5); sin rutas nuevas ni lecturas de cuotas nuevas. La pantalla pide cuenta (regla 7): sin sesión, `GuestScreen`.
- Interfaz y comentarios en español; estilo sobrio de `ui.tsx`; todo cabe en 375 px sin scroll lateral; `PlayNotice` junto al plan; preferencias en `localStorage` dentro de `try/catch`.
- TypeScript estricto sin imports ni variables sin usar; lógica pura con pruebas Vitest (`src/lib/*.test.ts`, alias `@/`).
- Sin `git commit` ni `git push` sin que Jordi lo pida en ese momento (regla 8).

## Review Focus

Entradas y condiciones que el diseño implica y que ninguna tarea probaría por sí sola. Cada una tiene su prueba en la tarea indicada:

1. **Objetivo disparatado** (p. ej. +500 € con 100 €) → el plan sigue saliendo, nivel «muy alto», con el aviso de cuota necesaria, y ningún texto promete nada. Tareas 1 y 2.
2. **Sin apuestas suficientes** (hoy MMA no tiene combates; sólo 0 o 1 elegible) → mensaje de qué falta o un único ticket con todo el dinero, sin plan inventado ni errores. Tareas 2 y 5.
3. **Cifras raras** (33,33 €; 0,01 €; «abc»; negativo; «1e6»; 3 decimales) → validación clara; los importes siguen sumando exactamente. Tareas 1 y 2.
4. **Partidos en el borde de la ventana** (justo 48 h, ya empezados, fecha inválida) → fuera; el reloj se inyecta para probarlo. Tarea 1.
5. **Plan con valor esperado negativo** (lo normal con las recomendaciones más fiables) → el panel lo dice con todas las letras y nunca lo presenta como rentable. Tareas 1 y 5.

---

### Task 1: Modelo común, elegibilidad y riesgo (puro)

**Files:**
- Create: `src/lib/plan.ts`
- Test: `src/lib/plan.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (`plan.ts`):
  - `type PlanSport = 'tennis' | 'football' | 'mma'` (la entrega 2 añade `'basket'`)
  - `interface PlanPick { id: string; sport: PlanSport; match: string; event: string; league: string; title: string; start: string; book: string; price: number; p: number; ev: number; rel: number }` (`match` identifica el partido y es la clave de «no dos patas del mismo partido»; `event` es sólo la etiqueta «A vs B»; `start` en ISO; `rel` de 0 a 100)
  - `interface Ticket { legs: PlanPick[]; price: number; p: number; stake: number; toReturn: number }` (sencilla: 1 pata; `price` y `p` de una combinada son el producto de las patas)
  - `type RiskLevel = 'bajo' | 'medio' | 'alto' | 'muy alto'`
  - `interface Risk { pReach: number; pProfit: number; pLoseAll: number; expectedReturn: number; level: RiskLevel; message: string }`
  - `const WINDOW_HOURS = 48`
  - `isEligible(p: PlanPick, now: number): boolean`
  - `poolStats(pool: PlanPick[], now: number): Record<PlanSport, { matches: number; picks: number }>` (sólo cuenta las elegibles; `matches` = partidos distintos)
  - `ticketOf(legs: PlanPick[], stake: number): Ticket`
  - `levelOf(pReach: number): RiskLevel`
  - `riskOf(tickets: Ticket[], budget: number, target: number): Risk`
  - `planWarnings(risk: Risk, budget: number, target: number): string[]`
  - `parseEuros(text: string): number | null` (acepta «100», «100,5», «100.50»; `null` si no es un número, no es positivo, tiene más de 2 decimales o supera 1.000.000)

- [ ] **Step 1: Escribir las pruebas que fallan** en `src/lib/plan.test.ts`, con un ayudante `pick(over?: Partial<PlanPick>)` que da una apuesta válida (`rel: 70`, `ev: 0`, `price: 1.5`, `p: 0.7`, `start` a 5 h de `NOW` fijo) y estas aserciones exactas:
  - `isEligible`: la base → `true`; `rel: 44` → `false`; `rel: 45` → `true`; `ev: -0.101` → `false`; `ev: -0.10` → `true`; `price: 1.09` → `false`; `price: 1.10` → `true`; `price: 15` → `true`; `price: 15.01` → `false`; `start` justo a 48 h exactas de `NOW` → `false`; 1 ms antes → `true`; `start` = `NOW` → `false`; `start` ya pasado → `false`; `start: 'no-es-una-fecha'` → `false`.
  - `poolStats`: con tres apuestas elegibles de tenis de 2 partidos y una de fútbol no elegible → `{ tennis: { matches: 2, picks: 3 }, football: { matches: 0, picks: 0 }, mma: { matches: 0, picks: 0 } }`.
  - `ticketOf([pick({price: 2, p: 0.5}), pick({price: 1.5, p: 0.8, match: 'otro'})], 10)` → `price` 3, `p` 0.4, `stake` 10, `toReturn` 30.
  - `levelOf`: `0.6 → 'bajo'`, `0.5999 → 'medio'`, `0.35 → 'medio'`, `0.3499 → 'alto'`, `0.15 → 'alto'`, `0.1499 → 'muy alto'`, `0 → 'muy alto'`.
  - `riskOf` con dos tickets independientes `p: 0.5, price: 2, stake: 50` y `budget: 100, target: 0` → `pReach` 0.75, `pProfit` 0.25, `pLoseAll` 0.25, `expectedReturn` 100. Con `target: 100` (necesita 200) → `pReach` 0.25. Con `tickets: []` → `pReach` 0, `pProfit` 0, `pLoseAll` 1, `expectedReturn` 0, `level` `'muy alto'`.
  - `riskOf(...).message` nunca casa `/garantiz|segur|asegur|gana/i`, para los tres casos de arriba.
  - `planWarnings`: con `expectedReturn` 90 y `budget` 100 incluye un aviso que casa `/pierde dinero/` y dice «90»; con `expectedReturn` 110 no lo incluye; con `budget: 100, target: 250` (cuota necesaria 3,5) incluye un aviso que casa `/3,5/`; con `target: 200` (3,0) no incluye el de cuota; siempre incluye uno que casa `/modelo/` y `/independ/` y `/cuotas/`. Ningún aviso casa `/garantiz|segur|asegur/i`.
  - `parseEuros`: `'100' → 100`, `'100,5' → 100.5`, `'100.50' → 100.5`, `'0,01' → 0.01`, `'1000000' → 1000000`; `null` para `''`, `'abc'`, `'-5'`, `'0'`, `'1,234'`, `'1e6'`, `'1000000,01'`, `' '`.

- [ ] **Step 2: Ejecutar y ver que falla**
  Run: `npx vitest run src/lib/plan.test.ts`
  Expected: FAIL (`Failed to resolve import "./plan"`).

- [ ] **Step 3: Implementar `plan.ts`** con las firmas de Interfaces. `riskOf` enumera los 2ⁿ resultados de los tickets (n ≤ 12), que son independientes porque no comparten patas; redondea nada: devuelve probabilidades exactas. `message` es una frase por nivel que dice la probabilidad en porcentaje («Es muy improbable: un 8 % de probabilidad de llegar al objetivo») sin lenguaje de garantía. Comentarios en español que expliquen el porqué de cada umbral.

- [ ] **Step 4: Ejecutar y ver que pasa**
  Run: `npx vitest run src/lib/plan.test.ts` → PASS.

- [ ] **Step 5: Commit** (sólo si Jordi lo pide): `plan.ts`, `plan.test.ts`.

---

### Task 2: El reparto (`buildPlan`)

**Files:**
- Modify: `src/lib/plan.ts`
- Test: `src/lib/plan.test.ts`

**Interfaces:**
- Consumes: `PlanPick`, `Ticket`, `Risk`, `isEligible`, `ticketOf`, `riskOf`, `planWarnings` (tarea 1).
- Produces:
  - `interface Plan { budget: number; target: number; tickets: Ticket[]; risk: Risk; warnings: string[]; eligible: number }` (`eligible`: cuántas apuestas pasaron el filtro)
  - `buildPlan(pool: PlanPick[], budget: number, target: number, now?: number): Plan` (`now` por defecto `Date.now()`)

- [ ] **Step 1: Escribir las pruebas que fallan.** Una `pool` de ejemplo de 12 apuestas de 12 partidos distintos (`match: 'm1'…'m12'`), `p` entre 0.62 y 0.85 y cuota entre 1.2 y 1.6, a 5 h de `NOW`. Aserciones:
  - Reglas de cualquier plan (para los pares `(100, 5)`, `(100, 20)`, `(100, 80)`, `(33.33, 10)`, `(0.01, 0.01)`, `(250, 40)`): `Math.round(100 * suma de stakes) === Math.round(100 * budget)`; todas las patas del plan son distintas (por `id`); ninguna combinada repite `match`; con ≥ 3 tickets, ningún `stake` pasa de `0.6 * budget` (más medio céntimo de tolerancia); todos los `stake` > 0; `tickets.length <= 12`; `risk.pReach` coincide con `riskOf(tickets, budget, target).pReach`.
  - Determinismo: `buildPlan(pool, 100, 20, NOW)` dos veces da el mismo resultado (`deepEqual`).
  - Monotonía: con la misma `pool` y `budget`, `pReach` de `target: 5` ≥ el de `target: 20` ≥ el de `target: 80`.
  - Un objetivo fácil (`(100, 5)`) da `risk.pReach` ≥ 0.5 y un objetivo difícil (`(100, 80)`) incluye al menos un ticket con 2 o más patas.
  - Objetivo disparatado `(100, 500)`: devuelve un plan con tickets, `risk.level === 'muy alto'` y `warnings` con el de la cuota necesaria (6,0).
  - Filtro: una apuesta con `rel: 40` en la pool no aparece en ningún ticket; `plan.eligible` cuenta sólo las que pasan el filtro.
  - Pool vacía o sin elegibles: `tickets: []`, `eligible: 0`, `risk.pReach` 0, `warnings` con un aviso que casa `/no hay/i`.
  - Una sola elegible: un único ticket con `stake === budget`; dos elegibles del **mismo** partido: un ticket (no se combinan) y el sobrante de dinero va a él.
  - Rendimiento: con 80 apuestas de 60 partidos, `buildPlan` tarda menos de 200 ms (`performance.now()`).

- [ ] **Step 2: Ejecutar y ver que falla**
  Run: `npx vitest run src/lib/plan.test.ts` → FAIL (`buildPlan is not a function`).

- [ ] **Step 3: Implementar `buildPlan(pool, budget, target, now)`.** Enfoque (el algoritmo exacto es de quien construya, mientras cumpla las pruebas): filtrar con `isEligible`, ordenar por `p` y `ev` y quedarse con las 14 mejores; generar planes candidatos con patrones (todo sencillas; una combinada de 2 a 6 patas distintas de partido más sencillas con las demás; dos combinadas), con importes en múltiplos del 5 % respetando el tope del 60 %; quedarse con el de mayor `pReach` (empate: menor `pLoseAll`, luego más tickets); convertir importes a céntimos exactos y dar el sobrante del redondeo al ticket mayor. Las `warnings` salen de `planWarnings` y, sin elegibles, añade «No hay apuestas disponibles en las próximas 48 horas para armar un plan».

- [ ] **Step 4: Ejecutar y ver que pasa**
  Run: `npx vitest run src/lib/plan.test.ts` → PASS (incluida la prueba de rendimiento).

- [ ] **Step 5: Commit** (sólo si Jordi lo pide).

---

### Task 3: Adaptadores de tenis, fútbol y MMA

**Files:**
- Create: `src/lib/plan-sources.ts`
- Test: `src/lib/plan-sources.test.ts`

**Interfaces:**
- Consumes: `PlanPick` (tarea 1); `TennisDayPick`, `FootballDayPick`, `MmaDayPick` de `src/lib/types.ts` (cada uno trae `id`, `date` ISO del inicio, `top: pick`, `hard: pick | null`; el `pick` es un `TennisPick`: `id, title, book, price, p, ev, rel: { score }`).
- Produces:
  - `windowDays(now: number): string[]` (los días `YYYY-MM-DD` **en hora de España** de `now`, `now + 24 h` y `now + 48 h`, sin repetir y en orden: es lo que hay que pedir a los servicios para cubrir 48 h)
  - `fromTennis(list: TennisDayPick[]): PlanPick[]`, `fromFootball(list: FootballDayPick[]): PlanPick[]`, `fromMma(list: MmaDayPick[]): PlanPick[]` (cada partido da su `top` y, si existe, su `hard`; `id` = `${sport}:${matchId}:${pick.id}`; `match` = `${sport}:${matchId}`; `event` = «A vs B» con los nombres de los jugadores, equipos o luchadores; `league` = torneo, liga u organización; `rel` = `pick.rel.score`; deduplica por `id` entre días)

- [ ] **Step 1: Escribir las pruebas que fallan** con ejemplos mínimos construidos a mano (no hace falta rellenar todos los campos de los tipos: usar un `as` en el ayudante de prueba):
  - `windowDays` a las 2026-11-18T10:00Z → `['2026-11-18', '2026-11-19', '2026-11-20']`; a las 2026-11-18T23:30Z (ya es el 19 en España) → `['2026-11-19', '2026-11-20', '2026-11-21']`; en el cambio de hora de octubre (2026-10-24T22:30Z) no repite ni salta ningún día.
  - `fromTennis` con un partido con `top` y `hard` → 2 `PlanPick`, con `match` común, `event` `'Nombre A vs Nombre B'`, `rel` igual a `pick.rel.score`, `start` igual a `date`; con `hard: null` → 1.
  - `fromFootball` usa `home.name`/`away.name` y `leagueName`; `fromMma` usa `a.name`/`b.name` y `orgName`.
  - El mismo partido en dos listas (dos días) no duplica sus apuestas.

- [ ] **Step 2: Ejecutar y ver que falla**
  Run: `npx vitest run src/lib/plan-sources.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar** las cuatro funciones de Interfaces. `windowDays` usa `toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })` (da `YYYY-MM-DD`): no importar nada de `components/`.

- [ ] **Step 4: Ejecutar y ver que pasa**
  Run: `npx vitest run src/lib/plan-sources.test.ts` → PASS.

- [ ] **Step 5: Commit** (sólo si Jordi lo pide).

---

### Task 4: Datos, navegación y formulario con el aviso de las 48 h

**Files:**
- Create: `src/components/plan/usePlanPool.ts`
- Create: `src/components/plan/WindowNotice.tsx`
- Create: `src/views/PlanView.tsx`
- Modify: `src/lib/app-context.tsx` (`View` gana `'plan'`)
- Modify: `src/App.tsx` (`NAV`, render, barra inferior)

**Interfaces:**
- Consumes: `windowDays`, `fromTennis`, `fromFootball`, `fromMma` (tarea 3); `poolStats`, `parseEuros`, `buildPlan`, `Plan`, `PlanSport`, `WINDOW_HOURS` (tareas 1 y 2); `window.api.tennis.picksDay`, `.football.picksDay`, `.mma.picksDay`; `useWallet()` de `app-context`.
- Produces:
  - `usePlanPool(): { pool: PlanPick[]; sports: Record<PlanSport, { loading: boolean; error: string | null }>; updatedAt: number | null }` (`useQueries` de 3 días × 3 deportes, clave `['plan', deporte, día]`, `staleTime` 3 min, sin `retry`; `updatedAt` es el `dataUpdatedAt` más antiguo de las consultas que han terminado, o `null`)
  - `WindowNotice({ stats, sports, updatedAt, now }: { stats: ReturnType<typeof poolStats>; sports: ReturnType<typeof usePlanPool>['sports']; updatedAt: number | null; now: number })`: texto fijo «El plan sólo usa partidos que empiezan en las próximas 48 horas: es cuando se leen las cuotas», y debajo una línea por deporte (Tenis, Fútbol, MMA) con partidos y apuestas que entran, «cargando…» si carga, «no se pudo cargar» si falla, «sin partidos con cuotas» si 0, y «Baloncesto: próximamente» y «LoL: sin recomendaciones»; «Calculado hace N min» con `updatedAt`.
  - `PlanView(): JSX.Element` (export por defecto): formulario (dinero inicial y beneficio aproximado, campos de texto con `inputMode="decimal"` y `Field`/`Input`; atajo «Usar mi cartera» con el saldo si es > 0; aviso si el dinero supera el saldo; mensaje de error junto al campo si `parseEuros` da `null` y el campo no está vacío); recuerda las dos cifras en `localStorage` con la clave `plan-inputs` dentro de `try/catch`; calcula `buildPlan` con `useMemo` cuando las dos cifras son válidas.
  - `View` gana `'plan'`; `NAV` gana `{ view: 'plan', label: 'Plan', icon: Target }` (de `lucide-react`) tras `bets`; la barra inferior pasa a `grid-cols-5`; el render es `view === 'plan' && (member ? <PlanView /> : <GuestScreen title="Plan" what="el plan de apuestas" />)`.

- [ ] **Step 1: Hook y aviso.** Implementar `usePlanPool` y `WindowNotice`. Un `enabled` por defecto verdadero (la vista sólo se monta con sesión).
- [ ] **Step 2: Vista con el formulario** y el aviso de las 48 h arriba. El plan se calcula pero todavía no se pinta (el resultado llega en la tarea 5): sin pantallas provisionales.
- [ ] **Step 3: Navegación.** `View`, `NAV`, render y `grid-cols-5` en `App.tsx`. Comprobar que `switchApp` no saca de la vista `plan` (es común a todos los deportes: no está entre las vistas que `switchApp` devuelve a `matches`). La etiqueta de la barra inferior cabe en 375 px.
- [ ] **Step 4: Verificar.** Run `npm run typecheck` → sin errores. Run `npm test` → sin fallos nuevos (`avisos.test.js` ya falla en este PC por `web-push`). Probar en pantalla (ver el paso final de la tarea 6): aparece «Plan» en el menú lateral y en la barra inferior; sin sesión, el aviso de entrar; con sesión, el formulario y el aviso de las 48 h con el recuento por deporte.
- [ ] **Step 5: Commit** (sólo si Jordi lo pide).

---

### Task 5: Resultado: panel de riesgo y tarjetas de apuestas

**Files:**
- Create: `src/components/plan/RiskPanel.tsx`
- Create: `src/components/plan/TicketCard.tsx`
- Modify: `src/views/PlanView.tsx`

**Interfaces:**
- Consumes: `Plan`, `Ticket`, `Risk`, `RiskLevel` (tareas 1 y 2); `money`, `odd`, `pct` de `src/lib/format.ts`; `useCurrency()`; `Badge`, `Card`, `Empty`, `PlayNotice` de `ui.tsx`.
- Produces:
  - `RiskPanel({ plan }: { plan: Plan })`: **primero** `risk.pReach` en grande con `risk.level` en un `Badge` (bajo `success`, medio `info`, alto `warning`, muy alto `danger`) y `risk.message`; debajo, tres cifras (probabilidad de acabar en beneficio, de perder todo lo apostado y lo que devuelve de media por cada 100 puestos); debajo, cada aviso de `plan.warnings` en su línea (el de valor esperado negativo en rojo); un «Cómo se calcula» desplegable (`details`) que explica en 4 líneas: probabilidades del modelo, apuestas independientes, combinadas multiplican y por qué el reparto busca llegar al objetivo.
  - `TicketCard({ ticket, index }: { ticket: Ticket; index: number })`: «Apuesta N · Sencilla» o «· Combinada de K», cada pata con deporte (Tenis, Fútbol, MMA), `event`, `title` y cuota; abajo el importe, la cuota total y lo que se cobra si sale, en un formato que cabe en 375 px.
  - En `PlanView`: con plan, se pinta `RiskPanel`, luego una `TicketCard` por ticket y `PlayNotice` debajo; con `plan.tickets.length === 0`, `Empty` con el motivo (sin partidos con cuotas en las próximas 48 h o filtro que descarta todo) y sin tickets; mientras alguna consulta carga y aún no hay pool, `Loading`.

- [ ] **Step 1: Implementar `RiskPanel` y `TicketCard`** con las firmas de Interfaces. El texto de ambos no usa ninguna de las palabras prohibidas de Global Constraints.
- [ ] **Step 2: Enganchar en `PlanView`** el resultado, el estado vacío y el de carga.
- [ ] **Step 3: Verificar.** Run `npm run typecheck` → sin errores; `npx vitest run` → todo en verde. En pantalla: con 100 € y +20 € sale un plan con su panel de riesgo arriba, y con +500 € sale igualmente «muy alto» con su aviso; cambiar las cifras recalcula al momento; a 375 px no hay scroll lateral.
- [ ] **Step 4: Commit** (sólo si Jordi lo pide).

---

### Task 6: Documentación y comprobación en navegador

**Files:**
- Modify: `AGENTS.md` (un apartado nuevo en las convenciones)
- Modify: `docs/superpowers/specs/2026-11-18-plan-apuestas-design.md` (sólo si la implementación se desvía)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: AGENTS.md.** Añadir, junto a las otras vistas, un punto «Plan de apuestas» que diga: vista `plan` común a los deportes; `src/lib/plan.ts` (reparto y riesgo, puros), `plan-sources.ts` (adaptadores) y `src/components/plan/`; ventana de 48 h y su aviso arriba; el filtro de elegibles y por qué no se filtra por veredicto (las recomendaciones más fiables son «No apostar»: cuota baja y valor esperado ligeramente negativo); el aviso de valor esperado negativo no se quita; sin lenguaje de garantía; si se cambia el modelo de un deporte o la forma de sus recomendaciones del día, ajustar su adaptador y `plan-sources.test.ts`; baloncesto entra en la entrega 2.
- [ ] **Step 2: Comprobación en navegador** con el Chromium del contenedor `lector` contra la imagen web reconstruida (`docker compose up -d --build web`; se entra por `http://web` desde la red interna de Docker, sin abrir puertos): crear una cuenta de prueba, y comprobar con capturas a 1366 px y a 375 px (con `isMobile`) que: «Plan» está en el menú lateral y en la barra inferior; el aviso de las 48 h se ve arriba con el recuento; con 100 € y +20 € hay plan con panel de riesgo y tarjetas; con +500 € el nivel es «muy alto» y salen los avisos; con «abc» sale el error junto al campo; `document.documentElement.scrollWidth <= clientWidth`. Borrar la cuenta de prueba al terminar. (La CSP de la web bloquea `waitForFunction`: usar `locator.waitFor`; la app mantiene una conexión de avisos, así que no esperar `networkidle`.)
- [ ] **Step 3: Verificación final de la entrega.** Run `npm run typecheck` y `npm test` → sin errores salvo `avisos.test.js` (falta `web-push` en este PC); `npx vitest run` → todo en verde.
- [ ] **Step 4: Commit** (sólo si Jordi lo pide).
