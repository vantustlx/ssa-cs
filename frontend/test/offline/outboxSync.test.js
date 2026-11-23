const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDb } = require('../../src/main/offline/db');
const { crearEsquema } = require('../../src/main/offline/esquema');
const { crearEstado } = require('../../src/main/offline/estado');
const { crearSync } = require('../../src/main/offline/sync');

function transporte({ falla = false, conflicto = false } = {}) {
  return {
    async probarConexion() {
      return !falla;
    },
    async aplicarEventos(eventos) {
      if (falla) throw new Error('sin conexión');
      if (conflicto) {
        return { aplicados: [], conflictos: eventos.map((e) => ({ uuid: e.uuid, motivo: 'entrada no encontrada' })) };
      }
      return { aplicados: eventos.map((e) => e.uuid), conflictos: [] };
    }
  };
}

function preparar() {
  const offlineDb = crearDb();
  crearEsquema(offlineDb.db);
  const estado = crearEstado(offlineDb);
  return { offlineDb, estado };
}

function insertarEvento(offlineDb, uuid, tipo = 'ENTRADA') {
  const payload = { uuid, tipo, entidad: 'USUARIO', matricula: 123, fecha: new Date().toISOString() };
  offlineDb.db.prepare(
    'INSERT INTO outbox (uuid, tipo, payload, creado_en, estado) VALUES (?, ?, ?, ?, ?)'
  ).run(uuid, tipo, JSON.stringify(payload), new Date().toISOString(), 'PENDIENTE');
}

test('marca los eventos como ENVIADO tras una sincronización correcta', async () => {
  const { offlineDb, estado } = preparar();
  try {
    insertarEvento(offlineDb, 'e1');
    insertarEvento(offlineDb, 'e2', 'SALIDA');
    const sync = crearSync({
      offlineDb,
      estado,
      transporte: transporte(),
      cargarSnapshot: async () => null,
      aplicarSnapshot: async () => {}
    });
    await sync.ejecutar({ forzarSnapshot: true });
    const filas = offlineDb.db.prepare('SELECT uuid, estado, intentos FROM outbox ORDER BY uuid').all()
      .map((fila) => ({ ...fila }));
    assert.deepEqual(filas, [
      { uuid: 'e1', estado: 'ENVIADO', intentos: 1 },
      { uuid: 'e2', estado: 'ENVIADO', intentos: 1 }
    ]);
  } finally {
    offlineDb.cerrar();
  }
});

test('deja pendiente y registra el error si el transporte falla', async () => {
  const { offlineDb, estado } = preparar();
  try {
    insertarEvento(offlineDb, 'e1');
    const sync = crearSync({
      offlineDb,
      estado,
      transporte: {
        probarConexion: async () => true,
        aplicarEventos: async () => { throw new Error('sin conexión'); }
      },
      cargarSnapshot: async () => null,
      aplicarSnapshot: async () => {}
    });
    await sync.ejecutar();
    const fila = offlineDb.db.prepare('SELECT estado, intentos, ultimo_error FROM outbox WHERE uuid = ?').get('e1');
    assert.equal(fila.estado, 'PENDIENTE');
    assert.equal(fila.intentos, 1);
    assert.match(fila.ultimo_error, /sin conexión/);
  } finally {
    offlineDb.cerrar();
  }
});

test('deja pendiente un evento con conflicto', async () => {
  const { offlineDb, estado } = preparar();
  try {
    insertarEvento(offlineDb, 'e1', 'SALIDA');
    const sync = crearSync({
      offlineDb,
      estado,
      transporte: transporte({ conflicto: true }),
      cargarSnapshot: async () => null,
      aplicarSnapshot: async () => {}
    });
    await sync.ejecutar();
    const fila = offlineDb.db.prepare('SELECT estado, intentos, ultimo_error FROM outbox WHERE uuid = ?').get('e1');
    assert.equal(fila.estado, 'PENDIENTE');
    assert.equal(fila.intentos, 1);
    assert.equal(fila.ultimo_error, 'entrada no encontrada');
  } finally {
    offlineDb.cerrar();
  }
});

test('aplica el snapshot cuando toca', async () => {
  const { offlineDb, estado } = preparar();
  try {
    let aplicados = 0;
    const sync = crearSync({
      offlineDb,
      estado,
      transporte: transporte(),
      cargarSnapshot: async () => ({ generadoEn: '2026-11-23T16:00:00.000Z', usuarios: [], vehiculos: [], visitantes: [], config: {} }),
      aplicarSnapshot: async () => { aplicados += 1; }
    });
    await sync.ejecutar({ forzarSnapshot: true });
    assert.equal(aplicados, 1);
    assert.equal(estado.estado.snapshotTs, '2026-11-23T16:00:00.000Z');
  } finally {
    offlineDb.cerrar();
  }
});
