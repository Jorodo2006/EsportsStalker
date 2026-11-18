# Panel de administración, fase 1 (base, Usuarios y Actividad) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el administrador gestione cuentas (renombrar, rol, suspender, contraseña temporal, cerrar sesiones, borrar) y vea el registro de actividad desde una pantalla nueva *Administración*.

**Architecture:** Rutas `/api/admin/*` en el servicio `bets` (dueño de usuarios), repartidas por el gateway, que exige sesión y administrador; `bets` lo vuelve a comprobar. Las reglas de negocio van en funciones puras (`admin-rules.js`) probadas sin base de datos; la interfaz es una vista `AdminView` con pestañas.

**Tech Stack:** Node (CommonJS, `node:http`, `pg`), PostgreSQL, React 19 + TypeScript + Tailwind 4 + TanStack Query. Pruebas con `node:test` y Vitest.

**Spec:** [docs/superpowers/specs/2026-11-18-panel-admin-design.md](../specs/2026-11-18-panel-admin-design.md). Esta es la fase 1 de 4; lecturas de cuotas, servicios y resumen, y acierto del modelo tendrán su plan.

## Global Constraints

- Cada servicio sólo toca su esquema (regla 6): todo esto es del esquema `bets`.
- Toda ruta `/api/admin/*` cerrada en `server/test/publico.test.js` (regla 7); sin `git commit` ni `git push` sin que Jordi lo pida en ese momento (regla 8).
- Migración nueva `server/services/bets/migrations/018_admin.sql`; nunca editar una aplicada.
- Nombre de usuario: 3 a 30 caracteres de `[\p{L}\p{N}_.-]`, único sin distinguir mayúsculas. Contraseña: `validPassword` de `auth.js` (8 a 200 caracteres).
- `last_seen_at` se actualiza como mucho cada 5 minutos por usuario. Las IP de `bets.auth_events` se guardan 90 días.
- Interfaz y comentarios en español; estilo sobrio de `ui.tsx` (`Card`, `PageHeader`, `Tabs`, `Dialog`, `Field`, `Input`, `Button`, `Badge`, `Empty`, `Loading`, `th`/`td`); todo cabe en 375 px sin scroll lateral; tablas anchas con versión en tarjetas en móvil.
- Backend CommonJS sin framework; comentarios cortos que expliquen el porqué. TypeScript estricto sin imports ni variables sin usar.
- Una pantalla nueva abre con `<SheetScroll />` sólo si es una ficha; aquí no hace falta.

## Review Focus

Entradas y condiciones que el diseño implica y que ninguna tarea probaría por sí sola. Cada una tiene su prueba en la tarea indicada:

1. **El último administrador activo** (se quita el rol, se suspende o dos administradores se quitan el rol a la vez) → nunca queda cero. Tarea 1 (reglas) y tarea 4 (candado dentro de la transacción).
2. **Un suspendido con sesión abierta o que entra con Google** → la sesión deja de valer y no se abre otra. Tarea 2.
3. **Un usuario normal o sin sesión llamando a `/api/admin/*`** → 403 y 401, y no puede falsificarlo con `x-user-admin`. Tarea 3.
4. **Secretos en los registros**: una contraseña en `detail` del registro, y lo escrito por error en el campo de usuario al fallar un acceso → no se guardan. Tareas 1 y 2.
5. **Borrar**: nombre de confirmación distinto, cuenta no suspendida o la propia → se rechaza sin tocar nada. Tareas 1 y 4.

---

### Task 1: Migración 018 y reglas puras

**Files:**
- Create: `server/services/bets/migrations/018_admin.sql`
- Create: `server/services/bets/admin-rules.js`
- Test: `server/test/admin-reglas.test.js`

