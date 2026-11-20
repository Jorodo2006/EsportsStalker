# Historial de apuestas y formulario de editar, rediseño — diseño

Fecha: 2026-11-19 · Estado: pendiente de aprobación por Jordi

## Intención

Mis apuestas (`src/views/BetsView.tsx`) y el formulario de apuesta (`src/components/BetForm.tsx`) pesan demasiado a la vista y obligan a hacer
scroll lateral para llegar a los botones. Jordi lo ve «muy pesado» y «fatal» lo de mover la pantalla a la derecha para editar o completar una apuesta.
Se rediseñan los dos con las maquetas que eligió: **historial agrupado por día** (opción B) y **formulario en dos columnas** (opción B).

## Objetivos

- El historial deja de ser una tabla de 11 columnas en escritorio: filas ligeras agrupadas por día, sin scroll lateral a ningún ancho.
- Las acciones de una apuesta (marcar ganada o perdida, pasar a un amigo, editar) se alcanzan sin desplazarse.
- El formulario de apuesta (sencilla y combinada) tiene dos columnas en escritorio: **la apuesta** a la izquierda, **dinero y resultado** a la derecha con el
  resumen («Si sale», «Cobro total», «Prob. implícita») siempre a la vista; en el móvil, una columna.
- Al **editar**, el tipo (simple o combinada) y el deporte se enseñan como etiquetas, no como pestañas: no se pueden cambiar. Al **crear** siguen las pestañas.
- Misma información y mismas reglas que ahora: nada se pierde ni cambia de significado.

## No objetivos

- Cambiar qué se guarda, el servidor, las rutas, la resolución automática ni el cálculo de cuota y estado de las combinadas (siguen en `normalizeCombo`, servidor).
- Rediseñar *En juego* (ya usa tarjetas), las gráficas, el desglose o el resto de Mis apuestas.
- Más filtros (por deporte, casa, rango libre de fechas): sólo el buscador, el estado y la semana.
- Editar varias apuestas a la vez.

## Anti-objetivos

- Que una acción importante quede escondida: marcar ganada o perdida y editar siguen a un toque en las apuestas pendientes.
- Que el formulario nuevo permita estados imposibles que hoy se evitan (p. ej. cash out sin importe, una combinada con menos de 2 selecciones).
- Que la cabecera de cada día enseñe un beneficio que no cuadre con la gráfica y los totales: se calcula con la misma función (`betProfit`).
- Scroll lateral a 375 px y a 1366 px (con la columna derecha del cupón puesta).

## Restricciones del proyecto

- Interfaz y comentarios en español; estilo sobrio de `ui.tsx` (`panelCls`, `Button`, `Badge`, `Field`, `Input`, `Select`, `segWrap`/`seg`); sin degradados ni neones.
- Todo cabe en 375 px sin desplazarse de lado; diseño de móvil hacia arriba con `sm:`, `lg:`, y `2xl:` para dos columnas del contenido (el centro es más estrecho que la pantalla).
- Los datos son del usuario (regla 7): no se tocan consultas ni rutas.
- Lógica nueva (agrupar por día, beneficio de un día) en funciones puras con Vitest, como `value.ts`.
- Sin `git commit` ni `git push` sin que Jordi lo pida (regla 8).

## Enfoques considerados

Se enseñaron maquetas de tres para cada pieza y Jordi eligió una:

- **Historial:** A filas de dos líneas · **B agrupado por día (elegida)** · C tarjetas en dos columnas. B quita la fecha repetida de cada fila y da un resumen por día; a cambio
  esconde las acciones secundarias en un menú `⋯`.
- **Formulario:** A primero el resultado, con botones grandes y lo demás plegado · **B dos columnas (elegida)** · C una columna por bloques. B tiene todo a la vista sin plegar nada;
  su coste es que en pantallas estrechas pasa a una columna.

## Diseño

### Historial (`History` en `BetsView.tsx`)

- Una **cabecera por día** (hora de España; «Jueves 19 de noviembre»), con a la derecha: para días con pendientes, «N en juego · X apostados»; para días resueltos, el beneficio del día (verde o rojo, con `betProfit`).
- Cada apuesta es una **fila**: etiqueta de liga, selección en negrita con partido, casa, importe y cuota debajo, estado (`Badge`), beneficio (o cobro posible si está pendiente) y acciones.
  Pendientes sencillas: ✓ y ✕ a la vista y un menú `⋯` con pasar a un amigo y editar. Resueltas y combinadas: `⋯`. Tocar la fila abre la edición.
