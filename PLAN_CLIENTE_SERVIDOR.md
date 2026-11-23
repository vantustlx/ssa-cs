# Plan de migración a cliente-servidor (offline-first)

> Estado: **Fase 0–1 completada · Fase 2 planificada, pendiente de inicio** · Fecha: 2026-11-23
> Objetivo: migrar la app Electron + MySQL directo a **cliente-servidor de 3 capas**, conservando escritorio, los 3 escáneres por COM y operación offline en la caseta.
> Stack definitivo: **Express + MySQL en backend**, **Electron + SQLite en frontend**, **monorepo pnpm** con `frontend/`, `backend/` y `shared/` en la raíz.
> Implementado hasta ahora: monorepo pnpm, `shared/` (dominio puro), repositorio MySQL del acceso en `backend/`, esqueleto Express con `GET /salud`, adaptadores del frontend y pruebas (`pnpm test`). **Fase 2 planificada, pendiente de inicio.**

## Decisiones cerradas

| Tema | Decisión |
|---|---|
| Modelo | Cliente-servidor de 3 capas: Electron (cliente) → API Node → MySQL |
| Backend | **Express** (Node 20+, CommonJS) sobre MySQL |
| Repositorio | **Monorepo con pnpm**: `frontend/`, `backend/` y `shared/` en la raíz |
| Sesión admin | **`cookie-session`** (cookie firmada, `httpOnly`) |
| Servidor | VPS o servidor propio (indiferente); MySQL en Docker para desarrollo |
| Lectores | Los 3 escáneres por COM viven en el cliente (proceso `main` de Electron) |
| Offline | **Solo el lector** opera sin red; el modo administrador exige conexión |
| Visitantes offline | Solo se validan pases **ya sincronizados**; el alta requiere internet |
| Duración offline | Hasta **12 h**, con picos de **5–10 escaneos/s** |
| QR offline | Se sincroniza la **firma HMAC precalculada por usuario**; el `QR_SECRETO` nunca sale del servidor |
| Datos locales | SQLite como réplica + registro de movimientos + outbox |
| Driver SQLite | **`node:sqlite` (`DatabaseSync`)**; sin módulo nativo |
| Snapshot Fase 2 | Origen **MySQL directo temporal**, completo cada **5 minutos** |
| Replay Fase 2 | **MySQL directo temporal** (idempotente con `uuid` + `sync_evento`) |
| Cierre MySQL | Se mantiene **gateado por conexión**; el cierre local corre siempre |
| Administradores | Uno o varios, siempre online |
| Confirmaciones | Worker de Cloudflare **sin cambios** |

---

## 1. Estructura del repositorio

```
ssa-cs/
├── package.json              # raíz privada + scripts
├── pnpm-workspace.yaml       # frontend, backend, shared
├── pnpm-lock.yaml            # único lockfile del monorepo
├── .npmrc                    # node-linker=hoisted (Electron + nativos)
├── docker-compose.yml        # MySQL 8 para desarrollo
├── README.md
├── AGENTS.md
├── PLAN_CLIENTE_SERVIDOR.md
│
├── frontend/                 # Electron (cliente)
│   ├── package.json          # @ssa/frontend
│   ├── .env.example
│   └── src/
│       ├── main/             # main.js, lectores.js, config.js...
│       └── renderer/         # views, css, js, assets
│
├── backend/                  # Express (servidor)
│   ├── package.json          # @ssa/backend
│   ├── .env.example
│   └── src/
│       ├── index.js          # app.listen + cierre ordenado
│       ├── app.js            # express, JSON, /salud, 404, errores
│       ├── config.js         # carga backend/.env
│       ├── db/mysql.js       # crearPool(config.db)
│       ├── repos/mysql/      # areasRepo, accessRepo
│       ├── services/         # accesoService (usa @ssa/shared)
│       ├── routes/           # salud (y después auth, sync, etc.)
│       ├── middleware/
│       ├── jobs/
│       └── storage/
│
├── shared/                   # dominio puro (sin Electron ni MySQL)
│   ├── package.json          # @ssa/shared
│   └── src/
│       ├── acceso.js
│       ├── areas.js
│       ├── qr.js
│       ├── fechas.js
│       ├── validacion.js
│       ├── visitantes.js
│       ├── antirrebote.js
│       ├── lectores.js
│       ├── texto.js
│       └── index.js
│
├── db/
│   ├── schema.sql
│   ├── usuario_app.sql
│   └── migraciones/
│
└── worker/                   # Cloudflare (sin cambios)
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - frontend
  - backend
  - shared
```

Scripts de la raíz (`package.json`):

```json
{
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "pnpm --filter @ssa/frontend start",
    "dev": "pnpm --filter @ssa/frontend dev",
    "dev:back": "pnpm --filter @ssa/backend dev",
    "test": "pnpm --filter @ssa/shared test && pnpm --filter @ssa/backend test",
    "db:up": "docker compose up -d mysql",
    "db:down": "docker compose down"
  }
}
```

Nombres y dependencias internas:

- `@ssa/frontend` → `"@ssa/shared": "workspace:*"`
- `@ssa/backend` → `"@ssa/shared": "workspace:*"`
- `shared` no depende de nadie.

`.npmrc`:

```ini
node-linker=hoisted
```

Se usa `node-linker=hoisted` para que `electron` y `serialport` resuelvan sus módulos nativos sin problemas en el monorepo. SQLite usa `node:sqlite`, que no requiere módulo nativo ni rebuild para Electron.

**Variables de entorno separadas:**

- `frontend/.env`: durante la transición mantiene DB, admin, Gmail, QR, confirmación y COM (lo que ya usa hoy). Después queda solo con `API_URL`, API key del dispositivo y COM.
- `backend/.env`: `PORT`, `DB_*`, `SESSION_SECRET`, `ADMIN_*`, `QR_SECRETO`, `GMAIL_*`, `CONFIRMACION_*`, `CIERRE_*`, `RESPALDO_*`.
- `config.js` del frontend resuelve `__dirname/../..` = `frontend/`, así que busca `frontend/.env` **sin cambios de código**.

---

## 2. Arquitectura objetivo

