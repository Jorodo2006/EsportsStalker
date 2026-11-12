# Statex

Web con login, para el ordenador y el móvil, y un backend en Docker para seguir LoL, baloncesto, tenis y fútbol:

- **Partidos**: en directo, calendario y resultados de todas las ligas (LEC, LCK, LPL, LTA, Worlds, MSI…), con la cuota de ganador en cada tarjeta.
- **Cuotas dentro de cada partido**: el botón **Actualizar cuotas** las trae solas de Winamax y Betway con el lector de Docker (o las envías tú con el marcador), comparadas entre casas (incluidas las líneas de kills, asistencias y muertes de cada jugador), con la mejor cuota resaltada y la probabilidad sin margen. Pulsando una cuota se abre la apuesta ya rellena.
- **Cuotas automáticas**: el lector de Docker lee solo los partidos de las próximas 48 horas, más seguido cuanto más cerca están (configurable en **Ajustes**). Se guarda el histórico de cada cuota.
- **Partida en vivo**: oro, kills, torres, dragones, barones y el K/D/A, CS y vida de cada jugador, refrescado cada 10 s.
- **Jugadores y equipos**: últimas partidas profesionales, % de victorias, KDA, CS, oro, daño, campeones más jugados, plantilla y racha del equipo.
- **Apuestas**: registro de apuestas simples y **combinadas** (boleto con clic derecho en las cuotas) con beneficio total, ROI/yield, % de acierto, cuota media, banca actual, gráfica de evolución y desglose por casa y por liga. Exporta a CSV (se abre en Excel) e importa CSV o JSON.

Documentación para desarrollo: [`AGENTS.md`](AGENTS.md) y las especificaciones en [`docs/specs/`](docs/specs/).

## Tecnología

- Interfaz: **React 19 + TypeScript + Vite + Tailwind CSS 4**, con TanStack Query para los datos en directo y Recharts para las gráficas.
- Backend: microservicios Node (gateway, apuestas, esports, baloncesto, tenis y cuotas) con **PostgreSQL 17** y un Chromium sin cabeza que lee las cuotas, todo en Docker Compose junto con la web.

## Requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) encendido.
- [Node.js](https://nodejs.org) 20 o superior (incluye `npm`), para los comandos y para desarrollar.

## Credenciales (.env)

Copia `.env.example` como `.env` en esta carpeta y rellena lo que uses (por ejemplo la *bot password* de Leaguepedia).
El `.env` no se sube a git, lo lee Docker Compose y manda sobre lo que pongas en **Ajustes**. Si lo cambias, vuelve a ejecutar `npm run backend`.

## Ejecutar

Abre una terminal en esta carpeta y:

```bash
npm run backend  # arranca la web, la base de datos y los servicios en Docker (déjalo encendido)
```

Y abre `http://127.0.0.1:8090`. **La primera cuenta que se crea es la de administrador** y se queda con las apuestas que ya hubiera.

Desde el móvil, con la misma wifi que el equipo: `http://<IP del equipo>:8090` (la IP sale con `ipconfig`). Si no carga, Windows puede pedir que permitas el puerto 8090 en el firewall. Va por HTTP, así que úsala sólo en una red de confianza; para cerrarla a la red, pon `WEB_BIND=127.0.0.1` en el `.env`.

Si se olvida una contraseña: `docker compose exec bets node services/bets/reset-password.js <usuario> <nueva>`.

Para desarrollar:

```bash
npm install
npm run dev      # http://127.0.0.1:5173: los cambios en src/ se ven al instante
```

`npm run backend:logs` enseña los registros del backend y `npm run backend:stop` lo para (los datos se conservan).

## Fuentes de datos (todas gratis)

| Qué | Fuente | Notas |
|---|---|---|
| Calendario, resultados, directo | API de lolesports.com (`esports-api.lolesports.com`, `feed.lolesports.com`) | No oficial: es la que usa la propia web. La clave pública ya viene puesta. Las stats en vivo van ~1 min por detrás. |
| Stats de jugadores y equipos | Leaguepedia (`lol.fandom.com`, API Cargo) | Sin clave. Limita mucho las peticiones: la app las hace de una en una, reintenta si la frenan y guarda los resultados 6 h en disco. Los equipos se buscan por su nombre completo ("G2 Esports", "T1"). |
| Cuotas | Winamax y Betway, leídas de sus páginas por el contenedor `lector` | Sin APIs de cuotas. Si una casa bloquea al lector, queda de reserva el marcador **LoL Tracker** de **Ajustes → Marcador de cuotas**, que las lee desde tu Chrome. |
| Extensión de Chrome (reserva) | `chrome/extension/`, `npm run extension` la prepara en `extension-chrome/` | Se carga una vez en `chrome://extensions` → **Cargar descomprimida**. Ya no hace falta: hace lo mismo que el lector de Docker, pero en tu Chrome. |

Si lolesports o Leaguepedia fallan, en **Ajustes → Probar conexiones** verás cuál. Cada vez que usas el marcador se guarda `capturas/captura-<casa>-marcador.json` con una foto de la página, útil para ajustar el lector si una casa cambia su web.

## Dónde se guardan tus datos

Apuestas, ajustes, cuotas e histórico están en PostgreSQL, dentro del volumen de Docker `pgdata` (sobrevive a
`npm run backend:stop` y a reinicios; sólo se borra con `docker compose down -v`).

Haz una copia con **Apuestas → Exportar** de vez en cuando.

## Estructura

```
docker-compose.yml       web + PostgreSQL + gateway + servicios
web/                     imagen de la web: compila con Vite y sirve con nginx
server/
  shared/                conexión a la base de datos, migraciones, servidor HTTP, llamadas entre servicios
  services/gateway/      única puerta (127.0.0.1:47365) y avisos en vivo
  services/bets/         apuestas y ajustes
  services/esports/      lolesports y Leaguepedia
  services/odds/         cuotas del marcador y la extensión, lecturas programadas, histórico
chrome/
  extension/, bookmarklet/  extensión de Chrome y marcador (el lector de Docker usa el mismo marcador)
src/
  App.tsx                layout y navegación
  views/                 Partidos, detalle (cuotas + en vivo), Jugadores, Apuestas, Ajustes
  components/            componentes de interfaz y formulario de apuesta
  lib/                   cliente del backend, tipos, formato y estado global
```

Aviso: apuesta con cabeza. Esta app solo te ayuda a llevar el control.
