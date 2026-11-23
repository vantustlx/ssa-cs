process.env.TZ = 'America/Mexico_City';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDb } = require('../../src/main/offline/db');
const { crearEsquema } = require('../../src/main/offline/esquema');
const { crearSqliteAccessRepo } = require('../../src/main/offline/sqliteAccessRepo');
const { crearCierreLocal } = require('../../src/main/offline/cierreLocal');

function preparar(fecha) {
  const offlineDb = crearDb();
  crearEsquema(offlineDb.db);
  const repo = crearSqliteAccessRepo(offlineDb);
  const cierre = crearCierreLocal({
    offlineDb,
    repo,
    config: { cierre: { hora: '20:00' } },
    ahora: () => new Date(fecha)
  });

  const insertar = offlineDb.db.prepare(
    `INSERT INTO registro_local
       (uuid, matricula, id_visitante, entrada_utc, salida_utc, medio_entrada, medio_salida, cierre_automatico_utc, sync_estado)
     VALUES (?, 123, NULL, ?, ?, 'PEATONAL', ?, NULL, 'PENDIENTE')`
  );
  insertar.run('vieja', '2026-11-22T09:00:00.000Z', null, null);
  insertar.run('hoy', '2026-11-23T09:00:00.000Z', null, null);
  insertar.run('cerrada', '2026-11-23T08:00:00.000Z', '2026-11-23T12:00:00.000Z', 'PEATONAL');

  return { offlineDb, repo, cierre };
}

test('cierra entradas de días anteriores y las del cierre programado sin duplicar', async () => {
  const { offlineDb, cierre } = preparar('2026-11-23T21:00:00-06:00');
  try {
    const resultado = await cierre.revisar();
    assert.equal(resultado.recuperacion, 1);
    assert.equal(resultado.programado, 1);

    const filas = offlineDb.db.prepare('SELECT uuid, cierre_automatico_utc FROM registro_local ORDER BY uuid').all();
    const porUuid = Object.fromEntries(filas.map((f) => [f.uuid, f.cierre_automatico_utc]));
    assert.ok(porUuid.vieja);
    assert.ok(porUuid.hoy);
    assert.equal(porUuid.cerrada, null);

    assert.equal(offlineDb.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE tipo = 'CIERRE'").get().n, 2);
    assert.equal(
      offlineDb.db.prepare('SELECT valor FROM meta WHERE clave = ?').get('ultimo_cierre_local').valor,
      '2026-11-23'
    );

    await cierre.revisar();
    assert.equal(offlineDb.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE tipo = 'CIERRE'").get().n, 2);
  } finally {
    offlineDb.cerrar();
  }
});

test('antes de la hora de cierre solo recupera días anteriores', async () => {
  const { offlineDb, cierre } = preparar('2026-11-23T09:00:00-06:00');
  try {
    const resultado = await cierre.revisar();
    assert.equal(resultado.recuperacion, 1);
    assert.equal(resultado.programado, 0);

    const vieja = offlineDb.db.prepare("SELECT cierre_automatico_utc FROM registro_local WHERE uuid = 'vieja'").get();
    const hoy = offlineDb.db.prepare("SELECT cierre_automatico_utc FROM registro_local WHERE uuid = 'hoy'").get();
    assert.ok(vieja.cierre_automatico_utc);
    assert.equal(hoy.cierre_automatico_utc, null);
    assert.equal(offlineDb.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE tipo = 'CIERRE'").get().n, 1);
  } finally {
    offlineDb.cerrar();
  }
});
