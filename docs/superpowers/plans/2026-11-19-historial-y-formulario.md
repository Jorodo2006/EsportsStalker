# Historial por semanas y formulario en dos columnas — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir la tabla del historial de Mis apuestas por filas ligeras agrupadas por día, con una semana cada vez y un calendario para elegirla, y pasar el formulario de apuesta a dos columnas.

**Architecture:** Funciones puras de fechas y agrupación (`src/lib/bet-weeks.ts`, con Vitest) y componentes nuevos de interfaz (`src/components/bets/`: barra de semana, calendario, menú de fila) que usa un `History` reescrito (`src/views/bets/History.tsx`). El formulario cambia sólo de disposición dentro de `BetForm.tsx`. Sin servidor ni rutas.

**Tech Stack:** React 19 + TypeScript + Tailwind 4 + TanStack Query; Vitest; iconos `lucide-react`.

**Spec:** [docs/superpowers/specs/2026-11-19-historial-y-formulario-design.md](../specs/2026-11-19-historial-y-formulario-design.md)

## Global Constraints

- Interfaz y comentarios en español; estilo sobrio de `ui.tsx` (`Button`, `Badge`, `Field`, `Input`, `Select`, `Card`, `Empty`, `segWrap`/`seg`, `panelCls`); sin degradados ni neones; sin comentarios dentro de expresiones JSX.
- El historial enseña **una semana cada vez**, de **lunes a domingo**, y abre en la semana actual; la semana elegida no se guarda entre visitas.
- Barra de semana: dos `Button` secundarios `size="icon"` (`ChevronLeft`, `ChevronRight`), un `Button` secundario central con `CalendarDays`, el rango y `ChevronDown`, un `Button` `ghost` «Esta semana» (sólo si se mira otra) y a la derecha «Beneficio de la semana».
- Calendario en popover: lunes primero, flechas de mes, semana elegida resaltada, punto en los días con apuestas, atajos «Esta semana» y «Todas las semanas»; se cierra con Esc y al pulsar fuera; manejable con teclado; sin librerías nuevas.
- Con buscador o filtro de estado puestos, o con «Todas las semanas», se busca en todas las semanas y se agrupa por semana (cabecera con rango y beneficio) y dentro por día.
- Cabecera de día: «Jueves 19 de noviembre»; a la derecha, «N en juego · X apostados» si el día tiene pendientes, si no el beneficio del día (verde, rojo o gris), calculado con `betProfit`.
- Fila de apuesta: etiqueta de liga, selección en negrita, debajo partido · casa · «stake a cuota»; estado (`Badge` con `STATUS_TONE`/`STATUS_LABEL`), beneficio (o cobro posible si está pendiente) y acciones. Pendiente sencilla: ✓ y ✕ a la vista y menú `⋯` (pasar a un amigo, editar); resuelta o combinada: sólo `⋯`. Tocar la fila abre la edición. Combinada: «Combinada ×N · M de N resueltas» y `AutoMark`.
- Las fechas de las apuestas son cadenas `YYYY-MM-DD` (`Bet.date`): la aritmética de semanas se hace sobre la cadena, sin zonas horarias. «Hoy» es la fecha local del navegador.
- Formulario: dos columnas desde `lg` («La apuesta» a la izquierda, «Dinero y resultado» a la derecha con el resumen «Si sale» / «Cobro total» / «Prob. implícita» siempre visible); una columna por debajo. Al editar (`betDraft.id`), tipo y deporte son etiquetas; al crear, las pestañas actuales. Cash out y notas siempre visibles. Mismas validaciones, mismas fórmulas, mismo guardado.
- Todo cabe en 375 px y en 1366 px (con la columna del cupón) sin scroll lateral.
- No se toca el servidor, las rutas, `normalizeCombo`, la resolución automática ni `Pending`/`BetCard` de *En juego*.
- TypeScript estricto (`noUnusedLocals`, `noUnusedParameters`); lógica pura con pruebas Vitest (`src/lib/*.test.ts`, alias `@/`).
- Sin `git commit` ni `git push` sin que Jordi lo pida en ese momento (regla 8).

## Review Focus

