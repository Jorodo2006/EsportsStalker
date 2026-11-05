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
- banca, igual a la banca inicial de los ajustes más el beneficio;
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
  todas las apuestas (LoL, baloncesto y tenis) − lo que está en juego. Sale arriba a la derecha y en *Mis apuestas*;
  las estadísticas de *Mis apuestas* son las de la app abierta.
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
- **Historial**:
  - La combinada sale como una fila con la insignia *Combinada ×N*. Ya no se despliega: al pulsarla se abre el formulario para marcar sus selecciones; en Mercado pone cuántas hay resueltas.
  - Cada selección se marca como ganada, perdida, nula o pendiente desde ahí.
  - Las combinadas no tienen los botones rápidos de ganada/perdida.

## Importar y exportar

- **JSON**: el array de apuestas tal cual.
- **CSV** (se abre en Excel):
  - columnas `id, date, league, event, market, selection, bookmaker, odds, stake, status, cashout, notes, legs`;
  - `legs` va como JSON dentro de la celda.
- Al importar, cada apuesta pasa por `normalizeBet`.
