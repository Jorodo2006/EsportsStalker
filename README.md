# LoL Esports Tracker

App de escritorio (Windows y Linux) con un backend en Docker para seguir los esports de League of Legends:

- **Partidos**: en directo, calendario y resultados de todas las ligas (LEC, LCK, LPL, LTA, Worlds, MSI…), con la cuota de ganador en cada tarjeta.
- **Cuotas dentro de cada partido**: el botón **Actualizar cuotas** las trae solas de Bet365, Winamax y Betway con la extensión de Chrome (o las envías tú con el marcador), comparadas entre casas (incluidas las líneas de kills, asistencias y muertes de cada jugador), con la mejor cuota resaltada y la probabilidad sin margen. Pulsando una cuota se abre la apuesta ya rellena.
- **Cuotas automáticas**: cada 5 minutos (configurable) se vuelven a leer los partidos que empiezan en las próximas 6 horas, con Chrome abierto y la extensión cargada. Se guarda el histórico de cada cuota.
- **Partida en vivo**: oro, kills, torres, dragones, barones y el K/D/A, CS y vida de cada jugador, refrescado cada 10 s.
- **Jugadores y equipos**: últimas partidas profesionales, % de victorias, KDA, CS, oro, daño, campeones más jugados, plantilla y racha del equipo.
- **Apuestas**: registro de apuestas simples y **combinadas** (boleto con clic derecho en las cuotas) con beneficio total, ROI/yield, % de acierto, cuota media, banca actual, gráfica de evolución y desglose por casa y por liga. Exporta/importa CSV o JSON (el CSV se abre en Excel).

Documentación para desarrollo: [`AGENTS.md`](AGENTS.md) y las especificaciones en [`docs/specs/`](docs/specs/).

## Tecnología

- Interfaz: Electron + **React 19 + TypeScript + Vite + Tailwind CSS 4**, con TanStack Query para los datos en directo y Recharts para las gráficas.
- Backend: microservicios Node (gateway, apuestas, esports y cuotas) con **PostgreSQL 17**, todo en Docker Compose.

## Requisitos

- [Node.js](https://nodejs.org) 20 o superior (incluye `npm`).
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) encendido (para el backend).

## Credenciales (.env)

Copia `.env.example` como `.env` en esta carpeta y rellena lo que uses (por ejemplo la *bot password* de Leaguepedia).
El `.env` no se sube a git, lo lee Docker Compose y manda sobre lo que pongas en **Ajustes**. Si lo cambias, vuelve a ejecutar `npm run backend`.

## Ejecutar

Abre una terminal en esta carpeta y:

```bash
npm install
npm run backend  # arranca la base de datos y los servicios en Docker (déjalo encendido)
npm run dev      # modo desarrollo: los cambios en src/ se ven al instante
npm start        # compila y abre la app como en producción
```

`npm run backend:logs` enseña los registros del backend y `npm run backend:stop` lo para (los datos se conservan).

## Crear el instalador

```bash
npm run dist:win     # en Windows → release/  (instalador .exe y versión portable)
npm run dist:linux   # en Linux   → release/  (AppImage)
```

Cada instalador se genera en su propio sistema operativo (el de Windows en Windows, el de Linux en Linux).

## Fuentes de datos (todas gratis)

| Qué | Fuente | Notas |
|---|---|---|
| Calendario, resultados, directo | API de lolesports.com (`esports-api.lolesports.com`, `feed.lolesports.com`) | No oficial: es la que usa la propia web. La clave pública ya viene puesta. Las stats en vivo van ~1 min por detrás. |
| Stats de jugadores y equipos | Leaguepedia (`lol.fandom.com`, API Cargo) | Sin clave. Limita mucho las peticiones: la app las hace de una en una, reintenta si la frenan y guarda los resultados 6 h en disco. Los equipos se buscan por su nombre completo ("G2 Esports", "T1"). |
| Cuotas | Bet365, Winamax y Betway, leídas en tu Chrome con el marcador **LoL Tracker** | Sin APIs de cuotas. Instálalo desde **Ajustes → Marcador de cuotas**. Abre el partido en la casa, pulsa el marcador y las cuotas llegan a la app (gateway del backend en `127.0.0.1:47365`). |
| Cuotas automáticas | Extensión de Chrome (`electron/extension/`, la app la copia a `extension-chrome/`) | Se carga una vez en `chrome://extensions` → **Cargar descomprimida**. El botón **Actualizar cuotas** abre una página de la app en Chrome; además, cada 30 s la extensión pregunta al backend si hay lecturas programadas. Abre las casas en pestañas de fondo, busca el partido, lo lee con el mismo lector del marcador y cierra las pestañas. Las direcciones de cada partido se recuerdan en la base de datos. |

Si lolesports o Leaguepedia fallan, en **Ajustes → Probar conexiones** verás cuál. Cada vez que usas el marcador se guarda `capturas/captura-<casa>-marcador.json` con una foto de la página, útil para ajustar el lector si una casa cambia su web.

## Dónde se guardan tus datos

Apuestas, ajustes, cuotas e histórico están en PostgreSQL, dentro del volumen de Docker `pgdata` (sobrevive a
`npm run backend:stop` y a reinicios; sólo se borra con `docker compose down -v`).

Si venías de una versión anterior, la primera vez que abras la app con el backend encendido se importa tu
`data.json` (`%APPDATA%\LoL Esports Tracker\` en Windows, `~/.config/LoL Esports Tracker/` en Linux) y se renombra a
`data.json.migrado-AAAA-MM-DD`.

Haz una copia con **Apuestas → Exportar** de vez en cuando.

## Estructura

```
docker-compose.yml       PostgreSQL + gateway + servicios
server/
  shared/                conexión a la base de datos, migraciones, servidor HTTP, llamadas entre servicios
  services/gateway/      única puerta (127.0.0.1:47365) y avisos en vivo
  services/bets/         apuestas y ajustes
  services/esports/      lolesports y Leaguepedia
  services/odds/         cuotas del marcador y la extensión, lecturas programadas, histórico
electron/
  main.js                proceso principal (ventana + reenvío al backend)
  preload.js             puente seguro entre la interfaz y main.js
  services/              cliente del backend y generador de la extensión
  extension/, bookmarklet/  extensión de Chrome y marcador
src/
  App.tsx                layout y navegación
  views/                 Partidos, detalle (cuotas + en vivo), Jugadores, Apuestas, Ajustes
  components/            componentes de interfaz y formulario de apuesta
  lib/                   tipos, formato y estado global
```

Aviso: apuesta con cabeza. Esta app solo te ayuda a llevar el control.