**Interfaces:**
- Consumes: nada.
- Produces (`admin-rules.js`, todo puro):
  - `validUsername(name: string): boolean`
  - `checkUserChange({ actorId: string, target: { id: string, isAdmin: boolean, suspended: boolean }, patch: { username?: string, isAdmin?: boolean, suspended?: boolean }, activeAdmins: number }): string | null` (mensaje de error o `null`)
  - `checkDelete({ actorId: string, target: { id: string, isAdmin: boolean, suspended: boolean }, confirm: string, targetName: string }): string | null`
  - `redact(detail: object): object` (quita recursivamente claves que casen `/pass|contraseña|token/i`)
  - `seenStale(lastSeen: Date | string | null, now?: number): boolean` (`true` si hay que actualizar `last_seen_at`; umbral 5 min)

- [ ] **Step 1: Escribir las pruebas que fallan** en `server/test/admin-reglas.test.js`. Cabecera como la de `amigos.test.js` (`DATABASE_URL` de mentira antes del `require`). Casos y aserciones exactas:
  - `validUsername`: `'ab'` false, `'abc'` true, `'a'.repeat(31)` false, `'Jordi.R_1-x'` true, `'con espacio'` false, `'ñandú'` true.
  - `checkUserChange` cambios normales devuelven `null` (renombrar a `'nuevo'`, dar el rol a un no administrador, suspender a otro).
  - Con `actorId === target.id`: `patch.isAdmin === false` → `'No puedes quitarte a ti mismo el rol de administrador'`; `patch.suspended === true` → `'No puedes suspender tu propia cuenta'`; renombrarse a uno mismo → `null`.
  - Último administrador: `target.isAdmin && !target.suspended`, `activeAdmins: 1`, `patch.isAdmin === false` (actor distinto) → `'Tiene que quedar al menos un administrador activo'`; igual con `patch.suspended === true`; con `activeAdmins: 2` → `null`. Un administrador ya suspendido con `activeAdmins: 1` se puede degradar (→ `null`).
  - Nombre inválido en `patch.username` → `'El usuario debe tener de 3 a 30 letras, números o . _ -'`.
  - `checkDelete`: `actorId === target.id` → `'No puedes borrar tu propia cuenta'`; no suspendido → `'Suspende la cuenta antes de borrarla'`; `confirm !== targetName` (la comparación es exacta, también en mayúsculas) → `'Escribe el nombre de la cuenta para confirmar'`; todo correcto → `null`.
  - `redact({ password: 'x', nested: { contraseña: 'y', ok: 1 }, ok: 2 })` → `{ nested: { ok: 1 }, ok: 2 }`.
  - `seenStale(null)` true; hace 4 min false; hace 6 min true (pasar `now` fijo).

- [ ] **Step 2: Ejecutar y ver que falla**
  Run: `node --test server/test/admin-reglas.test.js`
  Expected: FAIL (`Cannot find module '../services/bets/admin-rules'`).

- [ ] **Step 3: Implementar `admin-rules.js`** con las firmas de Interfaces. Orden de las comprobaciones de `checkUserChange`: nombre inválido → propia cuenta (rol, suspender) → último administrador. Comentar el porqué de cada regla.

- [ ] **Step 4: Escribir `018_admin.sql`**:
  - `ALTER TABLE bets.users ADD COLUMN suspended_at timestamptz, ADD COLUMN last_seen_at timestamptz;`
  - `bets.admin_log (id bigserial PK, at timestamptz NOT NULL DEFAULT now(), admin_id bigint, admin_name text NOT NULL, action text NOT NULL, target_id bigint, target_name text, detail jsonb NOT NULL DEFAULT '{}')` **sin** clave foránea (el registro sobrevive al borrado de la cuenta); índice `(at DESC)`.
  - `bets.auth_events (id bigserial PK, at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL CHECK (kind IN ('login_ok','login_fail','register','register_blocked')), user_id bigint REFERENCES bets.users(id) ON DELETE SET NULL, username text, ip text)`; índices `(at DESC)` y `(kind, at DESC)`.
  - Comentario de cabecera en español explicando qué guarda cada tabla y por qué `admin_log` no lleva clave foránea.

