# Plan de apuestas por objetivo — diseño

Fecha: 2026-11-18 · Estado: pendiente de aprobación por Jordi

## Intención

El usuario pone **cuánto dinero tiene para apostar** y **qué beneficio aproximado quiere**, y la app le dice **entre qué apuestas repartirlo**
y **cuánto poner en cada una**, con un **índice de riesgo** que dice con honestidad qué probabilidad hay de conseguirlo. Es una pantalla
nueva en el menú lateral que sirve a los cuatro deportes con recomendaciones a la vez (baloncesto, tenis, fútbol y MMA).

Fijar un beneficio fija la cuota que hace falta: +20 € con 100 € cabe en apuestas sencillas; +80 € obliga a combinadas y a una
probabilidad baja. Por eso el plan **se arma siempre** (decisión de Jordi) pero **el aviso de riesgo es parte del resultado**, no un texto
al pie: lo primero que se ve es la probabilidad de llegar al objetivo.

## Objetivos

- Pantalla **Plan** en el menú lateral (escritorio) y en la barra inferior del móvil, común a todos los deportes (no depende del deporte elegido arriba).
- Dos entradas en euros: dinero inicial y beneficio aproximado.
- Salida: lista de apuestas (sencillas y combinadas) con importe, cuota, deporte, partido y lo que se cobraría; totales; **índice de riesgo**.
- Sólo partidos que empiezan en las **próximas 48 horas** (es cuando se leen las cuotas). La pantalla lo dice arriba, bien visible, con cuántos
  partidos y apuestas entran de cada deporte.
- Todo el dinero se reparte: la suma de los importes es exactamente el dinero inicial.
- Es una pantalla de **cálculo**: no apunta apuestas ni toca la cartera.

## No objetivos

- Pasar el plan al cupón o registrarlo como apuestas (queda como mejora posterior).
- LoL: no tiene recomendaciones, así que no entra (la pantalla lo dice).
- Guardar planes o su historial; ajustes por usuario en el servidor. Sólo se recuerdan en el navegador las dos últimas cifras.
- Un servidor nuevo o rutas nuevas: todo sale de lo que ya existe.
- Prometer un resultado. Las probabilidades son las del modelo, que se equivoca.

## Anti-objetivos (aunque funcione, sería un fracaso)

- Que parezca que el beneficio está asegurado o que anime a jugar más de lo previsto: nada de lenguaje de «garantizado», «seguro» ni «gana»; el riesgo
  se enseña antes que el beneficio.
- Que un objetivo disparatado dé un plan que parezca razonable: el aviso crece con el riesgo y nunca se esconde.
- Que el plan use dinero que no es de la cartera sin avisar.
- Que dos selecciones del mismo partido se junten en una combinada, o que una apuesta se repita en el plan.
- Que la pantalla bloquee el navegador por calcular baloncesto.

## Restricciones del proyecto

- La interfaz sólo habla con `window.api` (regla 5); no se añaden rutas: se reutilizan las de recomendaciones de tenis, fútbol y MMA y el modelo de
  baloncesto del navegador (`playerPicks`, `teamPicks`).
- Las recomendaciones piden cuenta (regla 7): la pantalla va dentro de `MemberOnly` y consulta con `enabled: useMember()`.
- Avisos de juego obligatorios (RD 958/2020): `PlayNotice` («+18 · Juega con responsabilidad») junto al plan, además de `FooterJuego` que ya pone `App.tsx`.
- Lógica en funciones puras con Vitest (como `value.ts`, `basket-model.ts`); interfaz y comentarios en español; estilo sobrio de `ui.tsx` y `viz.tsx`;
  cabe en 375 px sin scroll lateral; preferencias en `localStorage` dentro de `try/catch`.
- Las lecturas de cuotas no se aceleran ni se piden más de las que ya hay (las casas pueden bloquear): el plan sólo lee lo que ya hay guardado.
- Sin `git commit` ni `git push` sin que Jordi lo pida (regla 8).

## Cómo se construye (opción elegida por Jordi)

**El plan se arma en el navegador, con un adaptador por deporte y funciones puras para el reparto y el riesgo.** Descartadas: un endpoint nuevo en el
servidor (el modelo de baloncesto está escrito para el navegador y portarlo es grande y arriesgado) y usar sólo la mejor recomendación de cada partido
(poco margen para repartir bien).

### Piezas

**Modelo común** (`src/lib/plan.ts`, puro, con `plan.test.ts`)
- `PlanPick`: `{ id, sport, match, event, league, title, start, book, price, p, ev, rel }` (`rel` de 0 a 100; `p` es la probabilidad de acertar sin
  empate/anulada; `start` en ISO; `match` identifica el partido y es la clave de «no dos patas del mismo partido», `event` sólo es la etiqueta «A vs B»).
- `Ticket`: una apuesta sencilla o una combinada: `{ legs: PlanPick[], price, p, stake, toReturn }` (`price` y `p` de una combinada son el producto de las patas).
- `Plan`: `{ budget, target, tickets, risk, warnings }`.
- `buildPlan(pool: PlanPick[], budget: number, target: number, now?: number): Plan`. **Objetivo:** maximizar la probabilidad de que lo devuelto sea
  al menos `budget + target`. **Reglas:** todas las patas distintas entre tickets (cada apuesta se usa una vez); una combinada no lleva dos patas del mismo
  partido (`event`); los importes suman exactamente `budget` (céntimos; el sobrante del redondeo va al ticket más grande); ningún ticket lleva más del 60 %
  del dinero si hay al menos 3 tickets posibles; sólo se consideran las apuestas con fiabilidad (`rel`) de 45 o más, valor esperado (`ev`) no peor que −10 %,
  cuota entre 1,10 y 15 y que empiecen en las próximas 48 h; salida determinista y en menos de 200 ms con 80 apuestas.
  *(Corregido tras mirar datos reales del 18-11: de 26 recomendaciones de tenis y fútbol, 24 tenían veredicto «No apostar»: son las más fiables, con
  probabilidad 77–82 %, pero cuota 1,15–1,22 y valor esperado cerca de −6 %. Filtrar por veredicto dejaba el plan sin apuestas casi siempre.)*
