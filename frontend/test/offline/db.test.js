const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDb } = require('../../src/main/offline/db');
const { crearEsquema, VERSION } = require('../../src/main/offline/esquema');

test('crea el esquema y marca la versión', () => {
  const offlineDb = crearDb();
  try {
    crearEsquema(offlineDb.db);
    const version = offlineDb.db.prepare('PRAGMA user_version').get().user_version;
    assert.equal(Number(version), VERSION);
    const tablas = offlineDb.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      .map((fila) => fila.name);
    for (const nombre of ['usuario_local', 'vehiculo_local', 'visitante_local', 'registro_local', 'outbox', 'meta']) {
      assert.ok(tablas.includes(nombre), `falta la tabla ${nombre}`);
    }
  } finally {
    offlineDb.cerrar();
  }
});

test('la transacción hace rollback si el callback falla', async () => {
  const offlineDb = crearDb();
  crearEsquema(offlineDb.db);
  try {
    await assert.rejects(() => offlineDb.transaccion((tx) => {
      tx.prepare('INSERT INTO meta (clave, valor) VALUES (?, ?)').run('prueba', '1');
      throw new Error('fallo intencional');
    }), /fallo intencional/);
    assert.equal(offlineDb.db.prepare('SELECT valor FROM meta WHERE clave = ?').get('prueba'), undefined);
  } finally {
    offlineDb.cerrar();
  }
});

test('serializa transacciones concurrentes', async () => {
  const offlineDb = crearDb();
  crearEsquema(offlineDb.db);
  try {
    const orden = [];
    await Promise.all([
      offlineDb.transaccion(async (tx) => {
        orden.push('inicio-1');
        await new Promise((resolve) => setTimeout(resolve, 5));
        tx.prepare('INSERT INTO meta (clave, valor) VALUES (?, ?)').run('a', '1');
        orden.push('fin-1');
      }),
      offlineDb.transaccion((tx) => {
        orden.push('inicio-2');
        tx.prepare('INSERT INTO meta (clave, valor) VALUES (?, ?)').run('b', '2');
        orden.push('fin-2');
      })
    ]);
    assert.deepEqual(orden, ['inicio-1', 'fin-1', 'inicio-2', 'fin-2']);
    assert.equal(offlineDb.db.prepare('SELECT COUNT(*) AS total FROM meta').get().total, 2);
  } finally {
    offlineDb.cerrar();
  }
});
