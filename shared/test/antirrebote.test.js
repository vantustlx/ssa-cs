const test = require('node:test');
const assert = require('node:assert/strict');
const { Antirrebote } = require('../src/antirrebote');

test('ignora la misma clave dentro de la ventana y la acepta después', () => {
  const original = Date.now;
  let reloj = 1000;
  Date.now = () => reloj;
  try {
    const anti = new Antirrebote({ ventanaSegundos: 8 });
    assert.equal(anti.repetida('PEATONAL:123'), false);
    reloj += 3000;
    assert.equal(anti.repetida('PEATONAL:123'), true);
    reloj += 9000;
    assert.equal(anti.repetida('PEATONAL:123'), false);
  } finally {
    Date.now = original;
  }
});

test('claves distintas no se afectan entre sí', () => {
  const anti = new Antirrebote({ ventanaSegundos: 8 });
  assert.equal(anti.repetida('a'), false);
  assert.equal(anti.repetida('b'), false);
});

test('limpiar vacía el estado', () => {
  const anti = new Antirrebote({ ventanaSegundos: 8 });
  anti.repetida('a');
  anti.limpiar();
  assert.equal(anti.repetida('a'), false);
});