1. **Semana actual vacía con apuestas sólo en semanas antiguas** → «No hay apuestas esta semana» con atajo a la última que tiene; nunca una pantalla en blanco. Tareas 1 (`latestWeekWithBets`) y 3.
2. **Bordes de semana, mes y año** (domingo/lunes, 31 dic → 1 ene, 29 feb, fechas vacías o mal formadas en una apuesta antigua) → caen en la semana correcta; una fecha inválida no rompe nada y sólo sale en «Todas las semanas» bajo «Sin fecha». Tarea 1.
3. **Buscador o estado con resultados en varias semanas, o en ninguna** → se muestran agrupados por semana; sin resultados, «Ninguna apuesta coincide con el filtro». Tarea 3.
4. **Combinada al editar** (menos de 2 selecciones, selección sin cuota, estado Auto/Cash out, cash out sin importe) → las mismas validaciones y avisos que hoy, con la nueva disposición. Tarea 4.
5. **Textos largos y 375 px** (selección de combinada de 4 patas, nombre de jugador largo, importes grandes) → se recortan con puntos suspensivos y la página no se desplaza de lado. Tareas 3, 4 y 5.

---

### Task 1: Fechas y agrupación (puro)

**Files:**
- Create: `src/lib/bet-weeks.ts`
- Test: `src/lib/bet-weeks.test.ts`

**Interfaces:**
- Consumes: `Bet` de `@/lib/types`; `betProfit` de `@/lib/format`.
- Produces (`bet-weeks.ts`):
  - `todayStr(now?: number): string` (fecha local `YYYY-MM-DD`; `now` por defecto `Date.now()`)
  - `isDate(s: string): boolean` (`YYYY-MM-DD` válida, comprobando que el día existe)
  - `weekStart(date: string): string` (lunes de esa semana; `''` si la fecha no es válida)
  - `addDays(date: string, n: number): string`, `addWeeks(start: string, n: number): string`
  - `weekDays(start: string): string[]` (los 7 días, de lunes a domingo)
  - `weekLabel(start: string): string` (`'16 – 22 nov'`; si cruza mes `'26 oct – 1 nov'`; si cruza año `'28 dic 2026 – 3 ene 2027'`)
  - `dayLabel(date: string): string` (`'Jueves 19 de noviembre'`)
  - `interface DayGroup { date: string; bets: Bet[]; profit: number; pending: number; pendingStake: number }`
  - `interface WeekGroup { start: string; days: DayGroup[]; profit: number; count: number }` (`start === ''` es «Sin fecha»)
  - `groupByDay(bets: Bet[]): DayGroup[]` (días de más reciente a más antiguo; dentro de un día, las apuestas por `id` descendente)
  - `groupByWeek(bets: Bet[]): WeekGroup[]` (semanas de más reciente a más antigua; «Sin fecha» la última)
  - `monthGrid(year: number, month: number): string[][]` (`month` 0–11; filas de 7 días, lunes primero, las semanas que tocan el mes)
  - `betDates(bets: Bet[]): Set<string>`
  - `latestWeekWithBets(bets: Bet[], before?: string): string | null` (lunes de la última semana con apuestas, con `before` = lunes límite exclusivo; `null` si no hay)

