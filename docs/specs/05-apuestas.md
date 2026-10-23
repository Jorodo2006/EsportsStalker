# 05 · Apuestas

Código: `server/services/bets/store.js` (guardado en `bets.bets` / `bets.bet_legs` y normalización), `src/components/BetForm.tsx` (formulario),
`src/views/BetsView.tsx` (estadísticas e historial), `src/App.tsx` (boleto), `src/lib/format.ts` (`betProfit`, `summarize`).

## Modelo (`src/lib/types.ts`)

```ts
type BetStatus = 'pending' | 'won' | 'lost' | 'void' | 'cashout' | 'halfwon' | 'halflost';
interface Bet {
  id; date /* YYYY-MM-DD */; league; event; market; selection; bookmaker;
  odds; stake; status: BetStatus; cashout; notes;
  legs?: BetLeg[];            // combinada (2 o más selecciones)
}
type LegStatus = 'pending' | 'won' | 'lost' | 'void';
interface BetLeg { event; league; market; selection; odds; status: LegStatus }
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
  selecciones válidas, se llama a `normalizeCombo`, que recalcula siempre en el proceso principal:
  - **cuota** = producto de las cuotas de las selecciones; las nulas cuentan como 1;
  - **estado**:
    - `lost` si alguna selección está perdida;
    - `pending` si alguna sigue pendiente;
    - `void` si todas son nulas;
    - `won` en cualquier otro caso;
    - `cashout` si el usuario lo marca, y entonces manda sobre el cálculo;
  - **resumen**: `event` (partidos unidos con " + "), `selection` (lo mismo con las selecciones),
    `league` (ligas únicas unidas con " / ") y `market = 'Combinada'`.
- **Boleto** (`slip` en `app-context`, guardado en `localStorage` con la clave `slip`):
  - Para añadir, clic derecho o Mayús+clic en una cuota del comparador, o el botón *Añadir a combinada* del formulario
    cuando se abre desde una cuota.
  - Si llega otra selección del mismo partido y mercado, sustituye a la anterior. Si es la misma selección, se avisa
    y no se duplica.
  - El widget flotante (abajo a la derecha) enseña las selecciones y la cuota total. Avisa si mezclan casas distintas.
    Tiene los botones *Crear combinada* (con 2 o más selecciones) y *Vaciar*.
  - *Crear combinada* abre el formulario con `{ legs, bookmaker, league, fromSlip: true }`. Al guardar, el boleto se vacía.
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
