const test = require('node:test');
const assert = require('node:assert/strict');
const { METODOS, cumpleContrato } = require('../src/repos/accessRepo');
const { crearAccessRepo } = require('../src/repos/mysql/accessRepo');
const areasRepo = require('../src/repos/mysql/areasRepo');

test('el contrato declara todos los métodos esperados', () => {
  assert.ok(METODOS.includes('conTransaccion'));
  assert.ok(METODOS.includes('obtenerUsuarioParaAcceso'));
  assert.ok(METODOS.includes('crearEntradaUsuario'));
  assert.ok(METODOS.includes('obtenerVisitantePorFolio'));
});

test('el repositorio MySQL cumple el contrato del servicio', () => {
  const repo = crearAccessRepo({});
  assert.deepEqual(cumpleContrato(repo), []);
});

test('el repositorio de áreas expone las consultas necesarias', () => {
  for (const nombre of ['obtenerCatalogos', 'guardarAreas', 'obtenerAreasDeUsuarios', 'adjuntarAreas']) {
    assert.equal(typeof areasRepo[nombre], 'function', `falta ${nombre}`);
  }
});