- [ ] **Step 1: Escribir las pruebas que fallan** en `src/lib/bet-weeks.test.ts`, con un ayudante `bet(date, over?: Partial<Bet>)` (`status: 'won'`, `stake: 10`, `odds: 2`, `id` creciente) y estas aserciones exactas:
  - `weekStart('2026-11-19') === '2026-11-16'`; `'2026-11-16' → '2026-11-16'` (lunes); `'2026-11-22' → '2026-11-16'` (domingo); `'2026-11-23' → '2026-11-23'`; `'2027-01-01' → '2026-12-28'` (cruza año); `'2024-02-29' → '2024-02-26'`; `'' → ''`; `'2026-13-45' → ''`; `'hoy' → ''`; `'2026-02-30' → ''`.
  - `isDate('2026-02-28') === true`, `isDate('2026-02-29') === false`, `isDate('2024-02-29') === true`.
  - `addDays('2026-12-31', 1) === '2027-01-01'`; `addWeeks('2026-11-16', -1) === '2026-11-09'`; `weekDays('2026-11-16')` tiene 7 días de `'2026-11-16'` a `'2026-11-22'`.
  - `weekLabel('2026-11-16') === '16 – 22 nov'`; `weekLabel('2026-10-26') === '26 oct – 1 nov'`; `weekLabel('2026-12-28') === '28 dic 2026 – 3 ene 2027'`.
  - `dayLabel('2026-11-19') === 'Jueves 19 de noviembre'`; `dayLabel('2026-11-16') === 'Lunes 16 de noviembre'`.
  - `groupByDay`: con apuestas el 17, 19 y otra el 19 → 2 grupos, el primero `'2026-11-19'` con 2 apuestas; `profit` de un día = suma de `betProfit` (ganada de 10 a 2 → 10; perdida de 10 → −10; pendiente y nula → 0); `pending` y `pendingStake` cuentan sólo las pendientes.
  - `groupByWeek`: apuestas del 16, 19 y 9 de noviembre → 2 semanas (`'2026-11-16'` con 2 días y `'2026-11-09'` con 1), `count` 2 y 1, `profit` de la semana = suma de sus días. Una apuesta con `date: ''` y otra con `'xx'` → un grupo final con `start === ''` y `count` 2; una lista vacía → `[]`.
  - `monthGrid(2026, 10)` (noviembre de 2026): 5 filas de 7; `[0][0] === '2026-10-26'`; `[0][6] === '2026-11-01'`; `[4][0] === '2026-11-30'`; `[4][6] === '2026-12-06'`. `monthGrid(2026, 1)` (febrero de 2026, empieza en domingo): primera fila empieza el `'2026-01-26'`.
  - `betDates` devuelve un `Set` con las fechas válidas de las apuestas (sin `''`).
  - `latestWeekWithBets([bet('2026-11-04'), bet('2026-11-19')]) === '2026-11-16'`; con `before: '2026-11-16'` → `'2026-11-02'`; `latestWeekWithBets([], …) === null`; con sólo apuestas sin fecha → `null`.
  - `todayStr(Date.parse('2026-11-19T12:00:00'))` (hora local) `=== '2026-11-19'`.

- [ ] **Step 2: Ejecutar y ver que falla**
  Run: `npx vitest run src/lib/bet-weeks.test.ts`
  Expected: FAIL (`Failed to resolve import "./bet-weeks"`).

- [ ] **Step 3: Implementar `bet-weeks.ts`** con las firmas de Interfaces. La aritmética de días usa `Date.UTC` sobre las partes de la cadena y se devuelve con `toISOString().slice(0, 10)`: así no hay horario de verano en medio. `isDate` comprueba que, al reconstruir la fecha, año, mes y día coinciden. Meses abreviados `ene feb mar abr may jun jul ago sep oct nov dic` y completos en minúscula para `dayLabel`. Comentarios en español que expliquen por qué se trabaja con cadenas.

- [ ] **Step 4: Ejecutar y ver que pasa**
  Run: `npx vitest run src/lib/bet-weeks.test.ts` → PASS.

- [ ] **Step 5: Commit** (sólo si Jordi lo pide): `bet-weeks.ts`, `bet-weeks.test.ts`.

---

### Task 2: Barra de semana y calendario

**Files:**
- Create: `src/components/bets/useDismiss.ts`
- Create: `src/components/bets/WeekPicker.tsx`
- Create: `src/components/bets/WeekBar.tsx`

**Interfaces:**
- Consumes: `weekStart`, `weekDays`, `weekLabel`, `addWeeks`, `monthGrid`, `todayStr`, `isDate` (tarea 1); `Button` de `ui.tsx`; `cn`, `money`, `tone` de `@/lib/format`; `useCurrency` de `@/lib/app-context`.
- Produces:
  - `useDismiss(open: boolean, onClose: () => void, ref: RefObject<HTMLElement | null>): void` (cierra con Esc y al pulsar fuera de `ref`)
  - `WeekPicker({ week, marked, today, onPick, onAll, onThisWeek, onClose }: { week: string | null; marked: Set<string>; today: string; onPick: (start: string) => void; onAll: () => void; onThisWeek: () => void; onClose: () => void })` (`week` `null` = «Todas»; el mes que se ve empieza en el de `week` o, si es `null`, en el de `today`)
  - `WeekBar({ week, today, marked, profit, onChange }: { week: string | null; today: string; marked: Set<string>; profit: number | null; onChange: (w: string | null) => void })` (`week` `null` = «Todas las semanas»; `profit` `null` oculta «Beneficio de la semana»)

