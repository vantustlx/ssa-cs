const test = require('node:test');
const assert = require('node:assert/strict');
const { contenidoQR, firmaConSecreto, leerQR } = require('../src/qr');

const SECRETO = 'secreto-de-prueba';

test('acepta un QR firmado correctamente', () => {
  const codigo = contenidoQR(20222009, SECRETO);
  assert.deepEqual(leerQR(codigo, { secreto: SECRETO }), { matricula: 20222009 });
});

test('acepta el QR en minúsculas', () => {
  const codigo = contenidoQR(123, SECRETO).toLowerCase();
  assert.deepEqual(leerQR(codigo, { secreto: SECRETO }), { matricula: 123 });
});

test('rechaza una firma manipulada', () => {
  const codigo = contenidoQR(123, SECRETO);
  const manipulado = codigo.slice(0, -1) + (codigo.endsWith('A') ? 'B' : 'A');
  assert.deepEqual(leerQR(manipulado, { secreto: SECRETO }), { error: 'FIRMA_INVALIDA' });
});

test('rechaza credenciales sin firma salvo que se acepten', () => {
  assert.deepEqual(leerQR('12345678', { secreto: SECRETO }), { error: 'SIN_FIRMA' });
  assert.deepEqual(leerQR('12345678', { secreto: SECRETO, aceptarSinFirma: true }), { matricula: 12345678 });
});

test('acepta la firma precalculada por matrícula (modo offline)', () => {
  const codigo = contenidoQR(123, SECRETO);
  const firmaDeMatricula = (matricula) => (matricula === 123 ? firmaConSecreto(123, SECRETO) : null);
  assert.deepEqual(leerQR(codigo, { firmaDeMatricula }), { matricula: 123 });
  assert.deepEqual(leerQR(contenidoQR(124, SECRETO), { firmaDeMatricula }), { error: 'FIRMA_INVALIDA' });
});

test('devuelve null para códigos que no son credencial ni matrícula', () => {
  assert.equal(leerQR('esto-no-es-un-qr', { secreto: SECRETO }), null);
});

test('exige secreto o firma precalculada', () => {
  assert.throws(() => leerQR(contenidoQR(1, SECRETO)), /requiere/);
});