- [ ] **Step 5: Ejecutar y ver que pasa**
  Run: `node --test server/test/admin-reglas.test.js` → PASS. Run: `npm test` → sin fallos nuevos (`avisos.test.js` ya falla en este PC por `web-push`; ignorarlo).

- [ ] **Step 6: Commit** (sólo si Jordi lo pide): `admin-rules.js`, `018_admin.sql`, el test.

---

### Task 2: Suspendidos, último acceso y eventos de acceso en `auth.js`

**Files:**
- Create: `server/services/bets/auth-events.js`
- Modify: `server/services/bets/auth.js` (`toUser`, `openSession`, `userOf`, `login`, `register`, exports)
- Modify: `server/services/bets/index.js` (arrancar la limpieza)
- Test: `server/test/auth-eventos.test.js`

**Interfaces:**
- Consumes: `seenStale` y `redact` de la tarea 1.
- Produces (`auth-events.js`):
  - `record(kind: 'login_ok'|'login_fail'|'register'|'register_blocked', e: { userId?: string|null, username?: string|null, ip?: string }): Promise<void>` (nunca lanza: un fallo al registrar no puede impedir entrar)
  - `list({ kind?: string, limit?: number, before?: string }): Promise<{ id: string, at: string, kind: string, userId: string|null, username: string|null, ip: string|null }[]>` (más recientes primero; `limit` por defecto 100, máximo 500; `before` es un `id` para paginar)
  - `purge(): Promise<number>` (borra `auth_events` de más de 90 días y `admin_log` de más de 365) y `startPurge(): void` (una vez al arrancar y cada 24 h, con `unref`)
  - `usernameToLog(exists: boolean, typed: string): string | null` (puro: sólo devuelve el nombre si la cuenta existe; si no, `null`, para no guardar contraseñas escritas por error en el campo de usuario)
- Produces (`auth.js`): `toUser` gana `suspended: boolean`; exporta además `validPassword`; `openSession` lanza `fail('Cuenta suspendida', 403)` si la cuenta está suspendida (cubre contraseña y Google, que lo llaman después de comprobar la identidad); `userOf` devuelve `null` si está suspendida.

- [ ] **Step 1: Escribir las pruebas que fallan** en `auth-eventos.test.js`: `usernameToLog(true, 'jordi')` → `'jordi'`; `usernameToLog(false, 'Contraseña123')` → `null`; `usernameToLog(true, 'x'.repeat(80))` → cadena recortada a 30. Run → FAIL.

- [ ] **Step 2: Implementar `auth-events.js`** (las funciones de Interfaces; `record` envuelve todo en `try/catch` y sólo hace `console.warn`).

- [ ] **Step 3: Run `node --test server/test/auth-eventos.test.js`** → PASS.

- [ ] **Step 4: Modificar `auth.js`**:
  - `toUser`: añadir `suspended: !!r.suspended_at`.
  - `openSession`: antes de crear el token, leer `suspended_at` de `bets.users` por `userId`; si está puesto, `throw fail('Cuenta suspendida', 403)`.
  - `userOf`: si `rows[0].suspended_at`, devolver `null`. Si no, y `seenStale(rows[0].last_seen_at)`, ejecutar `UPDATE bets.users SET last_seen_at = now() WHERE id = $1` sin esperar su resultado (`.catch(() => {})`). No añade consultas en el caso normal porque `u.*` ya trae la columna.
  - `login`: tras fallo → `record('login_fail', { userId: rows[0]?.id, username: usernameToLog(!!rows[0], username), ip })`; tras éxito y abrir sesión → `record('login_ok', ...)`. Si `openSession` rechaza por suspensión (la contraseña era correcta), se registra también como `login_fail` con el usuario, y no como `login_ok`.
  - `register`: `record('register', { userId, username, ip })` al crearse; en el bloqueo por IP `record('register_blocked', { ip })`.
  - Exportar `validPassword`. Los accesos con Google no se registran en esta fase (queda anotado en el comentario de `login`).

- [ ] **Step 5: `index.js`**: llamar a `authEvents.startPurge()` en la cadena de arranque, junto a `alerts.startAlerts()`.

