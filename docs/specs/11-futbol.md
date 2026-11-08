# 11 · Fútbol

Cuarta app, con el acento azul (`data-app="football"`). Como baloncesto y tenis: partidos por día con el directo, la ficha
de cada partido y el registro de apuestas (`sport = 'football'`, migración `bets/007_futbol.sql`).

## Datos: ESPN

El servicio `football` (`server/services/football/index.js`, puerto 4006, esquema `football`) lee la API pública de ESPN,
gratuita y sin clave, la misma que usan la NBA y el tenis.

| Competición | Id de la app | Id de ESPN |
|---|---|---|
| LaLiga | `laliga` | `esp.1` |
| Champions League | `champions` | `uefa.champions` |
| Premier League | `premier` | `eng.1` |
| Serie A | `seriea` | `ita.1` |
| Bundesliga | `bundesliga` | `ger.1` |
| Ligue 1 | `ligue1` | `fra.1` |
| Europa League | `europa` | `uefa.europa` |
| Conference League | `conference` | `uefa.europa.conf` |
| Segunda División | `segunda` | `esp.2` |
| Copa del Rey | `copa` | `esp.copa_del_rey` |

El orden de la tabla es el de la lista de partidos. Para añadir una liga basta con una fila en `LEAGUES` (servicio), en
`FootballLeagueId` (`src/lib/types.ts`) y, si tiene tabla, en `src/views/FootballStandings.tsx`.

- **Marcadores**: `scoreboard?dates=AAAAMMDD` da un día; `dates=AAAAMM`, el mes entero de una liga en una sola
  petición. Cerca de hoy (de ayer a mañana) se pide cada día con 30 s de caché, para el directo; lejos, el mes (15 min,
  o 6 h si ya pasó). Así la tira de días cuesta 10 peticiones y no 80. Un rango `AAAAMMDD-AAAAMMDD` devuelve 400.
- **Días en hora de España**: como en baloncesto y tenis, se pide también el día anterior de ESPN y se filtra por el día
  de Madrid.
- **Ficha** (`summary?event=`): `keyEvents` (goles con asistencia, penaltis, en propia, tarjetas y cambios con quién sale),
  `boxscore` (posesión, tiros, córners, faltas, tarjetas, pases…), `rosters` (formación, once, banquillo, cambios),
  `lastFiveGames` y `headToHeadGames`. ESPN da el marcador de los partidos anteriores sin decir de quién es cada número: se
  ordena según el resultado (G, E o P) para que vayan primero los goles del equipo.
- **Clasificaciones** (`/apis/v2/sports/soccer/<liga>/standings`): con las zonas (Champions, descenso…) y su color. Las
  competiciones europeas tienen una sola tabla, la fase de liga; la Copa no tiene.
- **Colores de los equipos**: ESPN los da en cada partido; la interfaz los pasa por `teamTheme` (`src/lib/team-colors.ts`),
  igual que los de baloncesto, para teñir cada mitad del marcador grande y las barras de estadísticas.
- **Cuotas de ESPN**: la ficha trae cuotas de casas americanas. No se usan: las cuotas sólo salen del lector (regla 1).

## Rutas

| Ruta | Qué devuelve |
|---|---|
| `GET /api/football/leagues` | Las competiciones con su escudo |
| `GET /api/football/games?date=` | Partidos de un día de España |
| `GET /api/football/days?from=&n=` | Partidos y en juego por día, para la tira |
| `GET /api/football/live` | Partidos en juego |
| `GET /api/football/match?id=<liga>:<evento>` | Ficha del partido |
| `GET /api/football/standings/:league` | Clasificación (grupos y filas) |

## Interfaz

- `src/views/FootballMatches.tsx`: lista (en juego arriba, el resto por competición) y ficha del partido con el marcador
  grande, los goleadores y las rojas debajo, y las pestañas Resumen, Estadísticas, Alineaciones, Forma (últimos cinco y
  cara a cara) y Clasificación. Antes de empezar se abre en Forma. La ficha se carga por su id, así que también abre los
  partidos de otro día que llegan desde la columna de directo.
- `src/views/FootballStandings.tsx`: la segunda sección de la app ("Clasificación" en vez de "Jugadores").
- `src/components/football.tsx`: el balón del selector, `themeOf`, `esTime` y la tabla de clasificación.

## Pendiente

1. **Cuotas de Winamax y Betway**: el lector (1X2, doble oportunidad, total de goles, ambos marcan, hándicap), el
   comparador en la ficha, el cupón y las lecturas programadas en `scheduler.js`.
2. **Modelo y recomendaciones**: goles esperados con la fuerza de ataque y defensa de cada equipo, comprobado con partidos
   pasados (como `backtest.js` en tenis) antes de enseñar nada.
