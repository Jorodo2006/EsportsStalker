# 02 · Partidos y directo

Fuente: API no oficial de lolesports.com (la misma que usa su web). Gratis, con una clave pública que ya viene en los
ajustes (`lolesportsKey`).

- `https://esports-api.lolesports.com/persisted/gw/*`: `getLeagues`, `getSchedule`, `getLive`, `getEventDetails`.
- `https://feed.lolesports.com/livestats/v1/window/{gameId}`: estadísticas en vivo (van unos 60 s por detrás).

Código: `electron/services/lolesports.js` (con caché por TTL en `http.js`).

## Lista de partidos (`src/views/MatchesView.tsx`)

- Filtro por liga (con ligas favoritas en los ajustes). Secciones: en directo, próximos y resultados, con paginación.
- Directo y calendario se refrescan según `refreshSeconds`.
- Cada tarjeta enseña la cuota de ganador si alguna casa ya la mandó (`odds.board`, cada 60 s).
- El contador rojo de la barra lateral es el número de partidos en directo.

## Detalle del partido (`src/views/MatchDetail.tsx`)

- **Cabecera**: liga, fase, Bo, fecha, equipos con logo, marcador o hora.
- **Acciones**: botones *Stats EQUIPO*, que abren Jugadores con `nombre|código`, y *+ Apuesta*.
- **Pestaña Cuotas**: el comparador, descrito en [03-cuotas.md](03-cuotas.md).
- **Pestaña Partida en vivo**: un selector de mapa y, refrescados cada 10 s:
  - oro, kills, torres, dragones (con tipo) y barones;
  - K/D/A, CS y vida de cada jugador.
- El partido abierto se mantiene al cambiar de sección. Pulsar *Partidos* otra vez vuelve a la lista.
- Si el partido ha terminado, no se piden cuotas.