- [ ] **Step 1: `useDismiss`.** Un `useEffect` que, con `open`, escucha `keydown` (Escape) y `mousedown` en `document` y llama a `onClose` si el clic cae fuera de `ref.current`. Limpia los oyentes al cerrar.
- [ ] **Step 2: `WeekPicker`.** Popover (`absolute`, `z-30`, `w-[17rem]`, fondo y borde de `panelCls`, esquinas de 10 px) con: cabecera `‹ Noviembre 2026 ›` (`Button` ghost icon, mes con `toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })` capitalizado), cabecera de días `L M X J V S D`, rejilla de `monthGrid` con cada día un `<button>` (días de otro mes en gris, hoy en negrita, los de la semana elegida con fondo `bg-zinc-700` y extremos redondeados, punto naranja `bg-amber-500` de 4 px si `marked.has(día)`, `aria-label` con la fecha completa y `aria-pressed` si está en la semana elegida); al pulsar un día llama a `onPick(weekStart(día))` y `onClose()`. Debajo, dos `Button` `size="sm"` `variant="secondary"`: «Esta semana» (`onThisWeek`) y «Todas las semanas» (`onAll`), y una leyenda `text-xs text-zinc-500` «● días con apuestas». Foco en el día elegido al abrir; flechas de teclado mueven el foco entre días (±1 y ±7) y Enter lo elige.
- [ ] **Step 3: `WeekBar`.** Contenedor `flex flex-wrap items-center gap-2`; `Button` secundario icon `ChevronLeft` (`aria-label="Semana anterior"`, `onChange(addWeeks(semana, -1))`; con `week === null` están desactivados); el `Button` secundario central (`aria-haspopup="dialog"`, `aria-expanded`) con `CalendarDays`, `weekLabel(week)` o «Todas las semanas» y `ChevronDown`, que abre el `WeekPicker` en un contenedor `relative`; `ChevronRight` (`aria-label="Semana siguiente"`); `Button` `ghost` `size="sm"` «Esta semana» sólo si `week !== weekStart(today)`; a la derecha (`ml-auto text-right`) «Beneficio de la semana» en `text-xs text-zinc-500` y la cifra con `money(profit, cur, true)` y `tone(profit)` (gris si 0). En 375 px la cifra baja a su propia línea (`basis-full sm:basis-auto`).
- [ ] **Step 4: Verificar.** Run `npm run typecheck` → sin errores. (La interfaz se prueba en pantalla en la tarea 5; aquí no hay lógica nueva.)
- [ ] **Step 5: Commit** (sólo si Jordi lo pide).

---

### Task 3: Historial por días y semanas

**Files:**
- Create: `src/views/bets/AutoMark.tsx` (mover `AutoMark` desde `BetsView.tsx` y exportarlo)
- Create: `src/components/bets/RowMenu.tsx`
- Create: `src/views/bets/BetRow.tsx`
- Create: `src/views/bets/History.tsx`
- Modify: `src/views/BetsView.tsx` (quitar `History` y `AutoMark`, importar los nuevos; `BetCard` se queda porque lo usa `Pending`)

**Interfaces:**
- Consumes: `groupByDay`, `groupByWeek`, `weekStart`, `weekDays`, `weekLabel`, `dayLabel`, `betDates`, `latestWeekWithBets`, `todayStr`, `DayGroup`, `WeekGroup` (tarea 1); `WeekBar` (tarea 2); `useDismiss` (tarea 2); `Badge`, `Button`, `Card`, `Empty`, `Input`, `Select` de `ui.tsx`; `STATUS_LABEL`, `STATUS_TONE`, `betProfit`, `decEs`, `money`, `odd`, `tone`, `cn` de `@/lib/format`.
- Produces:
  - `AutoMark({ bet }: { bet: Bet })` (igual que hoy)
  - `RowMenu({ items }: { items: { label: string; icon: LucideIcon; onClick: () => void }[] })` (botón `⋯` con `MoreHorizontal`, `aria-label="Más acciones"`, lista desplegable con `useDismiss`, cada ítem cierra el menú)
  - `BetRow({ bet, onEdit, onSettle, onShare }: { bet: Bet; onEdit: (b: Bet) => void; onSettle: (b: Bet, s: BetStatus) => void; onShare: (b: Bet) => void })`
  - `History({ bets, onEdit, onSettle, onShare })` (mismas props que la actual, export con nombre)

