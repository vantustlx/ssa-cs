const test = require('node:test');
const assert = require('node:assert/strict');
const { crearApp } = require('../src/app');

test('GET /salud responde sin necesidad de base de datos', async () => {
  const app = crearApp({ config: { sesion: { secret: 'test-secret' } }, pool: null });
  const servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  try {
    const { port } = servidor.address();
    const respuesta = await fetch(`http://127.0.0.1:${port}/salud`);
    const cuerpo = await respuesta.json();
    assert.equal(respuesta.status, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.servicio, 'ssa-backend');
    assert.equal(cuerpo.db, 'no-configurado');
  } finally {
    servidor.close();
  }
});

test('una ruta desconocida responde 404 en JSON', async () => {
  const app = crearApp({ config: { sesion: { secret: 'test-secret' } }, pool: null });
  const servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  try {
    const { port } = servidor.address();
    const respuesta = await fetch(`http://127.0.0.1:${port}/no-existe`);
    assert.equal(respuesta.status, 404);
    assert.deepEqual(await respuesta.json(), { error: 'Ruta no encontrada' });
  } finally {
    servidor.close();
  }
});