- [ ] **Step 6: Verificar a mano** (con `npm run backend`): crear un usuario de prueba, `UPDATE bets.users SET suspended_at = now() WHERE username = 'prueba'`; con la cookie de una sesión previa `GET /api/auth/me` devuelve `null`; entrar con la contraseña correcta devuelve 403 «Cuenta suspendida» y con una incorrecta 401; `select kind, username, ip from bets.auth_events order by id desc limit 5` muestra los eventos y ninguno con un nombre que no exista.
  Expected: lo descrito; después `UPDATE ... SET suspended_at = NULL` y borrar el usuario de prueba.

- [ ] **Step 7: Commit** (sólo si Jordi lo pide).

---

### Task 3: Gateway: ruta y protección de `/api/admin/*`

**Files:**
- Modify: `server/services/gateway/public.js` (añadir y exportar `isAdminPath`)
- Modify: `server/services/gateway/index.js` (`ROUTES` y la puerta de administrador)
- Test: `server/test/publico.test.js` (ampliar)

**Interfaces:**
- Consumes: `user` (con `isAdmin`) que ya calcula el gateway.
- Produces: `isAdminPath(pathname: string): boolean` (`true` para `/api/admin` y `/api/admin/…`); el gateway responde 403 `{ ok: false, error: 'Sólo para administradores' }` a quien tiene sesión y no es administrador.

- [ ] **Step 1: Escribir las pruebas que fallan** en `publico.test.js`:
  - `isAdminPath('/api/admin/users')`, `'/api/admin'`, `'/api/admin/log'` true; `'/api/administrador'`, `'/api/bets'`, `'/api/settings'` false.
  - Añadir a la lista `closed` existente (la de lo que pide cuenta) `['GET','/api/admin/users']`, `['PATCH','/api/admin/users/3']`, `['POST','/api/admin/users/3/password']`, `['DELETE','/api/admin/users/3']`, `['GET','/api/admin/log']`, `['GET','/api/admin/auth-events']`. Run → FAIL por `isAdminPath` no definido.

- [ ] **Step 2: Implementar** `isAdminPath` en `public.js` (y exportarla). En `gateway/index.js`: añadir `admin` al grupo de `bets` en `ROUTES` (`/^\/api\/(auth|bets|settings|friends|shared|alerts|admin)(\/|$)/`) y, justo después de comprobar la sesión (donde hoy se devuelve el 401), `if (isApi && pub.isAdminPath(pathname) && !user?.isAdmin) return json(res, 403, { ok: false, error: 'Sólo para administradores' });`. Sin sesión ya sale el 401 porque ninguna ruta admin es pública.

- [ ] **Step 3: Run `node --test server/test/publico.test.js`** → PASS.

- [ ] **Step 4: Verificar a mano** (con `npm run backend`): sin cookie `curl -i http://127.0.0.1:47365/api/admin/users` → 401; con la cookie de un usuario normal → 403; mandando además la cabecera `x-user-admin: 1` con esa cookie sigue 403 (el gateway la descarta).

- [ ] **Step 5: Commit** (sólo si Jordi lo pide).

---

### Task 4: Servicio de administración de usuarios en `bets`

**Files:**
- Create: `server/services/bets/admin.js`
- Modify: `server/services/bets/index.js` (rutas)
- Modify: `AGENTS.md` (excepción de lectura de `bets.bets`)
- Test: `server/test/admin-reglas.test.js` (ya cubre las reglas; aquí sólo la forma de las filas con una función pura `toAdminUser`)

