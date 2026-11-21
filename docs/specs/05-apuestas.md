# 05 · Apuestas

Código: `server/services/bets/store.js` (guardado en `bets.bets` / `bets.bet_legs` y normalización), `src/components/BetForm.tsx` (formulario),
`src/views/BetsView.tsx` (estadísticas e historial), `src/App.tsx` (boleto), `src/lib/format.ts` (`betProfit`, `summarize`).

## Modelo (`src/lib/types.ts`)

```ts
type BetStatus = 'pending' | 'won' | 'lost' | 'void' | 'cashout' | 'halfwon' | 'halflost';
interface Bet {
  id; date /* YYYY-MM-DD */; sport? /* 'lol' | 'basket' | 'mix': cada app (LoL, baloncesto) ve las suyas y las mezcladas */; league; event; market; selection; bookmaker;
  odds; stake; status: BetStatus; cashout; notes;
  legs?: BetLeg[];            // combinada (2 o más selecciones)
}
type LegStatus = 'pending' | 'won' | 'lost' | 'void';
interface BetLeg { event; league; market; selection; odds; status: LegStatus; sport? }
type SlipLeg = BetLeg & { bookmaker? };              // selección en el boleto
type BetDraft = Partial<Bet> & { fromSlip?: boolean };
```

## Beneficio

| Estado | Beneficio |
|---|---|
| `won` | `stake × (cuota − 1)` |
| `lost` | `−stake` |
| `void` | 0 |
| `cashout` | `cashout − stake` |
| `halfwon` | la mitad de lo que daría `won` |
| `halflost` | la mitad de lo que daría `lost` |

La implementación está en `betProfit` (`src/lib/format.ts`). Sobre ese beneficio se calculan:

- beneficio total, ROI/yield y % de acierto;
- cuota media y apuestas pendientes con su retorno;
- banca, igual a la banca inicial del usuario (en *Tu cuenta*) más el beneficio;
- la gráfica de evolución (todo, 30 días o 7 días);
- el desglose por casa y por liga.

## Combinadas

- **Guardado.** `normalizeBet` lee `legs`, que puede llegar como array o como texto JSON desde el CSV. Si hay 2 o más
  selecciones válidas, se llama a `normalizeCombo`, que recalcula siempre en el backend:
  - **cuota** = producto de las cuotas de las selecciones; las nulas cuentan como 1;
  - **estado**:
    - `lost` si alguna selección está perdida;
    - `pending` si alguna sigue pendiente;
    - `void` si todas son nulas;
    - `won` en cualquier otro caso;
    - `cashout` si el usuario lo marca, y entonces manda sobre el cálculo;
  - **resumen**: `event` (partidos unidos con " + "), `selection` (lo mismo con las selecciones),
    `league` (ligas únicas unidas con " / ") y `market = 'Combinada'`.
- **Cupón** (el "carrito"; `slip` en `app-context`, guardado en `localStorage` con la clave `slip`,
  `src/components/Coupon.tsx`):
  - Cualquier cuota de cualquier app (comparador de LoL, cuotas de baloncesto y tenis, *Añadir al cupón* del panel de
    valor) se añade al cupón con su deporte. Pulsar otra vez la misma selección la quita.
  - Pestaña *Simples*: un stake para cada selección (botones 5 / 10 / 25 / 50 para todas) y lo que gana cada una.
    *Registrar apuestas* guarda una apuesta por cada selección con stake; las que no tienen se quedan en el cupón.
  - Pestaña *Combinada* (2 o más selecciones, y nunca dos del mismo partido y mercado): cuota total, un stake y el
    retorno. *Registrar combinada* la guarda y vacía el cupón; el lápiz la abre en el formulario para afinarla.
  - Enseña el saldo de la cartera y avisa si se apuesta más de lo que queda, o si las cuotas son de casas distintas.
- **Cartera común** (`wallet` en `src/lib/format.ts`, `useWallet` en `app-context`): banca inicial + beneficio de
  todas las apuestas (los cinco deportes) − lo que está en juego. Sale en el menú lateral (saldo, beneficio y en juego,
  cada cifra con su nombre), en la cabecera del móvil y en *Mis apuestas*; las estadísticas de *Mis apuestas* son las de la
  app abierta. Sin banca inicial no se enseña saldo, que saldría en negativo con la primera apuesta: sale «Pon tu banca»,
  que lleva a *Tu cuenta*. Una cuenta nueva la pone en la bienvenida (`src/components/Welcome.tsx`, una vez: ajuste de
  usuario `welcomed`), con el deporte en el que se abrirá la web.
- ***Mis apuestas*** empieza por las que están en juego (`Pending`, la más nueva arriba, con lo apostado y el cobro
  posible); debajo, las cifras, la evolución, el desglose y el historial completo. Sin ninguna apuesta del deporte, en
  lugar de cifras a cero, cómo apuntar la primera.
