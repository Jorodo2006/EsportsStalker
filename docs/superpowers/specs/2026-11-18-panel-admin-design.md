# Panel de administración — diseño

Fecha: 2026-11-18 · Estado: pendiente de aprobación por Jordi

## Intención

Hoy el administrador no puede ver cómo va la app. Gestionar una cuenta (cambiar una contraseña, dar el rol) exige SQL o un script por
terminal, y los fallos del lector de cuotas solo se descubren cuando alguien se fija en un precio raro (el 18-11 se leyó el evento
de Utah–Clippers como si fuera el de Utah–Lakers y nadie lo vio durante horas). El panel da al administrador un sitio para **vigilar lo
que se rompe** (lecturas de cuotas, fuentes, servicios, acierto del modelo) y **gestionar cuentas** sin tocar la base de datos.

## Objetivos

- Pantalla nueva **Administración**, sólo para administradores, separada de *Ajustes* (que sigue siendo configuración de la app).
- Seis secciones, entregadas por fases (cada una se puede usar sola):
  1. **Usuarios**: lista y acciones sobre la cuenta.
  2. **Lecturas de cuotas**: salud por casa y deporte, errores frecuentes, partidos sin cuotas, lecturas sospechosas, relanzar.
  3. **Servicios y fuentes**: qué contenedor o fuente externa falla y desde cuándo.
  4. **Resumen**: la portada de la pantalla.
  5. **Acierto del modelo**: acierto y calibración por deporte y mercado.
  6. **Registro de actividad**: lo que hace cada administrador, altas y accesos fallidos.
- Todo funciona desde el móvil (375 px) y desde el escritorio.

## No objetivos

- **Ver o editar las apuestas, el dinero, los mensajes o los amigos de otros usuarios.** Sólo se ve *cuántas* apuestas tiene cada uno.
- Roles intermedios (moderador, solo lectura): hay administrador o no.
- Cambiar los ajustes comunes de la app: sigue en *Ajustes*.
- Enviar avisos o correos a los usuarios.
- Rechazar en el servidor las lecturas de Betway de otro partido (como hace Winamax con `isOtherMatch`). El panel las **detecta**; el
  rechazo es otro cambio, aparte.

## Anti-objetivos (aunque funcione, sería un fracaso)

- Que el administrador pueda leer datos privados de otro usuario por una ruta nueva.
- Que una ruta `/api/admin/*` quede abierta a un usuario normal o sin sesión.
- Que el administrador se quede sin administradores (quitarse el rol, suspenderse o borrarse siendo el último).
- Que el panel tumbe o ralentice el resto de la app (consultas pesadas sin límite).

## Restricciones del proyecto

- Cada servicio sólo toca su esquema (regla 6): usuarios, registro y acierto en `bets`; lecturas y fuentes en `odds`. Lo que junta
  varios servicios (el resumen) lo junta la interfaz con peticiones en paralelo, no una consulta que cruce esquemas.
- Una ruta nueva tiene que estar cerrada en `server/test/publico.test.js` (regla 7).
- Migraciones nuevas, nunca editar las aplicadas: la siguiente de `bets` es la `018`.
- Interfaz y comentarios en español; estilo sobrio de `ui.tsx` y `viz.tsx`; `Tabs`, `Card`, `PageHeader` y `recharts` (ya está en el proyecto).
- Pruebas sin base de datos: la lógica se escribe como funciones puras con su `*.test.js`.
- Sin `git commit` ni `git push` sin que Jordi lo pida (regla 8).

## Cómo se construye (opción elegida por Jordi)

**Rutas `/api/admin/...` en el servicio dueño de cada dato, y una vista `AdminView` con pestañas.** Alternativas descartadas: un servicio
nuevo `admin` (un contenedor más y una capa por cada dato) y tarjetas dentro de *Ajustes* (mezcla configuración con gestión de personas;
`SettingsView` ya tiene 252 líneas).

### Piezas

**Gateway** (`server/services/gateway/`)
- `ROUTES`: `/api/admin/odds/*` → `odds` (antes) y el resto de `/api/admin/*` → `bets`.
- Todo `/api/admin/*` exige sesión **y** administrador en el gateway (403 si no lo es). Función pura `isAdminPath(pathname)` en
  `public.js`, probada en `publico.test.js`.
- Cada servicio comprueba otra vez la firma y el rol (`internal.verify` + `x-user-admin`): `odds` hoy no lo hace, hay que añadirlo para
  sus rutas admin.

**`bets`** — migración `018_admin.sql`
- `bets.users`: `suspended_at timestamptz`, `last_seen_at timestamptz`.
- `bets.admin_log` (`id, at, admin_id, admin_name, action, target_id, target_name, detail jsonb`): cada acción del administrador se
  escribe en la misma transacción que el cambio.
- `bets.auth_events` (`id, at, kind, user_id, username, ip`; `kind`: `login_ok`, `login_fail`, `register`, `register_blocked`).
- `auth.js`: el login rechaza a un suspendido con «Cuenta suspendida», pero sólo después de comprobar la contraseña (con una incorrecta
  sigue saliendo «Usuario o contraseña incorrectos», para no revelar qué cuentas existen); `userOf`
  devuelve `null` si está suspendido; `last_seen_at` se actualiza como mucho cada 5 min por usuario (no en cada petición).
