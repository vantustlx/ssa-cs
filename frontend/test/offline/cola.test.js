const test = require('node:test');
const assert = require('node:assert/strict');
const { crearCola } = require('../../src/main/offline/cola');

test('procesa en orden aunque se encolen muchas lecturas a la vez', async () => {
  const procesadas = [];
  const cola = crearCola({
    procesar: async (n) => {
      procesadas.push(n);
      return n * 2;
    }
  });

  const resultados = await Promise.all(Array.from({ length: 100 }, (_, i) => cola.encolar(i)));
  assert.deepEqual(procesadas, Array.from({ length: 100 }, (_, i) => i));
  assert.deepEqual(resultados, Array.from({ length: 100 }, (_, i) => i * 2));
});

test('un error no rompe la cola', async () => {
  const procesadas = [];
  const cola = crearCola({
    procesar: async (n) => {
      procesadas.push(n);
      if (n === 1) throw new Error('fallo');
      return n;
    }
  });

  const primera = cola.encolar(1);
  const segunda = cola.encolar(2);
  await assert.rejects(primera, /fallo/);
  assert.equal(await segunda, 2);
  assert.deepEqual(procesadas, [1, 2]);
});