```
PC caseta (Electron, offline-first)                      Servidor (VPS/servidor)
┌─────────────────────────────────────────────┐  HTTPS  ┌──────────────────────────────┐
│ main:                                        │◄───────►│ API Node + Express           │
│  ├─ SerialPort COM1/2/3                      │  sync   │  ├─ cookie-session (admin)   │
│  ├─ SQLite réplica + registro + outbox       │         │  ├─ sync de accesos (device)  │
│  ├─ decisión de acceso LOCAL (síncrona)      │         │  ├─ reportes/PDF/cierre       │
│  └─ sync worker (lotes, backoff, idempot.)   │         │  ├─ correo/confirmaciones     │
│ preload: puente tipado                       │         │  └─ MySQL (localhost)         │
│ renderer: kiosco, cámara, beep, pendientes   │         │                              │
└─────────────────────────────────────────────┘         └──────────────┬───────────────┘
                                                                         │
                                                          Worker confirmaciones (igual)
```

- **Admin**: solo online (login con `cookie-session` contra el servidor).
- **Lector**: decide y registra local; la red es asíncrona.
- **Servidor**: consolida, administra, reporta, genera PDFs, cierre oficial, respaldos.
- **Serial**: exclusivamente en el cliente; el servidor nunca abre COM.

---

## 3. Núcleo offline

### 3.1 SQLite en el cliente (réplica + registro + outbox)

Archivo: `app.getPath('userData')/accesos.db`. Driver: **`node:sqlite` (`DatabaseSync`)** — síncrono, transaccional y sin módulo nativo. `offline/db.js` abstrae el driver por si en el futuro hace falta `better-sqlite3`.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 3000;