- `riskOf(tickets, budget, target): Risk` con: `pReach` (probabilidad de devolver al menos `budget + target`), `pProfit` (devolver más de `budget`),
  `pLoseAll` (no gana ningún ticket), `expectedReturn`, `level` (`'bajo' | 'medio' | 'alto' | 'muy alto'`) y `message`. Como los tickets usan patas distintas,
  son independientes: la distribución exacta sale de enumerar los resultados de cada ticket (hasta 12 tickets).
- **Índice** por `pReach`: ≥ 60 % bajo, 35–60 % medio, 15–35 % alto, < 15 % muy alto. Se dice siempre en texto («Es muy improbable: X %») y con un color;
  nunca sólo color.
- Un aviso añadido cuando la cuota necesaria (`1 + target/budget`) es mayor de 3, y otro fijo: las probabilidades son del modelo, se supone independencia
  entre apuestas y las cuotas pueden haber cambiado.
- **Valor esperado del plan:** como las recomendaciones más fiables suelen tener valor esperado ligeramente negativo, si `expectedReturn < budget` el
  panel de riesgo lo dice de forma explícita («De media, este plan devuelve X € por cada 100 € puestos: a la larga se pierde dinero») y se enseña junto a
  la probabilidad de llegar. Un plan nunca se presenta como rentable si no lo es.

**Adaptadores** (`src/lib/plan-sources.ts`, con pruebas sobre ejemplos)
- Tenis, fútbol y MMA: de `window.api.<deporte>.picksDay(fecha)` (`top` y `hard` de cada partido, que comparten forma con `TennisPick`), pidiendo hoy,
  mañana y pasado y filtrando por la hora de inicio. `rel` sale de `pick.rel.score`.
- Baloncesto (segunda entrega): las mismas funciones que ya usa `BasketPicks.tsx` (`playerPicks` y `teamPicks`, filtradas con `saneLine`/`hasValue`) sobre los
  partidos de las próximas 48 h, cargados de uno en uno con progreso visible y sin bloquear la interfaz. Se marca como «estimación» (no hay cuotas históricas
  para comprobar el acierto de baloncesto, `docs/specs/08-baloncesto.md`).
- Cada adaptador devuelve además cuántos partidos miró y cuántos entraron, para el aviso de las 48 h.

**Pantalla** (`src/views/PlanView.tsx` y `src/components/plan/`)
- `View` gana `'plan'`; entrada «Plan» con icono `Target` en el menú lateral y una quinta en la barra inferior móvil (`grid-cols-5`).
- Arriba, un **aviso fijo de las 48 h**: «El plan sólo usa partidos que empiezan en las próximas 48 horas: es cuando se leen las cuotas», con el
  recuento por deporte y cuándo se calcularon las recomendaciones (los endpoints del día no traen la edad de cada cuota; la edad exacta sólo la da el
  detalle de cada partido); si un deporte no tiene nada o aún está cargando, lo dice.
- Formulario: dinero inicial y beneficio aproximado en euros, con validación (positivos, el dinero con 2 decimales como máximo) y un atajo «Usar mi cartera»;
  si el dinero supera lo que hay en la cartera, se avisa.
- Resultado: primero el **panel de riesgo** (probabilidad de llegar, de acabar en beneficio y de perderlo todo, nivel y mensaje), luego los tickets (una
  tarjeta por ticket: patas con deporte, partido y cuota; importe; cobro si sale), luego el recuento y un «Cómo se calcula» desplegable.
- Sin apuestas suficientes: mensaje claro de qué falta (p. ej. «hoy sólo hay N apuestas de tenis con cuotas»), sin plan inventado.
- `PlayNotice` junto al plan. Recuerda las dos últimas cifras en `localStorage` (`try/catch`).

## Entregas

1. **Núcleo y tres deportes:** `plan.ts` con pruebas, adaptadores de tenis, fútbol y MMA, pantalla, navegación (escritorio y móvil), avisos.
2. **Baloncesto:** adaptador con carga progresiva y su etiqueta de «estimación».

Cada entrega termina con `npm run typecheck` y `npm test` sin errores y probando la pantalla en `npm run dev` a 375 px y en escritorio.

## Decisiones mías (a revisar)

- El plan reparte **todo** el dinero y maximiza la probabilidad de llegar al objetivo, con un tope del 60 % del dinero por ticket (con ≥ 3 posibles).
- Sólo entran apuestas con fiabilidad ≥ 45, valor esperado ≥ −10 % y cuota 1,10–15, de partidos que empiezan en 48 h (el veredicto «Apostar» dejaba
  el pool casi vacío con datos reales). El plan avisa expresamente cuando su valor esperado es negativo.
- Los umbrales del índice de riesgo (60 / 35 / 15 %) y el aviso por cuota necesaria mayor de 3.
- Quinta pestaña en la barra inferior del móvil; icono `Target`; nombre «Plan».
- Sólo se calcula con lo que ya hay guardado: no se lanzan lecturas de cuotas.
- No se pasa al cupón en esta versión.

## Lo que queda al criterio de quien construya

El algoritmo exacto de búsqueda (siempre que cumpla las reglas y el tiempo de arriba), los nombres de ficheros dentro de `src/components/plan/`, el diseño
visual dentro del estilo del proyecto, y cuántas combinaciones de patas y patrones de reparto se prueban.