- [ ] **Step 1: Mover `AutoMark`** a `src/views/bets/AutoMark.tsx` sin cambiar su código, exportarlo e importarlo en `BetsView.tsx` (lo usa `BetCard`). Run `npm run typecheck` → sin errores.
- [ ] **Step 2: `RowMenu`** con las firmas de Interfaces.
- [ ] **Step 3: `BetRow`.** Una fila `flex items-center gap-3 px-4 py-3` que abre `onEdit(bet)` al pulsar (los botones de acción hacen `stopPropagation`); izquierda `min-w-0 flex-1`: línea 1 etiqueta de liga (`rounded bg-zinc-800 px-1.5 text-[11px] text-zinc-400`, sólo si hay) y la selección en `font-semibold truncate` (`decEs`); línea 2 `text-xs text-zinc-500 truncate`: `event · mercado · casa · {stake} a {cuota}` para una sencilla, o `Combinada ×N · M de N resueltas · casa · {stake} a {cuota}` para una combinada (en una combinada la selección de la línea 1 es el texto ya existente de `b.selection`). Derecha: `Badge` de estado y `AutoMark` (ocultos por debajo de `sm`: el estado entonces va en la línea 2 como texto corto), importe `text-sm font-semibold tabular-nums` con `tone(betProfit)` (si pendiente, `+{cobro posible}` en gris), y acciones: pendiente sencilla → botones `Check` (`variant="success"`) y `X` (`variant="danger"`) `size="icon"` con `aria-label` «Ganada»/«Perdida» llamando a `onSettle`, más `RowMenu` con «Pasar a un amigo» (`Send`) y «Editar» (`Pencil`); resto → sólo `RowMenu`.
- [ ] **Step 4: `History`.** Estado `week: string | null` (inicial `weekStart(todayStr())`), `q`, `st`. `filtered` = filtro actual por estado y texto (mismo criterio que hoy). `all = q || st || week === null`. Si `all`, se pinta `groupByWeek(filtered)`; si no, `groupByDay(filtered.filter(b => weekStart(b.date) === week))`. La tarjeta `Card` «Historial» mantiene el buscador y el filtro de estado de hoy; debajo, `WeekBar` (con `week` `null` si `all`, y `profit` de la semana sólo cuando se mira una semana; `onChange` pone `setWeek`). Cabecera de día: `bg-zinc-900/60 px-4 py-2 text-xs` con `dayLabel` a la izquierda y a la derecha «N en juego · X apostados» (si `pending > 0`) o `money(profit, cur, true)` con `tone`; en modo `all`, antes de cada semana una cabecera con `weekLabel` (o «Sin fecha»), su beneficio y `count`. Filas con `BetRow`. Estados vacíos: sin apuestas en la lista filtrada → «Ninguna apuesta coincide con el filtro» (si había apuestas) o el mensaje de siempre; semana sin apuestas → `Empty` «No hay apuestas esta semana» con `Button` secundario «Ir a la última semana con apuestas» (`latestWeekWithBets(filtered, week)`; si no hay, no se muestra el botón).
- [ ] **Step 5: Enganchar en `BetsView.tsx`** (`import { History } from '@/views/bets/History'`) y borrar el `History` antiguo, sus imports que queden sin usar (`Layers`, `Pencil`, `Search`, `Send`, `Check`, `X`, `td`, `th` si `Breakdown` ya no los usa… comprobar con el tipado) y la constante `th`/`td` sólo si nadie más la usa.
- [ ] **Step 6: Verificar.** Run `npm run typecheck` → sin errores; `npx vitest run` → todo en verde. En pantalla (ver tarea 5): historial por días, semana actual, flechas, calendario, buscar en todas las semanas.
- [ ] **Step 7: Commit** (sólo si Jordi lo pide).

---

### Task 4: Formulario en dos columnas

**Files:**
- Modify: `src/components/BetForm.tsx`

**Interfaces:**
- Consumes: todo lo existente del fichero (`comboOdds`, `comboStatus`, `LEG_*`, `marketsFor`, `submit`, `remove`); `Badge` de `ui.tsx`.
- Produces: el mismo `BetFormDialog()` exportado, con otra disposición. Sin cambios de props ni de lo que se guarda.