usuario_local(
  matricula PK, nombre, apellido_paterno, apellido_materno,
  firma_qr, area_principal, placas, actualizado_en
);
visitante_local(
  id PK, codigo_acceso UNIQUE, nombre, tipo, motivo, vigente_hasta, actualizado_en
);
registro_local(
  uuid PK, matricula, id_visitante,
  entrada_utc, salida_utc, medio_entrada, medio_salida,
  cierre_automatico_utc, sync_estado
);
outbox(
  uuid PK, tipo, payload_json, creado_en, intentos, ultimo_error,
  estado  -- PENDIENTE | ENVIADO | ERROR
);
meta(clave PK, valor);  -- snapshot_ts, config, ultimo_cierre_local
```

Índices: `registro_local(matricula, entrada_utc)`, `registro_local(id_visitante, entrada_utc)`, `outbox(estado, creado_en)`.

### 3.2 Decisión de acceso compartida

Extraer las reglas de `frontend/src/main/acceso.js` a un **servicio agnóstico de BD** con dos repositorios:

- `MySQLRepo` (backend): conserva las consultas actuales.
- `SQLiteRepo` (frontend): versiones equivalentes.

Se mantienen exactamente las reglas actuales:

- Entrada si no hay entrada abierta de hoy; salida si la hay (`acceso.js:174`).
- Entrada de día anterior sin salida → `cierre_automatico` y cuenta como entrada (`acceso.js:169`).
- Visitantes alternan entrada/salida sin medio (`acceso.js:261`).
- Antirrebote por lector (`esRepetida`, 8 s) y lectura repetida global (15 s) movidos al cliente.

En SQLite no hay `FOR UPDATE`, pero al ser **un solo proceso escritor** cada operación se envuelve en `db.transaction()` síncrona: atomicidad equivalente. El repo SQLite serializa sus transacciones con una cola para que el servicio asíncrono no entrevere operaciones.

### 3.3 QR offline sin secreto

El backend calcula la firma con `shared/src/qr.js` y la sincroniza como `usuario_local.firma_qr`. El cliente valida `FCB<matrícula>K<firma>` por **coincidencia exacta** contra la firma guardada:

- No viaja `QR_SECRETO`.
- Si cambia el secreto, las firmas cambian y hay que reemitir credenciales (igual que hoy).
- Si `QR_ACEPTAR_SIN_FIRMA=si`, se sincroniza ese flag y se acepta matrícula sola para usuarios existentes.
- Visitantes: se valida el folio contra `visitante_local` y `vigente_hasta`.

### 3.4 Ráfagas de 5–10 escaneos/s

Flujo por lectura (todo en el hilo principal, sin `await` de red):

1. `frontend/src/main/lectores.js` recibe el texto y resuelve el rol.
2. `procesarLecturaLocal(texto, lector)` ejecuta **una transacción síncrona**:
   antirrebote → parsear QR/folio → validar firma/caché → buscar usuario/placas/área →
   último movimiento → insertar/actualizar `registro_local` → insertar `outbox`.
3. Devuelve el resultado; el renderer muestra y suena **inmediatamente**.
4. Se dispara el sync worker en segundo plano.

Sizing de 12 h × 10/s = **432.000 eventos** en el peor caso teórico:

- `node:sqlite` es síncrono y soporta miles de escrituras/s; 10/s es holgado.
- La outbox puede crecer; se sincroniza por lotes (200–500) y se purgan los enviados.
- El renderer mantiene historiales acotados (ya existe `MAX_HISTORIAL=300`); repintar como máximo ~10 veces/s.

### 3.5 Cierre diario local

- Un scheduler local revisa `CIERRE_HORA` (mismo criterio que `frontend/src/main/cierreDiario.js`).
- Si hay entradas abiertas de días anteriores o llega la hora, las cierra localmente y encola `CIERRE_AUTOMATICO`.
- Es idempotente por día usando `meta.ultimo_cierre_local`.
- El backend conserva el cierre oficial (PDF/notificación) y aplica los cierres que lleguen tarde.
- Si la app se apaga a la hora del cierre y arranca al día siguiente offline, la recuperación se hace al iniciar.

### 3.6 Sincronización

> En la Fase 2 la subida/bajada se implementa con **MySQL directo temporal** (interfaz `transporte`); los endpoints HTTP de esta sección entran en la Fase 3 sin cambiar el outbox.

**Subida (cliente → backend)** — `POST /sync/accesos`:

- Lotes de 200–500 eventos ordenados por `creado_en`.
- Cada evento: `uuid`, `tipo` (`ENTRADA`/`SALIDA`/`CIERRE_AUTOMATICO`/`ACCESO_FALLIDO`), `matricula`/`id_visitante`, `entrada_utc`/`salida_utc`, medios, `origen`, `lector`, `client_ts`.
- Idempotencia: `uuid` en `registroacceso` + tabla `sync_evento(uuid PK)`; un lote repetido no duplica.
- El servidor guarda la **hora del cliente** como hora del evento y `recibido_en` aparte.
- Reintentos con backoff exponencial (1s → 60s); estado visible "N pendientes".

**Bajada (backend → cliente)** — `GET /sync/datos`:

- Snapshot completo al iniciar y al reconectar: usuarios + `firma_qr` + `area_principal` + `placas`, visitantes vigentes, catálogos, configuración (`antirrebote`, `intervalo`, `CIERRE_HORA`, `QR_ACEPTAR_SIN_FIRMA`), `snapshot_ts`.
- Volumen pequeño; se puede empezar con snapshot completo y añadir deltas por `actualizado_en` después.
- El cliente aplica todo en una transacción y conserva el último snapshot si falla.

**Orden al reconectar:** primero subir la outbox, después bajar el snapshot. Como los accesos los genera únicamente esta PC, no hay conflicto de movimientos.

**UI offline honesta:** si no hay red y una matrícula/folio no está en el snapshot, mostrar **"No disponible sin conexión; consulta con administración"**, no "no registrada" (podría ser un alta reciente del admin).

### 3.7 Límites por decisión de negocio

- Altas/cambios de usuarios y de visitantes: **solo online** (el backend es la fuente de verdad).
- Reportes, PDFs, notificaciones y respaldos: **solo online**.
- Offline solo cubre: validar, decidir entrada/salida y registrar.
- Tras 12 h sin sync, avisar en pantalla "datos con N horas de antigüedad".

---

## 4. Backend y base de datos

### 4.1 Stack del backend

- **Node 20+** (CommonJS; en desarrollo se usa Node 24).
- **Express 5** (compatible con 4 si se prefiere).
- **`mysql2/promise`** para MySQL.
- **`cookie-session`** con `SESSION_SECRET` para el administrador; API key para el dispositivo de caseta.
- **SSE** (`EventSource`) para `notificaciones-actualizadas`; `ws` solo si se requiere bidireccional.
- **`helmet`** y **`express-rate-limit`**; `cors` configurable (no necesario si el fetch sale del main de Electron).
- `node --watch` y `fetch` nativos; sin `nodemon` ni `dotenv`.
- Jobs con `setInterval`/`node-cron` dentro del proceso.
- PDFs con `pdfkit` y correo con `nodemailer` (reutilizados).
- MySQL en Docker para desarrollo; producción Linux con Docker Compose o systemd.

### 4.2 API (Express)

**Dispositivo (API key, solo caseta):**

- `POST /sync/accesos`
- `GET /sync/datos`
- `GET /salud`

**Admin (`cookie-session`, solo online):**

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- Usuarios/áreas/placas: búsqueda, alta, edición, recuperar QR
- Visitantes: alta, búsqueda
- Reportes y PDFs (`GET /archivos/:id`)
- Notificaciones (listar, leídas, borrar, limpiar, descargar PDF)
- Gestión masiva (búsqueda, envío, ZIP de credenciales)

**Tiempo real:** SSE para notificaciones en el cliente admin (el lector no lo necesita para operar).

### 4.3 Cambios en MySQL (`db/schema.sql` + migración)

```sql
ALTER TABLE registroacceso ADD COLUMN uuid CHAR(36) NULL UNIQUE;
ALTER TABLE registroacceso ADD COLUMN punto_acceso VARCHAR(50) NULL;
ALTER TABLE registroacceso ADD COLUMN recibido_en DATETIME DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE dispositivo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  punto_acceso VARCHAR(50) NOT NULL,
  api_key_hash CHAR(64) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE sync_evento (
  uuid CHAR(36) PRIMARY KEY,
  dispositivo_id INT NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  recibido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- `actualizado_en` en `usuario`, `vehiculo`, `visitante`, `usuario_area` (o snapshot completo al inicio para simplificar).
- `QR_SECRETO` y credenciales Gmail viven solo en el backend.
- **Zona horaria:** fijar `TZ=America/Mexico_City` en Node y `default-time-zone` en MySQL; NTP. Los eventos viajan en UTC con offset y el servidor los normaliza antes de guardar.

### 4.4 Idempotencia y reconciliación

- Aplicar lote en transacción; `INSERT IGNORE` en `sync_evento`; si el `uuid` ya existe, saltar.
- Validar coherencia (salida sin entrada, entrada sin cierre) y registrar `ACCESO_INCONSISTENTE` sin rechazar el lote.
- El cierre oficial del backend ignora registros ya cerrados (`cierre_automatico IS NULL`) y genera aviso si recibe eventos de días ya cerrados.

---

## 5. Mapa de cambios por archivo

| Actual | Destino |
|---|---|
| `src/main/main.js` | `frontend/src/main/main.js` (cliente) + `backend/src/index.js` (servidor) |
| `src/main/database.js` | Repositorios MySQL en `backend/src/repos/mysql/`; handlers IPC → rutas/preload |
| `src/main/acceso.js` | `shared/src/acceso.js` + `frontend/src/main/acceso.js` + `backend/src/repos/mysql/accessRepo.js` + (Fase 2) repo SQLite |
| `src/main/lectores.js` | `frontend/src/main/lectores.js` (config COM local) |
| `src/main/qrFirmado.js` | `shared/src/qr.js` + wrapper `frontend/src/main/qrFirmado.js`; el backend usa `shared` |
| `src/main/config.js` | `frontend/src/main/config.js` + `backend/src/config.js` |
| `src/main/sendemails.js` | `backend/src/services/` (Fase 3); `navigate` → routing del cliente |
| `src/main/auth.js` + `sesionAdmin.js` | `backend/src/routes/auth.js` + `backend/src/middleware/` (cookie-session) |
| `src/main/cierreDiario.js` | `backend/src/jobs/` + cierre local en el frontend (Fase 2) |
| `src/main/respaldos.js` | `backend/src/jobs/` |
| `src/main/notificaciones.js` | `backend/src/services/` + SSE |
| `src/main/gestionMasiva.js` | `backend/src/routes/gestion.js` (Fase 3) |
| `src/main/seguridad.js` | `frontend/src/main/seguridad.js` |
| `src/main/utils/pdf*.js` | `backend/src/storage/` o `backend/src/utils/` (Fase 3) |
| `src/renderer/**` | `frontend/src/renderer/**` |
| `worker/src/index.js` | **Sin cambios** |

Cliente Electron endurecido desde el inicio: `nodeIntegration:false`, `contextIsolation:true`, `preload` tipado, sin navegación externa.

---

## 6. Fases de ejecución

### Fase 0 — Reestructuración del repo (1–2 días)

| Paso | Acción |
|---|---|
| 0.1 | Crear `pnpm-workspace.yaml` (`frontend`, `backend`, `shared`) y `package.json` raíz con scripts |
| 0.2 | Crear `.npmrc` con `node-linker=hoisted` |
| 0.3 | `git mv src frontend/src` y `git mv package.json frontend/package.json` (renombrar a `@ssa/frontend`) |
| 0.4 | Mover `.env` actual a `frontend/.env`; crear `frontend/.env.example` y `backend/.env.example` |
| 0.5 | Crear `backend/` con Express, `config.js`, `db/mysql.js`, `routes/salud.js` y `/salud` |
| 0.6 | Crear `shared/` con `package.json` y `src/index.js` |
| 0.7 | Crear `docker-compose.yml` (MySQL 8 en `127.0.0.1:3307`, montando `db/schema.sql`) |
| 0.8 | Actualizar README y AGENTS con la nueva estructura y comandos |
| 0.9 | Eliminar `package-lock.json` y quedarse solo con `pnpm-lock.yaml`; ejecutar `pnpm install` |
| 0.10 | Verificar que la app arranca y que `/salud` responde |

**Por qué el movimiento es seguro:**

- Al mover `src/` completo a `frontend/src/`, las rutas internas no cambian.
- `frontend/src/main/main.js` sigue encontrando `../renderer/views/...`.
- `frontend/src/main/config.js` resuelve `__dirname/../..` = `frontend/`, así que busca `frontend/.env` automáticamente, **sin tocar código**.
- El script `"start": "electron src/main/main.js"` sigue funcionando porque se ejecuta con cwd `frontend/`.

**Backend mínimo de la Fase 0:**

```
backend/
├── package.json          # @ssa/backend; express, cookie-session, mysql2, helmet, express-rate-limit
├── .env.example
└── src/
    ├── index.js          # loadEnvFile + crearApp + listen + cierre ordenado
    ├── app.js            # express(), JSON, /salud, 404, manejador de errores
    ├── config.js         # PORT, DB_*, SESSION_SECRET
    ├── db/mysql.js       # crearPool(config.db)
    ├── routes/salud.js   # GET /salud -> { ok, db, version }
    └── middleware/errors.js
```

`GET /salud` puede comprobar la BD de forma opcional y devolver `{ ok, db: 'ok'|'error', version }`.

**Criterio de salida Fase 0:** `pnpm start` abre la app exactamente como hoy y `pnpm dev:back` responde `GET /salud`.

### Fase 1 — Núcleo compartido + repos + adaptadores (1–2 semanas)

#### 1.1 Extraer dominio a `shared/`

| Módulo | Origen actual | Contenido |
|---|---|---|
| `shared/src/lectores.js` | `frontend/src/main/acceso.js` | `LECTORES`, `MATRICULA_VALIDA`, `CODIGO_VISITANTE`, `FOLIO_VISITANTE` |
| `shared/src/texto.js` | `acceso.js` | `nombreCompleto` |
| `shared/src/fechas.js` | `acceso.js`, `cierreDiario.js` | `inicioDeHoy`, `formatoHora` |
| `shared/src/antirrebote.js` | `acceso.js` | lógica de `esRepetida` |
| `shared/src/qr.js` | `qrFirmado.js` | `firmaConSecreto`, `contenidoQR`, `leerQR` (secreto o firma precalculada) |
| `shared/src/areas.js` | `areas.js` | `validarAreas`, `areaPrincipal`, `resumenAreas`, `filtroPorAreas` |
| `shared/src/validacion.js` | `validacion.js` | reglas de datos personales |
| `shared/src/visitantes.js` | `visitantes.js` | `normalizar`, `validar`, `calcularVigencia`, `generarFolio` |
| `shared/src/acceso.js` | `acceso.js` | helpers puros (`decidirMovimiento`, avisos) y **servicio agnóstico** `crearServicioAcceso({ repo, ... })` |

Regla de oro: `shared/` **no puede** importar `electron`, `mysql2`, `serialport` ni `config`. Un test lo verifica.

#### 1.2 Repositorios MySQL en `backend/`

```js
// backend/src/repos/accessRepo.js  (contrato + JSDoc)
// backend/src/repos/mysql/accessRepo.js (implementación)
crearAccessRepo(pool) -> {
  conTransaccion(fn),
  obtenerUsuarioParaAcceso, obtenerPlacas, obtenerAreaPrincipal,
  ultimoMovimientoUsuario, entradaAbiertaUsuario,
  crearEntradaUsuario, cerrarEntradaUsuario, marcarCierreAutomatico,
  actualizarEstatusUsuario,
  obtenerVisitantePorFolio, ultimoMovimientoVisitante,
  entradaAbiertaVisitante, crearEntradaVisitante, cerrarEntradaVisitante,
  buscarUsuario
}
```

- MySQL conserva `FOR UPDATE` y transacciones.
- Las fechas se pasan como parámetro (`ahora`) en vez de `NOW()`, para que el mismo servicio funcione luego con SQLite.
- `areasRepo.js` recibe el handle de BD, sin depender de Electron.

#### 1.3 Adaptadores en `frontend/src/main/`

- `acceso.js`: usa `@ssa/shared` para reglas y regex, pero conserva temporalmente su orquestación MySQL.
- `areas.js`, `validacion.js`, `qrFirmado.js`, `visitantes.js`: envuelven `shared` y mantienen las mismas exportaciones para no tocar el renderer.
- `lectores.js`: sin cambios; sigue importando `LECTORES`/`registrarAcceso` de `./acceso`.

Así **no hay imports cruzados front/back** durante la transición. En la Fase 2 el frontend sustituye su orquestación por el servicio compartido + repositorio SQLite.

#### 1.4 Pruebas

- `shared/test/` con `node --test`:
  - QR válido, firma inválida, sin firma con flag on/off, folio de visitante.
  - Decisión entrada/salida, entrada de día anterior, aviso vehicular sin placas.
  - Antirrebote (ventana, expiración, limpieza).
  - Validación de áreas (duplicadas, principal, carrera requerida, turnos).
  - Validación de datos personales y vigencia de visitantes.
  - Pureza: `shared/src` sin imports prohibidos.
- Servicio de acceso con un `FakeAccessRepo` en memoria:
  - Entrada, salida, repetida dentro de 15 s, entrada de ayer, visitante, matrícula inexistente, vehículo sin placas, folio vencido.
- `backend/test/salud.test.js`: `node:test` + `fetch` sobre `app.listen(0)`.
- Integración opcional contra MySQL del contenedor con `TEST_DB=1`.

#### 1.5 Verificación manual

1. `pnpm db:up` y cargar `db/schema.sql`.
2. `pnpm start` y repetir los flujos actuales: entrada/salida, lector vehicular, visitante, QR inválido, notificaciones.
3. `pnpm dev:back` y `curl localhost:3000/salud`.
4. `pnpm test` en verde.

#### Criterios de aceptación Fase 0–1

- La app Electron arranca y se comporta **exactamente igual** que antes.
- Raíz con `frontend/`, `backend/`, `shared/`, `db/`, `worker/`.
- `shared/` no depende de Electron ni de MySQL.
- `backend` Express levanta y responde `/salud`.
- Servicio de acceso probado con repo falso; repo MySQL implementado y probado.
- No se modifican el esquema de BD ni las vistas del renderer en estas fases.

#### Riesgos Fase 0–1

| Riesgo | Mitigación |
|---|---|
| Rutas rotas al mover `src` | Mover `src` completo; smoke test |
| `.env` fuera de lugar | Va a `frontend/.env`; `config.js` ya resuelve ahí |
| Módulos nativos con pnpm | `.npmrc` con `node-linker=hoisted` + `@electron/rebuild` |
| Duplicar reglas frontend/backend | Todo lo puro a `shared/`; el frontend solo envuelve |
| Imports cruzados front/back | Backend usa repo MySQL; frontend conserva su MySQL temporal |
| Lockfiles mezclados | Usar solo `pnpm-lock.yaml` y eliminar `package-lock.json` |
| CodeGraph desactualizado | Reindexar después de la reestructuración |

### Fase 2 — Cliente offline-first (2–3 semanas)

- SQLite local (`node:sqlite`), snapshot desde MySQL cada 5 min, outbox, decisión local y antirrebote.
- Pipeline de ráfagas con cola secuencial y cierre local.
- Snapshot y replay temporales vía MySQL directo (el transporte se cambia a HTTP en Fase 3).
- Simulador de 3 escáneres (sin hardware) para pruebas de carga y offline.
- *Salida:* registra 10/s, opera 12 h sin red y no duplica al reconectar.
- **Detalle completo en la sección 6.1.**

### Fase 3 — Backend Express + sync (2–3 semanas)

- Express, `cookie-session`, auth de dispositivo con API key, `/sync/accesos`, `/sync/datos`.
- Idempotencia, jobs (cierre, respaldo, confirmaciones), PDFs, SSE.
- Despliegue temprano a staging.
- *Salida:* ingesta por lotes probada con outbox real; cierre y respaldos en servidor.

### Fase 4 — Cliente Electron final (2–3 semanas)

- Preload + `nodeIntegration:false`.
- Recablear las 20 vistas a la API (admin online).
- Modo lector: COM local, cámara, calibración local, indicador offline/pendientes.
- *Salida:* admin contra la API; lector contra SQLite + sync.

### Fase 5 — Endurecimiento y corte (1–2 semanas)

- Carga de 12 h simulada, chaos de red, rollover de día, cierre offline.
- TLS, firewall, MySQL en localhost, backups externos, `TZ`.
- Instalador Windows (`electron-builder`, rebuild de `serialport`; `better-sqlite3` solo si se usó como respaldo).
- Migración del dump, copia del `QR_SECRETO`, piloto y producción.
- *Salida:* operación real con plan de reversa.

**Esfuerzo estimado:** 10–14 semanas de una persona; Fases 1–2 son las de mayor riesgo.

### 6.1 Plan detallado Fase 2 — Cliente offline-first

**Decisiones aplicadas:**

- Origen del snapshot y destino del replay: **MySQL directo temporal** (el frontend aún tiene pool de MySQL). El transporte queda detrás de una interfaz para sustituirlo por HTTP en la Fase 3.
- Driver SQLite: **`node:sqlite` (`DatabaseSync`)**. Primer paso: verificar que Electron 44 expone `require('node:sqlite')`; si no, se usa `better-sqlite3` como respaldo sin cambiar el diseño (el driver queda abstraído).
- Cierre MySQL: se mantiene **gateado por conexión**; el cierre local corre siempre.
- Snapshot: completo, de todos los usuarios y visitantes vigentes, **cada 5 minutos**.

**Alcance:** solo el lector opera offline. El admin sigue online y leyendo MySQL directo. No se recablean vistas ni se implementa aún la API HTTP de administración.

#### Arquitectura de la fase

```
COM / cámara / teclado HID
        │
        ▼
  cola de lecturas (main, secuencial)
        │
        ▼
  crearServicioAcceso() de @ssa/shared
        │
        ├─ repo SQLite (transacción LOCAL)
        │    ├─ registro_local
        │    └─ outbox (ENTRADA/SALIDA/CIERRE/FALLIDO)
        │
        └─ publicar al renderer (inmediato, sin red)

  sync worker (segundo plano)
        ├─ outbox ──► transporte MySQL directo (temporal)
        └─ snapshot ◄── MySQL directo (cada 5 min / al reconectar)

  admin (vistas actuales) ──► MySQL directo (solo online)
```

La red **nunca** se espera en el camino de un escaneo.

#### Componentes y archivos

| Archivo | Responsabilidad |
|---|---|
| `frontend/src/main/offline/db.js` | Abrir `DatabaseSync`, pragmas (`WAL`, `busy_timeout`), migraciones por `user_version`, mutex de escrituras y helper de transacción |
| `frontend/src/main/offline/esquema.js` | Crear tablas e índices de la versión 1 |
| `frontend/src/main/offline/sqliteAccessRepo.js` | Contrato del repo sobre SQLite; inserta registro + outbox en la misma transacción |
| `frontend/src/main/offline/cola.js` | Cola secuencial de lecturas, sin pérdida y con orden |
| `frontend/src/main/offline/snapshot.js` | Leer snapshot de MySQL, calcular firmas y aplicarlo a SQLite |
| `frontend/src/main/offline/transporte.js` | Interfaz `aplicarEventos` + `probarConexion` |
| `frontend/src/main/offline/transporteMySQL.js` | Replay temporal a MySQL, idempotente |
| `frontend/src/main/offline/sync.js` | Worker de subida/bajada, lotes, backoff y estado |
| `frontend/src/main/offline/cierreLocal.js` | Cierre local por hora y recuperación de días anteriores |
| `frontend/src/main/offline/estado.js` | Estado `{online, pendientes, snapshotTs, ultimaSync, error}` y broadcast IPC |
| `frontend/src/main/acceso.js` | Adaptador: crea el servicio compartido con repo SQLite, cola y callbacks locales |
| `frontend/src/main/main.js` | Inicializa offline antes de abrir lectores; arranca sync y cierre local |
| `frontend/src/renderer/views/qrlector.html` | Elemento de estado de sincronización |
| `frontend/src/renderer/js/qrlector.js` | Conexión, antigüedad del snapshot y pendientes |
| `frontend/test/offline/*.test.js` | Pruebas de SQLite, repo, cola, snapshot, outbox, cierre y carga |
| `db/migraciones/2026-11-23_sync_uuid.sql` | `registroacceso.uuid` y `sync_evento` |
| `frontend/package.json` | Script `test`; sin dependencia nativa si `node:sqlite` está disponible |
| `shared/src/acceso.js` | Ajuste menor para mensajes offline (`SIN_DATOS`, “no disponible sin conexión”) |

#### Esquema SQLite (versión 1)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 3000;

usuario_local(
  matricula INTEGER PRIMARY KEY,
  nombre TEXT, apellido_paterno TEXT, apellido_materno TEXT,
  estatus TEXT, firma_qr TEXT, area_principal TEXT, actualizado_en TEXT
);

vehiculo_local(
  matricula INTEGER NOT NULL,
  placa TEXT NOT NULL,
  PRIMARY KEY (matricula, placa)
);

visitante_local(
  id_visitante INTEGER PRIMARY KEY,
  codigo_acceso TEXT UNIQUE NOT NULL,
  nombre TEXT, apellido_paterno TEXT, apellido_materno TEXT,
  tipo TEXT, motivo TEXT, vigente_hasta TEXT, actualizado_en TEXT
);

registro_local(
  uuid TEXT PRIMARY KEY,
  matricula INTEGER,
  id_visitante INTEGER,
  entrada_utc TEXT NOT NULL,
  salida_utc TEXT,
  medio_entrada TEXT,
  medio_salida TEXT,
  cierre_automatico_utc TEXT,
  sync_estado TEXT NOT NULL DEFAULT 'PENDIENTE'
);

outbox(
  uuid TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,          -- ENTRADA|SALIDA|CIERRE|ACCESO_FALLIDO
  payload TEXT NOT NULL,       -- JSON
  creado_en TEXT NOT NULL,
  intentos INTEGER NOT NULL DEFAULT 0,
  ultimo_error TEXT,
  estado TEXT NOT NULL DEFAULT 'PENDIENTE'  -- PENDIENTE|ENVIADO
);

meta(clave TEXT PRIMARY KEY, valor TEXT);
-- snapshot_ts, config (JSON), ultimo_cierre_local, dispositivo
```

Índices: `registro_local(matricula, entrada_utc)`, `registro_local(id_visitante, entrada_utc)`, `outbox(estado, creado_en)`, `visitante_local(codigo_acceso)`.

Fechas en **ISO 8601 UTC**; la hora local se usa solo para reglas de “hoy” y presentación. No se guarda `QR_SECRETO` en SQLite: solo la firma precalculada por usuario.

#### Flujo de una lectura (ráfaga)

1. `lectores.js` recibe la lectura y llama al adaptador; este la **encola** y devuelve una promesa.
2. La cola procesa **una lectura a la vez**:
   - `crearServicioAcceso` valida QR/folio con `firmaDeMatricula` (sin secreto).
   - Aplica antirrebote local (8 s por lector) y lectura repetida global (15 s).
   - Abre una transacción SQLite (`BEGIN IMMEDIATE`):
     - busca usuario/placas/área;
     - decide entrada/salida;
     - inserta/actualiza `registro_local`;
     - inserta el evento en `outbox` **en la misma transacción**;
     - actualiza estatus local.
   - Hace `COMMIT` y publica el resultado al renderer.
3. La cola no espera al sync; el worker de red corre aparte.
4. Si la cola supera un umbral (p. ej. 50), se registra una advertencia; no se descartan lecturas.

#### Repositorio SQLite

Implementa el mismo contrato que `backend/src/repos/accessRepo.js`:

- `conTransaccion(fn)`: `BEGIN IMMEDIATE` + mutex global, `COMMIT`/`ROLLBACK`.
- `obtenerUsuarioParaAcceso`, `obtenerPlacas`, `obtenerAreaPrincipal`.
- `ultimoMovimientoUsuario` y `entradaAbiertaUsuario` (segundos calculados en JS desde ISO UTC).
- `crearEntradaUsuario`: inserta `registro_local` **y** outbox `ENTRADA`.
- `cerrarEntradaUsuario`: actualiza `salida_utc` **y** outbox `SALIDA` (con `registro_uuid`).
- `marcarCierreAutomatico`: actualiza `cierre_automatico_utc` **y** outbox `CIERRE`.
- `actualizarEstatusUsuario`: actualiza `usuario_local.estatus`.
- Equivalentes para visitantes.
- `buscarUsuario`: lectura local (la pantalla de placas del admin sigue usando MySQL).

El outbox se escribe dentro de la transacción del movimiento para que un corte de energía no pierda el evento.

#### Snapshot

**Fuente (Fase 2):**
- Usuarios: `SELECT matricula, nombre, apellidos, estatus FROM usuario`.
- Vehículos: `SELECT matricula, placa FROM vehiculo`.
- Áreas: consulta masiva `usuario_area` + turnos; `agruparAreas` + `areaPrincipal` de `@ssa/shared`.
- Visitantes: solo vigentes (`vigente_hasta >= NOW()`).
- Firmas: `firmaConSecreto(matricula, QR_SECRETO)` para cada usuario; solo se guarda la firma.
- Config: `antirreboteSegundos`, `intervaloMinimoSegundos`, `CIERRE_HORA`, `QR_ACEPTAR_SIN_FIRMA`.

**Aplicación:**
- Una transacción: `DELETE` de las tres tablas espejo + `INSERT` con sentencias preparadas.
- No toca `registro_local` ni `outbox`.
- Actualiza `meta.snapshot_ts` y `meta.config`.
- Si falla, conserva el snapshot anterior y marca offline.

**Frecuencia:** al iniciar (con timeout de ~5 s), al reconectar y **cada 5 minutos** mientras haya conexión. Snapshot completo en Fase 2; deltas en Fase 3.

**UI:** si `snapshot_ts` no existe, el lector muestra “Sin datos locales; conecta a la red”. Si tiene más de 12 h, muestra la antigüedad.

#### Outbox y sincronización

**Evento (JSON en `outbox.payload`):**
```json
{
  "uuid": "evento-uuid",
  "tipo": "ENTRADA|SALIDA|CIERRE|ACCESO_FALLIDO",
  "entidad": "USUARIO|VISITANTE",
  "matricula": 123,
  "id_visitante": null,
  "registro_uuid": "uuid-de-la-entrada",
  "fecha": "2026-11-23T16:00:00.000Z",
  "medio": "PEATONAL|VEHICULAR|null",
  "origen": "serial|camara|teclado|folio",
  "lector": "PEATONAL|ENTRADA_VEHICULAR|SALIDA_VEHICULAR|null",
  "avisos": ["..."],
  "texto": null,
  "tipoError": null,
  "descripcion": null
}
```

- Al cerrar una entrada de día anterior y crear la nueva, se encolan **CIERRE y luego ENTRADA**.
- El sync lee `ORDER BY creado_en, rowid` y envía lotes de 200–500.
- Al confirmar, marca `ENVIADO`; si falla, incrementa `intentos`, guarda `ultimo_error` y reintenta con backoff (1 s → 60 s).
- Disparo: tras cada escaneo (debounce ~500 ms) si está online; si no, cada 30 s.

**Transporte Fase 2 (MySQL directo):**
- `sync_evento(uuid PK)` para deduplicar.
- `ENTRADA`: inserta en `registroacceso` con `uuid`.
- `SALIDA`/`CIERRE`: actualiza por `registro_uuid`; si no existe, devuelve conflicto y se reintenta.
- `ACCESO_FALLIDO`: inserta en `accesos_fallidos` (deduplicado por `sync_evento`).
- Si el evento trae `avisos`, inserta `notificacion` con la fecha del evento.
- Todo en una transacción MySQL; si una parte falla, no se marca el lote.

**Migración MySQL:**
```sql
ALTER TABLE registroacceso ADD COLUMN uuid CHAR(36) NULL UNIQUE;
CREATE TABLE sync_evento (
  uuid CHAR(36) PRIMARY KEY,
  tipo VARCHAR(30) NOT NULL,
  recibido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

En Fase 3, el transporte se sustituye por `POST /sync/accesos` y el snapshot por `GET /sync/datos`; la interfaz y el outbox no cambian.

#### Cierre local

`cierreLocal.js` corre al iniciar y cada minuto:

1. **Recuperación:** cierra entradas con `entrada_utc < inicioDeHoy` y `salida_utc/cierre_automatico_utc` nulos; encola `CIERRE`.
2. **Programado:** si `ahora >= CIERRE_HORA` y `meta.ultimo_cierre_local != hoy`, cierra las entradas abiertas y encola `CIERRE`; actualiza `meta`.

No genera PDFs ni notificaciones locales. El `cierreDiario.js` de MySQL se mantiene para el modo online, gateado por `estado.online`; ambos cierres son idempotentes. En Fase 3 el backend asume el cierre oficial.

#### Integración en el arranque

- `setupAcceso(pool)` abre SQLite, crea el repo y el servicio, registra IPC y arranca la cola.
- `main.js` ejecuta `revisarCierreLocal` antes de `setupLectores()`.
- El snapshot inicial se intenta en segundo plano con timeout; si no hay red, se usa el último snapshot.
- `setupCierreDiario(pool)` se mantiene, pero no bloquea la apertura de lectores y se salta si `estado.online` es falso.
- Al salir: detener intervalos y `db.close()`; no bloquear esperando red.

#### UI del lector

- Añadir `#estado-sync` en `qrlector.html` (junto al reloj).
- `qrlector.js` escucha `estado-sincronizacion` y muestra:
  - `En línea · datos al 23/11 10:00 · 0 pendientes`
  - `Sin conexión · datos al 23/11 08:00 · 27 pendientes`
- En rechazos por matrícula/folio no encontrado **estando offline**, mensaje: `No disponible sin conexión; consulta con administración`.
- Opcional: botón “Sincronizar ahora” para pruebas.

#### Pruebas de la fase

- SQLite: esquema, pragmas, transacciones y serialización de escrituras.
- Repo: entrada/salida, cierre de día anterior, visitantes, atomicidad registro+outbox.
- Servicio local: mismos casos que `shared/test/acceso.test.js` con repo SQLite; QR con `firmaDeMatricula`; mensajes offline.
- Cola: 100–1.000 lecturas con orden preservado y sin pérdidas.
- Snapshot: aplicar snapshot, firmas, áreas, vehículos, visitantes; conservar registro/outbox.
- Outbox/sync: lotes, idempotencia, reintentos, conflictos y corte a la mitad.
- Cierre local: hora programada, recuperación tras app apagada, sin duplicar cierres.
- Carga: simulación de 10/s durante un periodo acotado; verificar conteos y orden.
- Simulador de 3 escáneres encolando lecturas en paralelo, verificando orden y ausencia de pérdidas.
- Integración opcional (MySQL/Docker): snapshot real y replay con `sync_evento`.
- Actualizar el script raíz `pnpm test` para incluir el frontend.

#### Criterios de aceptación

- El lector registra entradas/salidas **sin red** y responde en milisegundos.
- Con MySQL/internet caídos, opera 12 h; al reiniciar la app conserva pendientes.
- Al reconectar, los eventos se aplican **sin duplicados** y en orden.
- 10 escaneos/s sostenidos sin pérdidas.
- Cierre local correcto a las 20:00 y tras reinicio al día siguiente.
- QR verificado offline con firmas sincronizadas, **sin `QR_SECRETO` en SQLite**.
- Usuario/visitante no presente en el snapshot offline muestra el mensaje correcto.
- El admin online sigue funcionando igual.
- `pnpm test` en verde.

#### Riesgos de la fase

| Riesgo | Mitigación |
|---|---|
| `node:sqlite` no disponible en Electron 44 | Verificarlo en el primer paso; fallback a `better-sqlite3` con `@electron/rebuild` |
| Snapshot obsoleto (altas online) | Mensaje explícito, antigüedad visible, refresh al reconectar |
| Outbox grande tras 12 h | Lotes, índices, purga de `ENVIADO`, backoff |
| Duplicados al reintentar | `uuid` + `sync_evento` + orden por `rowid` |
| Bloqueo del main por snapshot | Transacción rápida y preparada; aplicación acotada |
| Cierre local vs cierre MySQL | Ambos idempotentes; gatear el MySQL por conexión |
| Pérdida de eventos si falla la PC | SQLite WAL; respaldo periódico opcional del archivo/outbox |
| Reloj/zona horaria | ISO UTC en SQLite; conversión explícita a hora local para MySQL |
| Datos personales en SQLite | ACL/DPAPI del usuario de Windows; SQLCipher opcional |

#### Estimación

**2–3 semanas** de una persona:

- SQLite + repo + cola + servicio local: 4–6 días.
- Snapshot + outbox + sync + transporte MySQL: 4–5 días.
- Cierre local + UI + integración: 2–3 días.
- Pruebas y carga: 3–4 días.

---

## 7. Pruebas obligatorias

- **Fase 0–1:** suite de `shared`, `/salud` del backend, smoke test de la app actual, pureza de `shared`, repo falso del servicio de acceso.
- **Fase 2:** repo SQLite, cola de lecturas, snapshot/aplicación, outbox (idempotencia, reintentos, conflictos), cierre local, mensajes offline y prueba de 10/s.
- **Ráfaga:** 3 lectores a 5–10/s durante horas; sin pérdidas ni duplicados.
- **Offline 12 h:** cerrar y reabrir la app, cambiar de día, cierre a las 20:00, reconectar.
- **Idempotencia:** reenviar lotes duplicados y fuera de orden.
- **Datos obsoletos:** usuario/visitante creado online mientras la caseta está offline → mensaje correcto.
- **Seguridad:** QR falsificado, QR sin firma, folio vencido, API key inválida, cookie de sesión manipulada.
- **Resiliencia:** matar la red, reiniciar el cliente, reloj cambiado, disco lleno.
- **Regresión:** todos los flujos actuales del README (accesos, visitantes, cierre, reportes, respaldos).

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Pérdida de eventos offline si falla la PC | Respaldo periódico del SQLite/outbox; UPS; sincronizar en cuanto haya red |
| Outbox enorme tras 12 h | Lotes, backoff, purga de enviados, índices |
| Snapshot viejo (usuarios nuevos no existen offline) | Mensaje explícito + aviso de antigüedad; sync al iniciar |
| Cierre oficial incompleto si se estaba offline a las 20:00 | Cierre local + reconciliación/aviso al recibir eventos tardíos |
| Reloj/zona horaria | UTC en transporte + TZ `America/Mexico_City` en ambos lados + NTP |
| Secreto/firma QR | Firmas precalculadas; el secreto nunca sale del backend |
| Datos personales en SQLite | ACL/DPAPI del usuario de Windows; SQLCipher opcional |
| Módulos nativos en Electron/pnpm | `.npmrc` con `node-linker=hoisted`; `node:sqlite` evita rebuild; `serialport` usa prebuilds N-API |
| `node:sqlite` ausente en Electron 44 | Verificarlo antes de implementar; fallback a `better-sqlite3` + `@electron/rebuild` |
| Replay temporal por MySQL directo | Interfaz `transporte`; en Fase 3 se sustituye por HTTP sin tocar el outbox |
| API expuesta a internet | TLS, rate limit, validación, MySQL en localhost, firewall |
| Duplicados por timeout tras commit | Idempotencia por `uuid` + antirrebote |
| Sesión admin robada | `cookie-session` con `httpOnly`, `sameSite`, `secure` en producción y `SESSION_SECRET` fuerte |

---

## 9. Supuestos

1. El modo administrador requiere conexión; solo el lector funciona offline.
2. El admin puede estar en la misma PC o en otra; da igual porque es online.
3. El `QR_SECRETO` actual se **copia tal cual** al backend para no invalidar credenciales.
4. Desarrollo con MySQL en Docker; producción Linux con Docker Compose o systemd, indiferente.
5. El worker de confirmaciones de Cloudflare no se modifica.
6. El cierre local se ejecuta mientras la app esté corriendo; si está apagada a la hora del cierre, se recupera al arrancar.
7. Gestor de paquetes único: **pnpm**; se elimina `package-lock.json`.
8. Comunicación CommonJS en todo el monorepo.
9. SQLite con **`node:sqlite`**; `better-sqlite3` queda solo como respaldo si Electron 44 no lo expone.
10. En Fase 2 el snapshot y el replay usan **MySQL directo temporal**; el transporte se cambia a HTTP en Fase 3.
11. Snapshot completo de todos los usuarios y visitantes vigentes **cada 5 minutos**.
12. El cierre MySQL se mantiene **gateado por conexión**; el cierre local corre siempre.

---

## 9.1 Estado de implementación Fase 0–1

- **Monorepo pnpm** con `frontend/`, `backend/`, `shared/`, `db/` y `worker/`; `.npmrc` con `node-linker=hoisted`.
- **`shared/`**: reglas de acceso, QR, áreas, validación, visitantes, fechas y antirrebote; sin Electron ni MySQL.
- **`backend/`**: Express + `cookie-session`, `GET /salud`, pool de MySQL, repositorios `accessRepo` y `areasRepo`, contrato del repo y pruebas.
- **`frontend/`**: Electron movido a `frontend/src`; `acceso.js`, `areas.js`, `validacion.js`, `qrFirmado.js`, `visitantes.js`, `cierreDiario.js` y `registro.js` usan `@ssa/shared` sin cambiar comportamiento.
- **Pruebas:** `pnpm test` en verde (34 pruebas de `shared` + 5 de `backend`).
- **Verificación pendiente:** arranque manual de Electron en Windows con los tres puertos COM. El entorno de desarrollo actual no tiene las librerías gráficas para abrir Electron, así que no se pudo hacer el smoke test visual.
- **Fase 2 planificada:** SQLite con `node:sqlite`, snapshot/replay temporales por MySQL, outbox, cola de ráfagas, cierre local y UI de conexión. Detalle en la sección 6.1; inicio pendiente de indicación.

---

## 10. Siguiente paso

**Fase 0–1 completada.** Queda hecho:

1. Repo reestructurado a `frontend/`, `backend/`, `shared/` con pnpm.
2. Esqueleto Express con `GET /salud`.
3. Dominio extraído a `shared/` y repo MySQL del acceso en `backend/`.
4. Frontend adaptado sin cambiar comportamiento.
5. `pnpm test` en verde (dominio, servicio de acceso, `/salud` y contrato del repo).

**Fase 2 planificada, pendiente de indicación del responsable.** El detalle está en la sección 6.1; cuando se autorice, el trabajo empieza por verificar `node:sqlite` en Electron y sigue con SQLite local, snapshot, outbox, sync temporal por MySQL y cierre local.
