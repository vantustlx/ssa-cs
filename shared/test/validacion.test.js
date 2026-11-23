const test = require('node:test');
const assert = require('node:assert/strict');
const { validarDatosPersonales } = require('../src/validacion');

const valido = {
  matricula: '12345678',
  nombre: 'Ana',
  apellido_paterno: 'Pérez',
  apellido_materno: 'López',
  correo: 'ana@example.com',
  numero_telefono: '1234567890',
  fecha_nacimiento: '1990-01-01'
};

test('acepta datos personales válidos en alta', () => {
  assert.deepEqual(validarDatosPersonales(valido, { nuevo: true }), []);
});

test('rechaza nombre, correo y teléfono inválidos', () => {
  const errores = validarDatosPersonales({
    ...valido,
    nombre: 'A',
    correo: 'sin-correo',
    numero_telefono: '123'
  }, { nuevo: true });
  assert.ok(errores.some((e) => /Nombre/.test(e)));
  assert.ok(errores.some((e) => /Correo/.test(e)));
  assert.ok(errores.some((e) => /teléfono/.test(e)));
});

test('limita la matrícula a 8 dígitos en alta y acepta 9 en edición', () => {
  assert.ok(validarDatosPersonales({ ...valido, matricula: '123456789' }, { nuevo: true }).some((e) => /matrícula/.test(e)));
  assert.deepEqual(validarDatosPersonales({ ...valido, matricula: '123456789', estatus: 'Activo' }), []);
});

test('valida edad y estatus según el tipo de operación', () => {
  assert.ok(validarDatosPersonales({ ...valido, fecha_nacimiento: '2025-01-01' }, { nuevo: true }).some((e) => /años/.test(e)));
  assert.ok(validarDatosPersonales({ ...valido, estatus: 'Otro' }).some((e) => /Estatus/.test(e)));
});