- [ ] **Step 1: Cabecera.** `Dialog` siempre `wide`. Si `betDraft?.id` (editar), sustituir las dos filas de pestañas por una línea de `Badge`: tipo («Simple» o «Combinada ×N»), deporte (nombre de `f.sport`, y «Mixta» si la combinada mezcla deportes) y liga si hay; si no hay `id` (crear, también desde el cupón), conservar las pestañas actuales tal cual.
- [ ] **Step 2: Disposición.** Dentro del `form`, un contenedor `grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-[1.4fr_1fr]` con dos columnas:
  - **Izquierda — «La apuesta»** (subtítulo `text-xs font-medium text-zinc-400 border-b border-zinc-800 pb-1`): en sencilla, Partido, Mercado, Selección, y fila de Fecha, Liga, Casa (`sm:grid-cols-3`), y Notas; en combinada, el bloque de selecciones existente (cabecera de columnas `lg`, filas, «Añadir selección» y cuota total), y debajo fila de Fecha y Casa, y Notas. Los campos y sus `onChange` no cambian.
  - **Derecha — «Dinero y resultado»** (en `lg`, fondo `bg-zinc-900/40` con borde izquierdo, o simplemente separada por `gap`): Cuota (o Cuota total), Stake, Estado, Importe cash out (siempre visible, deshabilitado salvo `cashout`), y el resumen «Si sale / Cobro total / Prob. implícita» **dentro de esta columna**, en vertical (`flex-col gap-2`) y siempre que `o > 1 && s > 0`. Renombrar «Si gana» → «Si sale» y «Retorno total» → «Cobro total».
- [ ] **Step 3: Botones.** La fila «Guardar apuesta», «Cancelar», «Añadir a combinada» y «Eliminar» queda bajo las dos columnas, sin cambios de lógica.
- [ ] **Step 4: Verificar.** Run `npm run typecheck` → sin errores. En pantalla (tarea 5): editar una sencilla y una combinada a 1366 px y a 375 px; las validaciones de combinada («Una combinada necesita al menos 2 selecciones», «Pon la cuota de cada selección») siguen saliendo; guardar y eliminar funcionan.
- [ ] **Step 5: Commit** (sólo si Jordi lo pide).

---

### Task 5: Documentación y comprobación en navegador

**Files:**
- Modify: `AGENTS.md` (un punto sobre Mis apuestas, el historial por semanas y el formulario)
- Modify: `docs/superpowers/specs/2026-11-19-historial-y-formulario-design.md` (sólo si la implementación se desvía)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: AGENTS.md.** Añadir, junto a las otras vistas, un punto «Mis apuestas: historial por semanas»: `src/views/bets/History.tsx`, `BetRow.tsx`, `src/components/bets/` (`WeekBar`, `WeekPicker`, `RowMenu`); una semana cada vez (lunes a domingo, aritmética sobre la cadena `YYYY-MM-DD` de `Bet.date`, `src/lib/bet-weeks.ts` con sus pruebas); con buscador o filtro de estado se busca en todas las semanas; `Pending` sigue con `BetCard`; el formulario `BetForm.tsx` va en dos columnas y, al editar, tipo y deporte son etiquetas.
- [ ] **Step 2: Comprobación en navegador** con el Chromium del contenedor `lector` contra la web reconstruida (`docker compose up -d --build web`, entrando por `http://web`): crear una cuenta de prueba, registrar por la API una docena de apuestas repartidas en cuatro semanas (sencillas ganadas, perdidas y pendientes, una combinada de 3 con una selección larga y una con fecha del domingo y otra del lunes siguiente), y comprobar con capturas a 1366 px (con el cupón a la derecha) y a 375 px (`isMobile`) que: el historial agrupa por día en la semana actual; las flechas cambian de semana; el calendario abre, marca la semana y los días con apuestas; «Todas las semanas» y el buscador agrupan por semana; una semana vacía enseña el atajo a la última con apuestas; ✓ y ✕ de una pendiente cambian su estado; editar una sencilla y una combinada abre el formulario en dos columnas (escritorio) y en una (móvil) con el resumen visible; `document.documentElement.scrollWidth <= clientWidth` en todas. Borrar la cuenta de prueba al terminar (`DELETE FROM bets.users WHERE username=…` en la base local, usuario `lol`). (La CSP de la web bloquea `waitForFunction`: usar `locator.waitFor`; no esperar `networkidle`.)
- [ ] **Step 3: Parar el servidor de maquetas** (`bash …/brainstorming/scripts/stop-server.sh` con el directorio de sesión) y confirmar que `.superpowers/` sigue en `.gitignore`.
- [ ] **Step 4: Verificación final.** Run `npm run typecheck` y `npx vitest run` → sin errores; `npm test` → sólo falla `avisos.test.js` (falta `web-push` en este PC).
- [ ] **Step 5: Commit** (sólo si Jordi lo pide).
