// esquema.js — esquema SQLite del lector, versionado con PRAGMA user_version
const VERSION = 1;

const TABLAS = `
  CREATE TABLE IF NOT EXISTS usuario_local (
    matricula INTEGER PRIMARY KEY,
    nombre TEXT,
    apellido_paterno TEXT,
    apellido_materno TEXT,
    estatus TEXT,
    firma_qr TEXT,
    area_principal TEXT,
    actualizado_en TEXT
  );

  CREATE TABLE IF NOT EXISTS vehiculo_local (
    matricula INTEGER NOT NULL,
    placa TEXT NOT NULL,
    PRIMARY KEY (matricula, placa)
  );

  CREATE TABLE IF NOT EXISTS visitante_local (
    id_visitante INTEGER PRIMARY KEY,
    codigo_acceso TEXT UNIQUE NOT NULL,
    nombre TEXT,
    apellido_paterno TEXT,
    apellido_materno TEXT,
    tipo TEXT,
    motivo TEXT,
    vigente_hasta TEXT,
    actualizado_en TEXT
  );

  CREATE TABLE IF NOT EXISTS registro_local (
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

  CREATE TABLE IF NOT EXISTS outbox (
    uuid TEXT PRIMARY KEY,
    tipo TEXT NOT NULL,
    payload TEXT NOT NULL,
    creado_en TEXT NOT NULL,
    intentos INTEGER NOT NULL DEFAULT 0,
    ultimo_error TEXT,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE'  -- PENDIENTE|ENVIADO|ERROR
  );

  CREATE TABLE IF NOT EXISTS meta (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_registro_matricula ON registro_local (matricula, entrada_utc);
  CREATE INDEX IF NOT EXISTS idx_registro_visitante ON registro_local (id_visitante, entrada_utc);
  CREATE INDEX IF NOT EXISTS idx_outbox_pendientes ON outbox (estado, creado_en);
`;

function versionActual(db) {
  const fila = db.prepare('PRAGMA user_version').get();
  return Number(fila && fila.user_version) || 0;
}

function crearEsquema(db) {
  if (versionActual(db) >= VERSION) return;
  db.exec(TABLAS);
  db.exec(`PRAGMA user_version = ${VERSION}`);
}

module.exports = { crearEsquema, VERSION };