- **Combinadas:** una fila «Combinada ×N · M de N resueltas»; el estado y el `AutoMark` como hoy.
- El mismo diseño vale a todos los anchos (la tabla de escritorio y `BetCard` del historial se sustituyen); en el móvil los textos se recortan con puntos suspensivos y la fila no se desborda.
- Se mantienen el buscador, el filtro por estado y el mensaje de «ninguna apuesta coincide».
- Se pinta una semana cada vez (ver «Semanas en el historial»).

### Semanas en el historial (petición de Jordi: no hacer una lista infinita)

- El historial enseña **una semana cada vez** (de lunes a domingo, hora de España) y abre en la semana actual. Encima de las cabeceras por día va una barra de semana:
  dos botones grises de flecha (`Button` secundario, `size="icon"`, iconos `ChevronLeft`/`ChevronRight`), un botón gris central con el icono `CalendarDays`, el rango («16 – 22 nov») y un `ChevronDown`,
  un botón fantasma «Esta semana» (sólo si se mira otra) y, a la derecha, «Beneficio de la semana» (`betProfit` de las resueltas; mismo color que el resto de cifras).
  Elegida por Jordi entre tres maquetas (selector segmentado, **botones grises**, filtros con contorno).
- El botón central abre un **calendario del mes** en un popover: lunes primero, flechas de mes, los días de la semana elegida resaltados, un punto en los días con apuestas, y atajos «Esta semana» y «Todas las semanas». Pulsar un día elige su semana entera.
  Componente propio, sin librerías nuevas; se cierra con Esc y al pulsar fuera, y se maneja con teclado.
- **Con el buscador o el filtro de estado puestos** se busca en todas las semanas y se muestran agrupadas por semana (una cabecera de semana con su rango y beneficio, y dentro las de día), para no perder una apuesta por estar en otra semana. «Todas las semanas» hace lo mismo sin filtro.
- Una semana sin apuestas dice «No hay apuestas esta semana» con un atajo a la última semana que tiene.
- La semana elegida no se guarda: al volver a la pantalla se abre en la actual.
- Las funciones puras (inicio de semana en hora de España, rango, agrupar por semana y día, días con apuestas de un mes, beneficio de una semana) van en `src/lib/bet-weeks.ts` con Vitest, incluidos el cambio de hora de octubre y de marzo y el domingo a las 23:59.

### Formulario (`BetFormDialog` en `BetForm.tsx`)

- Dos columnas desde `lg`: **La apuesta** (partido, mercado, selección, fecha, liga, casa, notas) y **Dinero y resultado** (cuota, stake, estado, cash out y el resumen). En la combinada, la izquierda
  lleva las selecciones (cada una con partido, mercado, selección, cuota y botones de estado) y debajo fecha, casa y notas; la derecha, igual que en la sencilla con la cuota total.
- Pestañas de tipo y deporte sólo al crear; al editar, etiquetas.
- El botón «Guardar», «Cancelar» y «Eliminar» siguen abajo en una fila.
- El resumen se actualiza al escribir, con las mismas fórmulas de hoy.

## Decisiones mías (a revisar)

- El **mismo diseño de fila a todos los anchos** en vez de tabla en escritorio y tarjetas en móvil: menos código y se ve igual.
- Cash out y notas **no se pliegan** (la maqueta B los muestra siempre): son pocos campos y así no se esconde nada.
- La cabecera del día cuenta con la fecha de la apuesta (`b.date`), como ya ordena el historial; la semana, igual.
- La semana empieza en lunes y no se recuerda entre visitas.
- El calendario del mes es un componente propio (sin librería) para no añadir dependencias.

## Lo que queda al criterio de quien construya

Nombres de ficheros y componentes nuevos (se espera sacar `History` y el formulario a `src/views/bets/` y `src/components/` si crecen), el menú `⋯` (popover propio o el patrón que ya
use la app), los tamaños y espacios exactos dentro del estilo del proyecto, y la forma de agrupar por día mientras sea una función pura probada.