**Interfaces:**
- Consumes: `checkUserChange`, `checkDelete`, `validUsername`, `redact` (tarea 1); `hashPassword`, `validPassword` (tarea 2); `list` de `auth-events` (tarea 2); `tx`, `query` de `shared/db`; `fail` de `shared/service`.
- Produces (`admin.js`):
  - `toAdminUser(row): AdminUser` (puro) con `AdminUser = { id: string, username: string, isAdmin: boolean, suspended: boolean, createdAt: string, lastSeenAt: string|null, hasPassword: boolean, googleEmail: string|null, bets: number, sessions: number }`
  - `listUsers(): Promise<AdminUser[]>` (por `id`; `bets` y `sessions` son subconsultas `count(*)` filtradas por `user_id`, sólo un número por usuario, sin columnas de la apuesta)
  - `updateUser(actorId: string, id: string, patch: { username?: string, isAdmin?: boolean, suspended?: boolean }): Promise<AdminUser>`
  - `setPassword(actorId: string, id: string, password: string): Promise<{ ok: true }>`
  - `closeSessions(actorId: string, id: string): Promise<{ closed: number }>`
  - `deleteUser(actorId: string, id: string, confirm: string): Promise<{ ok: true }>`
  - `listLog({ limit?: number, before?: string }): Promise<{ id: string, at: string, adminId: string|null, adminName: string, action: string, targetId: string|null, targetName: string|null, detail: object }[]>`
- Rutas nuevas en `index.js` (todas con una función local `adminOf(req)` que llama a `who(req)` y lanza `fail('Sólo para administradores', 403)` si no lo es): `GET /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/password` (cuerpo `{ password }`), `POST /api/admin/users/:id/sessions/close`, `DELETE /api/admin/users/:id` (cuerpo `{ confirm }`), `GET /api/admin/log`, `GET /api/admin/auth-events` (consulta `kind`, `limit`, `before`).

- [ ] **Step 1: Escribir la prueba que falla** para `toAdminUser`: dada una fila con `id: 7n`, `is_admin: true`, `suspended_at: null`, `password_hash: 'x'`, `google_email: null`, `bets: 3`, `sessions: 1`, devuelve `{ id: '7', isAdmin: true, suspended: false, hasPassword: true, googleEmail: null, bets: 3, sessions: 1, ... }`, y `suspended_at` puesto → `suspended: true`. Run → FAIL.

- [ ] **Step 2: Implementar `admin.js`.** Reglas de implementación que la firma no determina:
  - Toda escritura va en `tx(...)` con `pg_advisory_xact_lock(727002)` al principio (distinto de `FIRST_USER_LOCK`), y lee el objetivo con `SELECT ... FOR UPDATE`; `activeAdmins` = `count(*)` de `is_admin AND suspended_at IS NULL`. Es lo que evita que dos administradores se quiten el rol a la vez y no quede ninguno.
  - Cada campo de `patch` realmente cambiado escribe **una** fila de `admin_log` en la misma transacción (`user.rename`, `user.role`, `user.suspend`, `user.unsuspend`, `user.password`, `user.sessions`, `user.delete`), con `detail` pasado por `redact` (por ejemplo `{ from, to }`). Un `patch` sin cambios reales no escribe nada.
  - Suspender borra las sesiones de ese usuario en la misma transacción. Renombrar captura `23505` y lanza `fail('Ese usuario ya existe', 409)`.
  - `setPassword`: `validPassword`, nuevo hash, `DELETE FROM bets.sessions WHERE user_id = $1` (todas), registro `user.password` **sin** la contraseña en `detail`.
  - `deleteUser`: usa `checkDelete`; el borrado arrastra por cascada apuestas, amigos, mensajes y avisos; `target_name` queda en `admin_log`.
  - Un `id` que no existe → `fail('No existe esa cuenta', 404)`. `id` no numérico → `fail('Cuenta no válida', 400)`.

- [ ] **Step 3: Run** `node --test server/test/admin-reglas.test.js` → PASS.

- [ ] **Step 4: Añadir las rutas a `index.js`** como en Interfaces.

- [ ] **Step 5: AGENTS.md**: en la regla 7 (o junto a la nota de Amigos sobre la única lectura de `bets.bets` de otro usuario) añadir que `admin.listUsers` cuenta las apuestas de cada usuario (sólo el número, filtrado por `user_id`) y que no debe devolver columnas; y una línea en «Cuenta» sobre `/api/admin/*` (sólo administradores, el gateway lo cierra y `bets` lo vuelve a comprobar; cada acción queda en `bets.admin_log`).

