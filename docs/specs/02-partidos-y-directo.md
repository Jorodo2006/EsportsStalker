# 02 · Partidos y directo

Fuente: API no oficial de lolesports.com (la misma que usa su web). Gratis, con una clave pública que ya viene en los
ajustes (`lolesportsKey`).

- `https://esports-api.lolesports.com/persisted/gw/*`: `getLeagues`, `getSchedule`, `getLive`, `getEventDetails`.
- `https://feed.lolesports.com/livestats/v1/window/{gameId}`: estadísticas en vivo (van unos 60 s por detrás).

Código: `server/services/esports/lolesports.js` (con caché por TTL en memoria en `http.js`), servicio `esports`.

## Lista de partidos (`src/views/MatchesView.tsx`)

- Filtro por liga (con ligas favoritas en los ajustes). Secciones: en directo, próximos y resultados, con paginación.
- Directo y calendario se refrescan según `refreshSeconds`.
- Cada tarjeta enseña la cuota de ganador si alguna casa ya la mandó (`odds.board`, cada 60 s). Pulsarla la añade al
  cupón, en el móvil y en el ordenador; el resto de la tarjeta abre el partido. La resaltada es la del favorito, y lo dice
  la leyenda de encima de la lista (`OddsLegend`).
- El contador rojo de la barra lateral es el número de partidos en directo.
- **Primera visita** (sin deporte guardado en el navegador): la portada mira los partidos en juego de los cinco deportes y
  los de hoy de los cuatro con calendario por días (`busiestSport`, `src/lib/live.ts`), y abre el que más tiene; si en 2,5 s
  no responden, el fútbol. Mientras, «Buscando los partidos de hoy…».
- **Lista vacía** (`NoGames` en `src/components/sport.tsx`, los cinco deportes): dice qué pasa («Hoy no hay combates de MMA»)
  y ofrece el próximo día con partidos (`useNextDay`: dos semanas por delante, sólo con la lista vacía) y los otros
  deportes con partidos en juego. Si lo que vacía la lista es un filtro o un interruptor (Previa, Challenger, una
  organización), lo dice y ofrece quitarlo.

## Detalle del partido (`src/views/MatchDetail.tsx`)

- **Cabecera**: liga, fase, Bo, fecha, equipos con logo, marcador o hora.
- **Acciones**: botones *Stats EQUIPO*, que abren Jugadores con `nombre|código`, y *+ Apuesta*.
- **Pestaña Cuotas**: el comparador, descrito en [03-cuotas.md](03-cuotas.md).
- **Pestaña Partida en vivo**: un selector de mapa y, refrescados cada 10 s:
  - oro, kills, torres, dragones (con tipo) y barones;
  - K/D/A, CS y vida de cada jugador.
- Pulsar *Partidos* estando en un partido es lo mismo que *Volver a partidos*. Al irse a otra sección, se vuelve al
  partido con atrás del navegador.
- Si el partido ha terminado, no se piden cuotas.

## Direcciones y atrás del navegador (los cinco deportes)

Cada pantalla tiene su dirección, así que atrás y adelante del navegador funcionan, recargar no saca del partido y los
enlaces se pueden compartir. nginx (`try_files $uri /index.html`) y Vite devuelven la app para cualquier camino.

| Dirección | Pantalla |
|---|---|
| `/` | La lista del deporte guardado (se sustituye por su dirección, sin entrada nueva) |
| `/lol`, `/baloncesto`, `/tenis`, `/futbol`, `/mma` | Partidos; `?dia=AAAA-MM-DD` si no es hoy |
| `/<deporte>/partido/<id>?dia=…` | Ficha del partido; el día es el de su lista, para encontrarlo al entrar por un enlace |
| `/<deporte>/jugadores` (`/futbol/clasificacion`, `/mma/luchadores`), `/<deporte>/apuestas` | Segunda sección y Mis apuestas; LoL lleva el equipo en `?equipo=` |
| `/amigos`, `/cuenta`, `/ajustes`, `/aviso-legal`, `/privacidad`, `/cookies` | Sin deporte |

- `src/lib/route.ts`: dirección ⇄ pantalla, sin efectos (pruebas en `route.test.ts`).
- `src/lib/history.ts`: el único que toca `window.history`. Junta en una entrada lo pedido en un mismo clic (el buscador
  cambia de deporte, de día y abre el partido); *Volver a partidos* es un atrás si se vino de la lista y, si no (enlace),
  sustituye la entrada.
- Las vistas leen el partido abierto con `useRouteMatch(deporte)` y el día con `useRouteDay()`, y abren con `openGame` /
  `closeMatch` del contexto. Si un partido de la dirección no está en la lista de su día ya cargada, `useLostMatch`
  vuelve a la lista.
- **Capas**: fichas de jugador, equipo y luchador, el chat del móvil, las ventanas (`Dialog`), la pantalla de entrar y el
  cupón desplegado del móvil se cierran con atrás gracias a `useBackLayer(abierta, cerrar)`. Apilan una entrada con la
  misma dirección. Si una se cierra de otra forma (su botón, Escape), su entrada queda vacía y atrás se la salta.