- **Formulario**:
  - El selector *Simple / Combinada* pasa los campos de una a otra: la simple se convierte en la primera selección.
  - Hay una fila por selección (partido, mercado, selección, cuota y estado), con *Añadir selección* y la cuota
    total calculada en directo.
  - El campo *Partido* (simple y combinada) es `MatchPicker` (`src/components/MatchPicker.tsx`): vacío enseña todos los
    partidos del día de la apuesta (todas las ligas, del calendario de lolesports); al escribir busca por equipo,
    siglas o liga entre los partidos cargados, y *Buscar en más fechas* trae otra página hacia atrás y hacia delante.
    Al elegir uno rellena `"COD1 vs COD2"` y la liga. También sugiere partidos de apuestas anteriores y admite texto libre.
  - El campo *Mercado* es `OptionInput` (no `<datalist>`, que sólo enseñaba lo que coincidía con lo escrito): al abrirlo
    salen todos los mercados agrupados (partido, mapa 1–5, jugadores, torneo), primero los que el comparador ya leyó
    de ese partido y al final los usados en apuestas anteriores.
- **Historial y resumen por casa / liga**: las selecciones de una combinada se marcan (pendiente, ganada, perdida, nula) con los botones de cada fila del formulario al editarla.
  *Apostado* incluye lo pendiente y hay columna *En juego*; beneficio y ROI sólo cuentan las resueltas (sin
  resueltas se ve "—").
  - El estado general es *Auto* (sale de las selecciones) o *Cash out*.
- **Historial** (`src/views/bets/History.tsx`, `BetRow.tsx`; semanas en `src/lib/bet-weeks.ts`):
  - Una semana cada vez, la actual al abrir, con sus días y lo que suma cada uno. La barra (`WeekBar`) pasa de semana con
    las flechas o con el calendario (`WeekPicker`, que marca los días con apuestas) y tiene *Todas las semanas*.
  - Cada apuesta es una fila (`BetRow`): la selección, el partido, la casa y el importe, el estado y el beneficio; pulsarla
    abre la edición. La combinada dice cuántas selecciones tiene resueltas, y se marcan (ganada, perdida, nula o pendiente)
    al editarla.
  - Las simples pendientes se resuelven desde la lista: ✓ ganada (verde) y ✗ perdida (rojo) a la vista, y *Nula* (se
    devuelve lo apostado) en el menú «⋯», con *Pasar a un amigo* y *Editar*. En *En juego* van los tres botones; en el
    móvil, en su propia fila y con su nombre. La etiqueta *Nula* es azul (`STATUS_TONE`), no gris como la de pendiente.
    Las combinadas no tienen estos botones.
  - Filtros: buscar, estado y **periodo** (`src/lib/bet-period.ts`, con pruebas): todas las fechas, últimos 7 o 30 días,
    cada año y cada mes con apuestas (sólo salen los que tienen alguna) o entre dos fechas. Con cualquier filtro puesto se
    ve todo el historial agrupado por semanas y, encima, lo que suman las que quedan (apuestas, apostado, beneficio y ROI)
    con *Quitar filtros*. Elegir una semana en la barra quita los filtros. Las cifras de arriba, la gráfica y el desglose
    no cambian con el filtro.
- **Beneficio en unidades**: cada beneficio de *Mis apuestas* (cifras, historial, desglose, gráfica y resumen del filtro)
  lleva entre paréntesis las unidades («+25,00 € (+2,50 u)»), como lo cuentan los tipsters que no enseñan su dinero. La
  unidad es el ajuste de usuario `unitSize` (*Tu cuenta*, junto a la banca) o, si está vacío, el 1 % de la banca inicial
  (`useUnit` en `app-context`); sin ninguna de las dos no salen unidades. Las de *Acierto del modelo* son otra cosa: 1 unidad
  por recomendación.

## Resolución automática (`server/services/bets/settle.js`)

Las apuestas y selecciones que saben a qué partido y mercado pertenecen (`ref`, ver `10-base-de-datos.md`) se resuelven
solas con el resultado del partido.

- **De dónde sale `ref`**: al pulsar una cuota del comparador (`SportOdds`, cualquier deporte) va la clave de su fila;
  el escáner de líneas, el analizador y las recomendaciones de jugador de baloncesto ponen `player|<estadística>|<jugador>|<línea>`.
  El cupón lo guarda en cada simple y en cada selección de la combinada; al editar la apuesta se conserva.
- **Apuestas sin `ref`** (las de antes o las de recomendaciones de equipo): si son de baloncesto y llevan los textos
  que pone la app ("CHA @ BKN" + "Total de puntos" + "Más de 212.5", "Asistencias · Naji Marshall" + "Más de 2.5",
  "Ganador", "Hándicap", "Puntos de X", con periodo) se reconocen por el texto (`guessBasket`, `ref.guessed`).
