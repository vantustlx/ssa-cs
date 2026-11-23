const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDb } = require('../../src/main/offline/db');
const { crearEsquema } = require('../../src/main/offline/esquema');
const { crearSnapshot } = require('../../src/main/offline/snapshot');

const CONFIG = {
  lectores: { antirreboteSegundos: 8, intervaloMinimoSegundos: 15 },
  cierre: { hora: '20:00' },
  qr: { aceptarSinFirma: false }
};

function preparar(pool = {}) {
  const offlineDb = crearDb();
  crearEsquema(offlineDb.db);
  return { offlineDb, snapshot: crearSnapshot({ pool, offlineDb, config: CONFIG, firma: (m) => `F-${m}` }) };
}

test('lee el snapshot desde MySQL y calcula firma y área principal', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('FROM usuario_area')) {
        return [[{ matricula: 123, id_usuario_area: 1, id_area: 1, area: 'Estudiante', id_carrera: 1, carrera: 'Computación', principal: 1, id_turno: 1, turno: 'Matutino' }]];
      }
      if (sql.includes('FROM usuario')) {
        return [[{ matricula: 123, nombre: 'Ana', apellido_paterno: 'Pérez', apellido_materno: 'López', estatus: 'Activo' }]];
      }
      if (sql.includes('FROM vehiculo')) {
        return [[{ matricula: 123, placa: 'ABC-123-D' }]];
      }
      if (sql.includes('FROM visitante')) {
        return [[{ id_visitante: 1, codigo_acceso: 'ABC12345', nombre: 'Vis', apellido_paterno: 'Itante', apellido_materno: '', tipo: 'Ocasional', motivo: 'Reunión', vigente_hasta: new Date('2026-12-01T00:00:00Z') }]];
      }
      throw new Error(`SQL no esperado: ${sql}`);
    }
  };
  const { offlineDb, snapshot } = preparar(pool);
  try {
    const datos = await snapshot.leer();
    assert.equal(datos.usuarios.length, 1);
    assert.equal(datos.usuarios[0].firma_qr, 'F-123');
    assert.equal(datos.usuarios[0].area_principal, 'Estudiante');
    assert.deepEqual(datos.vehiculos[0], { matricula: 123, placa: 'ABC-123-D' });
    assert.equal(datos.visitantes[0].codigo_acceso, 'ABC12345');
    assert.equal(datos.config.antirreboteSegundos, 8);
  } finally {
    offlineDb.cerrar();
  }
});

test('aplica el snapshot sin tocar registro_local ni la outbox', async () => {
  const { offlineDb, snapshot } = preparar();
  try {
    offlineDb.db.prepare(
      `INSERT INTO registro_local
         (uuid, matricula, id_visitante, entrada_utc, salida_utc, medio_entrada, medio_salida, cierre_automatico_utc, sync_estado)
       VALUES ('r1', 123, NULL, ?, NULL, 'PEATONAL', NULL, NULL, 'PENDIENTE')`
    ).run(new Date().toISOString());
    offlineDb.db.prepare(
      "INSERT INTO outbox (uuid, tipo, payload, creado_en, estado) VALUES ('o1', 'ENTRADA', '{}', ?, 'PENDIENTE')"
    ).run(new Date().toISOString());

    await snapshot.aplicar({
      generadoEn: '2026-11-23T16:00:00.000Z',
      usuarios: [{ matricula: 123, nombre: 'Ana', apellido_paterno: 'Pérez', apellido_materno: 'López', estatus: 'Activo', firma_qr: 'F-123', area_principal: 'Estudiante' }],
      vehiculos: [{ matricula: 123, placa: 'ABC-123-D' }],
      visitantes: [{ id_visitante: 1, codigo_acceso: 'ABC12345', nombre: 'Vis', apellido_paterno: 'Itante', apellido_materno: '', tipo: 'Ocasional', motivo: 'Reunión', vigente_hasta: '2026-12-01T00:00:00.000Z' }],
      config: CONFIG
    });

    assert.equal(offlineDb.db.prepare('SELECT COUNT(*) AS n FROM usuario_local').get().n, 1);
    assert.equal(offlineDb.db.prepare('SELECT COUNT(*) AS n FROM vehiculo_local').get().n, 1);
    assert.equal(offlineDb.db.prepare('SELECT COUNT(*) AS n FROM visitante_local').get().n, 1);
    assert.equal(offlineDb.db.prepare('SELECT COUNT(*) AS n FROM registro_local').get().n, 1);
    assert.equal(offlineDb.db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n, 1);
    assert.equal(offlineDb.db.prepare('SELECT valor FROM meta WHERE clave = ?').get('snapshot_ts').valor, '2026-11-23T16:00:00.000Z');
  } finally {
    offlineDb.cerrar();
  }
});
