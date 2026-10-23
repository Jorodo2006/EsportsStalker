# 04 · Estadísticas de jugadores y equipos

Fuente: **Leaguepedia** (`https://lol.fandom.com/api.php`, API *Cargo*). Es gratis y no necesita clave.
Código: `server/services/esports/leaguepedia.js` (servicio `esports`; caché en `esports.cache`), `src/views/PlayersView.tsx`, `src/components/SearchBox.tsx`.

## Límite de peticiones

- Fandom limita mucho a los usuarios anónimos. Por eso las peticiones van en una cola, de una en una y con al menos
  3 s entre ellas (`GAP`). Si llega un aviso de límite, se reintenta una sola vez y luego se da un error claro.
- Los resultados se guardan 6 h en disco (`TTL`), para que sobrevivan a los reinicios.
- Una *bot password* de Fandom es opcional (se pone en Ajustes) y sube el límite. Se inicia sesión con
  `action=login` y se guardan las cookies.

## Consultas

| Función | Tablas | Uso |
|---|---|---|
| `searchPlayers(q)` | Players | Sugerencias y búsqueda de jugadores |
| `searchTeams(q)` | Teams | Sugerencias de equipos |
| `resolveTeam(name, code)` | Teams | Convierte el nombre de lolesports en la página de Leaguepedia (ver abajo). Cacheado en memoria |
| `playerGames(page)` | ScoreboardPlayers + ScoreboardGames | Últimas partidas profesionales del jugador |
| `teamGames(team)` | ScoreboardGames | Últimas partidas del equipo, % de victorias y racha |
| `teamRoster(team)` | Players | Plantilla |

`resolveTeam` prueba en este orden, y para en la primera que encuentra:

1. el nombre o la página exactos;
2. el nombre sin "Esports" ni "Gaming";
3. `Short` igual al código (GEN, IG…);
4. una búsqueda `LIKE`.

Así funciona *Stats GEN* aunque lolesports diga "Gen.G Esports" y Leaguepedia "Gen.G".

## Interfaz

- `SearchBox` es un buscador único para jugadores y equipos. Va sugiriendo mientras escribes:
  - primero las búsquedas recientes;
  - luego los equipos del calendario ya cargado;
  - después, con un pequeño retraso, jugadores y equipos de Leaguepedia.
- **Ficha de jugador**: KDA, CS, oro, daño, % de victorias y campeones más jugados.
- **Ficha de equipo**: últimas partidas, racha y plantilla.
- Desde el partido, *Stats EQUIPO* abre esta vista con `nombre|código`. `TeamLoader` resuelve el nombre y, si
  `resolveTeam` no está disponible, usa el nombre tal cual.