- **Cuándo**: cada 5 minutos, o al pulsar *Comprobar resultados* en Mis apuestas (`POST /api/bets/settle`). Cada
  partido se pide una vez por pasada, al servicio de su deporte por su API (regla 6).
- **Qué sabe resolver**: ganador (1X2 en fútbol), hándicap, totales y puntos/goles/juegos de cada uno, del partido y por
  periodo (mitades y cuartos en baloncesto, 1.ª mitad en fútbol, sets en tenis); doble oportunidad, empate no válido,
  ambos marcan, córners y tarjetas en fútbol; líneas de jugador de baloncesto (nula si no jugó).
- **Lo que deja para hacer a mano**: LoL, mercados propios de cada casa (resultado exacto, goleadores…), líneas de cuarto
  (0,25 / 0,75), partidos de tenis con retirada o W.O., partidos de fútbol con prórroga, un ganador de cuarto empatado,
  y un jugador que no encuentra en el boxscore. Mejor no resolver que resolver mal.
- **Al resolver**: la selección (o la simple) pasa a ganada/perdida/nula y guarda en `ref.settled` qué pasó ("CHA 104-114
  BKN: 218 puntos"); la combinada se recalcula con `normalizeCombo`, como al editarla. Sólo toca lo que está pendiente:
  lo marcado a mano no se cambia. Avisa con `bets:settled` (sin datos de nadie) y la app recarga la lista.
- En el historial, cada apuesta con `ref` lleva la marca *se resuelve sola* / *resuelta sola* (al pasar el ratón, el
  resultado). Pruebas en `server/test/resolver.test.js`.

## Seguir las apuestas en juego (`src/components/MyBetsLive.tsx`, `src/lib/bet-track.ts`)

- Arriba de *Partidos* de cada deporte, «Tus apuestas»: las pendientes con `ref` cuyo partido empieza en las próximas 24 h o
  empezó hace menos de 12 h, de los cinco deportes (primero las que se están jugando; de una combinada, cada selección
  pendiente). Las apuntadas a mano sin partido no salen: no se sabe qué seguir.
- Cómo va cada una sale de `trackOf` (`bet-track.ts`, pruebas en `bet-track.test.ts`), que lee la misma clave de mercado que
  `settle.js`: barra con la cifra frente a la línea en las líneas de jugador de baloncesto, los totales y los totales de equipo
  (y los goleadores de Winamax en fútbol); quién va por delante en ganador, hándicap, doble oportunidad, empate no válido y
  ambos marcan. Es sólo para mirar: la resolución sigue siendo la del servidor. Lo que no sabe seguir no enseña nada.
- Los datos son las listas del día de cada deporte con las mismas claves de consulta que sus pantallas, y la ficha de
  baloncesto (`['basket','box',id]`) sólo para las líneas de jugador y los periodos, desde que empieza el partido.
- Pulsar una abre su partido. Si es una línea de jugador de baloncesto, la ficha se abre en *Estadísticas* con el partido de
  ese jugador (`BasketPlayerGameDialog`): el jugador se pasa con `focusPlayer` (`src/lib/focus-player.ts`), no por la dirección,
  y caduca a los 15 s. Se busca en la ficha con `findPlayer`, el mismo criterio que la resolución.

## Acierto del modelo (`bets.predictions`, `server/services/bets/predictions.js`)

En Administración → **Acierto del modelo** (sólo administradores: `/api/admin/predictions`, `src/views/admin/ModelTab.tsx`) se mide si las recomendaciones aciertan, se apuesten o no. Mientras se ven en la
app (Recomendaciones, la columna de al lado de la lista, la ficha del partido), `src/lib/predictions.ts` manda al servidor todas las líneas
que calcula el modelo de baloncesto y las recomendaciones que enseñan tenis, fútbol y MMA (la principal es "la más fiable", que puede no tener valor), con su partido
y mercado (la misma clave que el `ref` de una apuesta), la probabilidad que enseña la app (`p`) y sus dos partes (modelo y
casa sin margen), la cuota, el EV y la fiabilidad. Se guarda la última opinión antes de empezar y la cuota de la primera
vez. El resolvedor (`settle.js`) las cierra en la misma pasada que las apuestas; si a los 4 días no ha podido, quedan como
`unknown` y fuera de las cuentas. Sólo se guardan mercados que sabe resolver.

La página enseña, de los deportes que ya tengan alguna resuelta (selector *Todo / Baloncesto / Tenis / Fútbol / MMA / LoL*) y de las
recomendadas o de todas las líneas: acierto real frente al esperado (con el margen que da el azar), beneficio y ROI apostando 1 unidad
a cada una, el **movimiento de la cuota (CLV)** (cuánto bajó de media desde la primera vez que se recomendó hasta la última antes de
empezar, y en qué parte de las veces bajó: si baja, el mercado fue hacia lo que decía el modelo; la última es la última que se vio en la app,
no siempre la de cierre), la curva del **beneficio acumulado** frente al que esperaba el modelo (la suma de sus EV), el desglose **por
deporte**, calibración por tramos de probabilidad, Brier del modelo solo, de la casa y de la mezcla sobre las mismas recomendaciones, y el
desglose por mercado, por EV y por casa.

No son de ningún usuario (la recomendación es la misma para todos), pero las manda el navegador de cualquiera con sesión:
el servidor valida cada campo (`clean`, `server/test/predicciones.test.js`).

## Amigos (`src/views/FriendsView.tsx`, `server/services/bets/friends.js`)

En **Amigos** (menú lateral y barra de abajo del móvil, con un número si hay solicitudes, mensajes o apuestas sin ver) se añade a alguien
por su **nombre de usuario**; tiene que aceptar. Desde **Mis apuestas**, el botón ✈ de cada apuesta («Pasar a un amigo») la envía
a uno o varios amigos con un mensaje opcional. Al amigo le llega en *Apuestas que te han pasado* **lo apostado y cómo va ahora,
sin el importe, el cobro ni las notas** de quien la envía. El estado (ganada, perdida, pendiente, nula, cash out…) es el de la
apuesta original en ese momento: si se pasó pendiente y luego se resuelve, el amigo la ve resuelta; en una combinada, cada
selección sale en verde o rojo. **Copiar a mis apuestas** sólo sale mientras está pendiente (una ya jugada no tiene sentido
apostarla): abre *Nueva apuesta* rellena (también las combinadas, con su `ref` para que se resuelva sola) y con el importe vacío,
y apunta en las notas quién se la pasó. Si quien la pasó la borra, o se pasó antes de guardar de cuál salía, se enseña sin estado
y se puede copiar, como antes. Las cuotas son las que tenía el amigo al apostar: el aviso de la lista lo recuerda.

**Chat.** Pulsando en un amigo (o en *Escribir*) se abre su conversación en lugar de *Apuestas que te han pasado* (en el móvil,
arriba): los mensajes y las apuestas que os habéis pasado, por fecha, con *Copiar a mis apuestas* en las suyas. *Pasar una apuesta*
abre tus apuestas (las pendientes primero) para enviarle una con un mensaje opcional. Al aceptar una solicitud se abre el chat.
Los amigos se ordenan por lo último que os dijisteis y llevan el número de mensajes sin leer, que también suma en el menú; al abrir
la conversación queda leída y el otro ve «Leído» bajo su último mensaje. Mensajes de hasta 1000 letras y 20 por minuto. Lo nuevo
llega en vivo con el aviso `chat:new`, que sólo recibe el destinatario y no lleva el texto (lo pide él con su sesión).

Todo sale del usuario de la sesión (la cabecera del gateway): sólo se envían apuestas propias (`getOwnBet`) y sólo a amigos
aceptados; cada uno ve sólo sus solicitudes y lo que le han enviado. Tablas en [10-base-de-datos.md](10-base-de-datos.md);
pruebas de lo que se envía en `server/test/amigos.test.js`.

## Avisos (`src/lib/notify.ts`, `src/components/Notifier.tsx`)

En Ajustes → Avisos se enciende cada uno (se guarda en el navegador):

- **Apuestas resueltas**: cuando el servidor resuelve sola una apuesta tuya (llega `bets:settled` y una pendiente deja de
  estarlo en los 2 minutos siguientes; si la cambias a mano no avisa).
- **Recomendaciones fuertes**: EV ≥ 8 % y fiabilidad ≥ 65; un solo aviso aunque salgan varias, con la mejor.
- **Bajas en tus apuestas**: jugadores de apuestas pendientes de baloncesto (con `ref`) que el parte de ESPN pone como
  Out, Doubtful o Questionable antes del partido (mirado cada 10 minutos).

Sólo funcionan con la app abierta en alguna pestaña. El navegador sólo deja avisar en un sitio seguro (https, 127.0.0.1 o
localhost); desde el móvil por la IP de casa salen dentro de la app. Lo ya avisado se recuerda 4 días (`avisos-vistos`).

## Importar y exportar

- **JSON**: el array de apuestas tal cual.
- **CSV** (se abre en Excel):
  - columnas `id, date, league, event, market, selection, bookmaker, odds, stake, status, cashout, notes, legs`;
  - `legs` va como JSON dentro de la celda.
- Al importar, cada apuesta pasa por `normalizeBet`.
