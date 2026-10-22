# LoL Esports Tracker

App de escritorio (Windows y Linux) para seguir los esports de League of Legends:

- **Partidos**: en directo, calendario y resultados de todas las ligas (LEC, LCK, LPL, LTA, Worlds, MSI…), con la cuota de ganador en cada tarjeta.
- **Cuotas dentro de cada partido**: el botón **Actualizar cuotas** las trae solas de Bet365, Winamax y Betway con la extensión de Chrome (o las envías tú con el marcador), comparadas entre casas (incluidas las líneas de kills, asistencias y muertes de cada jugador), con la mejor cuota resaltada y la probabilidad sin margen. Pulsando una cuota se abre la apuesta ya rellena.
- **Partida en vivo**: oro, kills, torres, dragones, barones y el K/D/A, CS y vida de cada jugador, refrescado cada 10 s.
- **Jugadores y equipos**: últimas partidas profesionales, % de victorias, KDA, CS, oro, daño, campeones más jugados, plantilla y racha del equipo.
- **Apuestas**: registro de apuestas simples y **combinadas** (boleto con clic derecho en las cuotas) con beneficio total, ROI/yield, % de acierto, cuota media, banca actual, gráfica de evolución y desglose por casa y por liga. Exporta/importa CSV o JSON (el CSV se abre en Excel).

Documentación para desarrollo: [`AGENTS.md`](AGENTS.md) y las especificaciones en [`docs/specs/`](docs/specs/).

## Tecnología

Electron + **React 19 + TypeScript + Vite + Tailwind CSS 4**, con TanStack Query para los datos en directo y Recharts para las gráficas.

## Requisitos

- [Node.js](https://nodejs.org) 20 o superior (incluye `npm`).

## Credenciales (.env)

Copia `.env.example` como `.env` en esta carpeta y rellena lo que uses (por ejemplo la *bot password* de Leaguepedia).
El `.env` no se sube a git y manda sobre lo que pongas en **Ajustes**.

## Ejecutar

Abre una terminal en esta carpeta y:

```bash
npm install
npm run dev      # modo desarrollo: los cambios en src/ se ven al instante
npm start        # compila y abre la app como en producción
```

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
| Cuotas | Bet365, Winamax y Betway, leídas en tu Chrome con el marcador **LoL Tracker** | Sin APIs de cuotas. Instálalo desde **Ajustes → Marcador de cuotas**. Abre el partido en la casa, pulsa el marcador y las cuotas llegan a la app (servidor local en `127.0.0.1:47365`). |
| Cuotas automáticas | Extensión de Chrome (`electron/extension/`, la app la copia a `extension-chrome/`) | Se carga una vez en `chrome://extensions` → **Cargar descomprimida**. El botón **Actualizar cuotas** abre una página de la app en Chrome; la extensión abre las casas en pestañas de fondo, busca el partido, lo lee con el mismo lector del marcador y cierra las pestañas. Las direcciones de cada partido se recuerdan en `casas-urls.json`. |

Si lolesports o Leaguepedia fallan, en **Ajustes → Probar conexiones** verás cuál. Cada vez que usas el marcador se guarda `captura-<casa>-marcador.json` con una foto de la página, útil para ajustar el lector si una casa cambia su web.

## Dónde se guardan tus datos

Las apuestas y ajustes están en un `data.json` local:

- Windows: `%APPDATA%\LoL Esports Tracker\data.json`
- Linux: `~/.config/LoL Esports Tracker/data.json`

Haz una copia con **Apuestas → Exportar** de vez en cuando.

## Estructura

```
electron/
  main.js                proceso principal (ventana + peticiones a internet)
  preload.js             puente seguro entre la interfaz y main.js
  services/              lolesports, leaguepedia, cuotas y guardado local
src/
  App.tsx                layout y navegación
  views/                 Partidos, detalle (cuotas + en vivo), Jugadores, Apuestas, Ajustes
  components/            componentes de interfaz y formulario de apuesta
  lib/                   tipos, formato y estado global
```

Aviso: apuesta con cabeza. Esta app solo te ayuda a llevar el control.