- Rutas:
  - `GET /api/admin/users` (lista con rol, alta, último acceso, suspendido, nº de apuestas, tiene contraseña / Google).
  - `PATCH /api/admin/users/:id` (`username`, `isAdmin`, `suspended`).
  - `POST /api/admin/users/:id/password` (el administrador pone una contraseña temporal).
  - `POST /api/admin/users/:id/sessions/close`.
  - `DELETE /api/admin/users/:id` (confirmando el nombre).
  - `GET /api/admin/log`, `GET /api/admin/auth-events`.
  - `GET /api/admin/model` (acierto y calibración).
  - `GET /api/admin/summary/users` (totales para el resumen).
- Reglas de negocio en `server/services/bets/admin-rules.js` (funciones puras): nunca queda un sitio sin administrador; no te puedes
  quitar el rol, suspenderte ni borrarte a ti mismo; el nombre sigue la misma regla que el registro (3–30, `[\p{L}\p{N}_.-]`, único
  sin distinguir mayúsculas); la contraseña sigue `validPassword`; sólo se borra una cuenta ya suspendida.
- El conteo de apuestas por usuario es una lectura de `bets.bets` de todos los usuarios: se documenta en AGENTS.md junto a las otras
  excepciones, sólo devuelve un número por usuario y no admite columnas.

**`odds`** (sin migración: lee `odds.jobs`, `odds.imports`, `odds.matches`, `odds.book_urls`)
- `GET /api/admin/odds/health?hours=24|168`: por casa y deporte, lecturas, ok, error y %; los mensajes de error más repetidos
  (normalizados: «No encuentro el partido en Betway…» cuenta como uno).
- `GET /api/admin/odds/missing`: partidos que empiezan en menos de 48 h y no tienen lecturas vigentes de alguna casa, con lo que dijo
  esa casa en la última lectura.
- `GET /api/admin/odds/suspect`: lecturas sospechosas. Criterio robusto y barato: **el mismo evento de Betway (número de `event/NNN`
  de la página) asignado a dos partidos distintos** (`odds.imports` y `odds.book_urls`). Habría detectado el caso de Utah–Clippers.
- Relanzar una lectura reutiliza `POST /api/odds/jobs` (la que ya usa la app); el panel sólo añade el botón y el registro en `admin_log`.
- `GET /api/admin/odds/summary`: lo de `scheduler.status()` y un total de 24 h para el resumen.

**Servicios y fuentes** (fase 3)
- Servicios: lo que ya devuelve `/api/health` del gateway, con más detalle (qué contenedor y desde cuándo falla, guardando el último
  estado en memoria del gateway).
- Fuentes externas (ESPN, Leaguepedia, LiveScore, WOW, Challenger): última respuesta correcta y último error de cada una. Si no hay un
  punto común de peticiones salientes donde medirlo sin tocar muchos ficheros, la fase empieza reutilizando *Probar conexiones* de
  *Ajustes* y deja el seguimiento continuo como mejora.

**Interfaz** (`src/`)
- `View` gana `admin`; `AdminView.tsx` con `Tabs` (Resumen · Usuarios · Lecturas · Servicios · Modelo · Actividad); cada pestaña en su
  fichero dentro de `src/views/admin/`.
- Entrada: botón *Administración* junto a *Ajustes* en el menú lateral y una tarjeta en *Tu cuenta* (así llega también el móvil). Mismo
  control que *Ajustes*: sólo si `me.isAdmin`.
- `window.api.admin.*` en `types.ts` y `api.ts`; consultas con TanStack Query, sin sondeo cada minuto (se refrescan al abrir y con un botón).
- Usuarios: tabla en escritorio y tarjetas en móvil (como `BetCard`). Confirmación escrita para borrar. Acciones peligrosas con `Dialog`.
- Aviso de privacidad: el panel enseña que los administradores ven lo que se guarda de cada cuenta (nombre, rol, altas, accesos).

### Datos personales

Las IP de los accesos son datos personales. Se guardan 90 días (limpieza diaria) y se dice en `LegalView` (privacidad), que es donde hay
que reflejar cualquier dato nuevo que se guarda.

## Fases

1. **Base + Usuarios:** migración 018, `admin-rules`, rutas de usuarios y de registro, protección en el gateway, `AdminView` con las
   pestañas Usuarios y Actividad, texto de privacidad.
2. **Lecturas de cuotas:** rutas `odds` de salud, partidos sin cuotas y lecturas sospechosas; pestaña, botón de relanzar.
3. **Servicios y fuentes + Resumen.**
4. **Acierto del modelo.**

Cada fase termina con `npm run typecheck` y `npm test` sin errores y probando la pantalla con `npm run dev`.

## Decisiones mías (a revisar)

- Sólo se muestra el **número** de apuestas por usuario, no su contenido (por la regla de privacidad del proyecto).
- **Borrar exige suspender antes**, confirmando el nombre; es el único camino que arrastra apuestas, amigos y mensajes.
- La contraseña de otro usuario no se puede *ver*; el administrador pone una temporal, y esto cierra todas sus sesiones.
- `last_seen_at` se actualiza como mucho cada 5 min.
- Retención de IP: 90 días.
- La detección de lecturas sospechosas empieza por «mismo evento en dos partidos»; heurísticas por nombres de equipo quedan para después.

## Lo que queda al criterio de quien construya

Nombres exactos de columnas y rutas, el diseño visual de cada pestaña dentro del estilo del proyecto, qué gráficos de `recharts` usar
para la calibración, y cuántas filas pagina cada lista.
