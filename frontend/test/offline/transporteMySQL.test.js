process.env.TZ = 'America/Mexico_City';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aMysqlDatetime, crearTransporteMySQL } = require('../../src/main/offline/transporteMySQL');
const { cumpleContratoTransporte } = require('../../src/main/offline/transporte');

test('convierte el ISO UTC a hora local de MySQL', () => {
  assert.equal(aMysqlDatetime('2026-11-23T16:00:00.000Z'), '2026-11-23 10:00:00');
});

test('probarConexion devuelve true o false sin lanzar', async () => {
  const correcto = crearTransporteMySQL({ query: async () => [[{ ok: 1 }]] });
  assert.equal(await correcto.probarConexion(), true);

  const fallido = crearTransporteMySQL({
    query: async () => { throw new Error('MySQL no disponible'); }
  });
  assert.equal(await fallido.probarConexion(), false);
});

test('el transporte MySQL cumple el contrato', () => {
  const transporte = crearTransporteMySQL({});
  assert.deepEqual(cumpleContratoTransporte(transporte), []);
});