- [ ] **Step 6: Verificar a mano** (con `npm run backend`, como administrador): `GET /api/admin/users` lista las cuentas con `bets` numérico; `PATCH` renombra y aparece en `/api/admin/log`; intentar `PATCH {isAdmin:false}` sobre el único administrador → 400 «Tiene que quedar al menos un administrador activo»; `DELETE` de una cuenta no suspendida → 400 «Suspende la cuenta antes de borrarla»; `POST …/password` con 7 caracteres → 400 y con 8 cierra las sesiones de ese usuario; ninguna fila de `admin_log` contiene la contraseña (`select detail from bets.admin_log`).
  Expected: lo descrito. Run `npm test` y `npm run typecheck` → sin errores nuevos.

- [ ] **Step 7: Commit** (sólo si Jordi lo pide).

---

### Task 5: Interfaz: API, vista, navegación y pestañas vacías

**Files:**
- Modify: `src/lib/types.ts` (tipos `AdminUser`, `AdminLogRow`, `AuthEventRow`; `admin` dentro de `Api`)
- Modify: `src/lib/api.ts` (`admin: {…}`)
- Modify: `src/lib/app-context.tsx` (`View` gana `'admin'`; `go` lo bloquea a quien no es administrador, como `settings`; `switchApp` lo trata igual que `settings`)
- Modify: `src/App.tsx` (render de `AdminView`, botón *Administración* en el menú lateral junto a *Ajustes*, `aria-current` del botón de cuenta del móvil)
- Modify: `src/views/AccountView.tsx` (tarjeta *Administración* junto a la de *Ajustes de la app*)
- Create: `src/views/AdminView.tsx`, `src/views/admin/UsersTab.tsx`, `src/views/admin/ActivityTab.tsx` (por ahora con `<Loading />`)

**Interfaces:**
- Consumes: rutas de la tarea 4.
- Produces (`window.api.admin`): `users(): Promise<AdminUser[]>`, `updateUser(id: string, patch: { username?: string; isAdmin?: boolean; suspended?: boolean }): Promise<AdminUser>`, `setPassword(id: string, password: string): Promise<{ ok: true }>`, `closeSessions(id: string): Promise<{ closed: number }>`, `deleteUser(id: string, confirm: string): Promise<{ ok: true }>`, `log(p?: { limit?: number; before?: string }): Promise<AdminLogRow[]>`, `authEvents(p?: { kind?: string; limit?: number; before?: string }): Promise<AuthEventRow[]>`. Componentes: `AdminView(): JSX.Element` con `Tabs` de valores `'users' | 'activity'`; `UsersTab()`, `ActivityTab()` sin props.

- [ ] **Step 1: Tipos y API** como en Interfaces (`get`/`call` de `api.ts`; `part()` para los `id` en la ruta; `PATCH` va por `call('PATCH', …)`).
- [ ] **Step 2: `View` y navegación.** Mismo control de administrador que `settings`. El botón del menú lateral usa `navRow` y el icono `Shield` de `lucide-react`; la tarjeta de *Tu cuenta* sólo para `isAdmin`.
- [ ] **Step 3: `AdminView`** con `PageHeader title="Administración"`, `Tabs` y la pestaña activa dentro de `ScreenGuard` (ya envuelve la vista en `App.tsx`).
- [ ] **Step 4: Verificar.** Run `npm run typecheck` → sin errores. Con `npm run backend` + `npm run dev`: el administrador ve el botón y la pantalla con las dos pestañas; un usuario normal no ve el botón y, forzando `go('admin')` desde la consola, no cambia de vista.
- [ ] **Step 5: Commit** (sólo si Jordi lo pide).

---

### Task 6: Pestaña Usuarios

**Files:**
- Modify: `src/views/admin/UsersTab.tsx`

