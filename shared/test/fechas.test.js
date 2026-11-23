const test = require('node:test');
const assert = require('node:assert/strict');
const { inicioDeHoy, formatoHora } = require('../src/fechas');

test('inicioDeHoy devuelve la medianoche local', () => {
  const fecha = new Date(2026, 10, 23, 15, 30, 0);
  const inicio = inicioDeHoy(fecha);
  assert.equal(inicio.getFullYear(), 2026);
  assert.equal(inicio.getMonth(), 10);
  assert.equal(inicio.getDate(), 23);
  assert.equal(inicio.getHours(), 0);
  assert.equal(inicio.getMinutes(), 0);
  assert.equal(inicio.getSeconds(), 0);
  assert.equal(inicio.getMilliseconds(), 0);
  assert.equal(fecha.getHours(), 15); // no muta la fecha original
});

test('formatoHora devuelve una cadena localizada', () => {
  const texto = formatoHora(new Date(2026, 10, 23, 15, 30, 0));
  assert.equal(typeof texto, 'string');
  assert.ok(texto.length > 0);
});