**Interfaces:**
- Consumes: `window.api.admin.*` (tarea 5), `useUser()` (para `me.id`), `useApp().toast`, componentes de `ui.tsx`.
- Produces: la pestaña completa. Sin cambios de interfaz para otras tareas.

- [ ] **Step 1: Lista.** `useQuery(['admin', 'users'])`; tabla en `lg` (columnas: usuario con insignias *Admin*, *Suspendida* y *Google*; alta; último acceso (`—` si `null`, fecha relativa si no); apuestas; sesiones) y tarjetas en móvil. Un campo de búsqueda por nombre filtra en el cliente. Sin consultas periódicas: se vuelve a pedir al abrir, tras cada acción y con un botón *Actualizar*.
- [ ] **Step 2: Acciones** (menú por fila; las acciones sobre la propia cuenta deshabilitadas con `title` que lo explica, aunque el servidor es quien manda):
  - *Renombrar* (Dialog con `Field`+`Input`, mismas reglas que el registro).
  - *Dar / quitar administrador* (confirmación).
  - *Suspender / reactivar* (confirmación; al suspender avisa de que se cierran sus sesiones).
  - *Contraseña temporal* (Dialog con `Field`; avisa de que cierra todas sus sesiones y de que debe cambiarla al entrar).
  - *Cerrar sesiones*.
  - *Borrar* (sólo habilitada si está suspendida; Dialog que exige escribir el nombre exacto y dice que arrastra apuestas, amigos y mensajes).
  Todo error del servidor se muestra tal cual con `toast`; tras una acción correcta se invalida `['admin','users']` y `['admin','log']`.
- [ ] **Step 3: Verificar a mano** a 375 px y a escritorio: renombrar, dar y quitar rol a una cuenta de prueba, suspenderla (su otra ventana pasa a «sin sesión» al recargar), contraseña temporal, borrarla; intentar quitarte el rol a ti mismo muestra el error del servidor. Run `npm run typecheck` → sin errores.
- [ ] **Step 4: Commit** (sólo si Jordi lo pide).

---

### Task 7: Pestaña Actividad y texto de privacidad

**Files:**
- Modify: `src/views/admin/ActivityTab.tsx`
- Modify: `src/views/LegalView.tsx` (lista «Qué datos se tratan y para qué», cerca de la línea 79)
- Modify: `docs/specs/07-backend.md` (apartado de cuenta: rutas `/api/admin/*` y tablas nuevas)

**Interfaces:**
- Consumes: `window.api.admin.log`, `window.api.admin.authEvents` (tarea 5).
- Produces: la pestaña completa.

- [ ] **Step 1: Dos listas** dentro de la pestaña, con un selector segmentado (`segWrap` + `seg`): *Acciones de administradores* (fecha, quién, acción en español —por ejemplo `user.suspend` → «Suspendió la cuenta»—, a quién, detalle legible) y *Accesos* (fecha, tipo en español, usuario, IP) con filtro por tipo (`kind`). Paginación con *Cargar más* usando `before` (el `id` de la última fila). Vacío con `Empty`.
- [ ] **Step 2: `LegalView`.** Añadir un punto: con cuenta, de cada entrada, intento fallido y registro se guarda la fecha, el nombre de usuario (sólo si la cuenta existe) y la dirección IP durante 90 días, para detectar abusos y problemas de seguridad; y que las acciones de los administradores sobre las cuentas se registran. Ajustar la frase de «Sin cuenta» sólo si deja de ser verdad (las visitas sin cuenta siguen sin guardarse).
- [ ] **Step 3: `docs/specs/07-backend.md`.** Documentar las rutas, tablas y el comportamiento de suspensión en el apartado de cuenta.
- [ ] **Step 4: Verificación final de la fase.** Run `npm run typecheck` y `npm test` → sin errores salvo el `avisos.test.js` del PC (falta `web-push`). Con `npm run backend` + `npm run dev`: hacer una acción de administrador, un acceso fallido y un registro, y comprobar que salen en las dos listas; a 375 px no hay scroll lateral.
- [ ] **Step 5: Commit** (sólo si Jordi lo pide).
