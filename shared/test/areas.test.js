const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validarAreas,
  agruparAreas,
  areaPrincipal,
  resumenAreas,
  filtroPorAreas
} = require('../src/areas');

const catalogos = {
  areas: [
    { id_area: 1, nombre: 'Estudiante', requiere_carrera: true },
    { id_area: 3, nombre: 'Administrativo', requiere_carrera: false }
  ],
  carreras: [{ id_carrera: 1, nombre: 'Ing. en Computación' }],
  turnos: [
    { id_turno: 1, nombre: 'Matutino' },
    { id_turno: 2, nombre: 'Vespertino' }
  ]
};

test('normaliza un área válida con carrera y turnos', () => {
  const { errores, areas } = validarAreas([
    { id_area: 1, id_carrera: 1, turnos: [1, 2, 1], principal: true }
  ], catalogos);
  assert.deepEqual(errores, []);
  assert.deepEqual(areas, [
    { id_area: 1, id_carrera: 1, turnos: [1, 2], principal: true }
  ]);
});

test('detecta área inexistente, carrera faltante y turnos vacíos', () => {
  const { errores } = validarAreas([
    { id_area: 99, turnos: [1] },
    { id_area: 1, turnos: [1] },
    { id_area: 3, turnos: [] }
  ], catalogos);
  assert.ok(errores.some((e) => /selecciona un área/.test(e)));
  assert.ok(errores.some((e) => /selecciona una carrera/.test(e)));
  assert.ok(errores.some((e) => /marca al menos un turno/.test(e)));
});

test('rechaza áreas repetidas', () => {
  const { errores } = validarAreas([
    { id_area: 3, turnos: [1] },
    { id_area: 3, turnos: [2] }
  ], catalogos);
  assert.ok(errores.some((e) => /repetida/.test(e)));
});

test('exige exactamente una área principal', () => {
  const sinPrincipal = validarAreas([{ id_area: 3, turnos: [1] }], catalogos);
  assert.ok(sinPrincipal.errores.some((e) => /principal/.test(e)));

  const dosPrincipales = validarAreas([
    { id_area: 3, turnos: [1], principal: true },
    { id_area: 1, id_carrera: 1, turnos: [1], principal: true }
  ], catalogos);
  assert.ok(dosPrincipales.errores.some((e) => /principal/.test(e)));
});

test('agrupa filas SQL y calcula el área principal', () => {
  const mapa = agruparAreas([
    { matricula: 123, id_usuario_area: 10, id_area: 2, area: 'Docente', id_carrera: 1, carrera: 'Computación', principal: 1, id_turno: 1, turno: 'Matutino' },
    { matricula: 123, id_usuario_area: 10, id_area: 2, area: 'Docente', id_carrera: 1, carrera: 'Computación', principal: 1, id_turno: 2, turno: 'Vespertino' },
    { matricula: 123, id_usuario_area: 11, id_area: 1, area: 'Estudiante', id_carrera: 1, carrera: 'Computación', principal: 0, id_turno: 1, turno: 'Matutino' }
  ]);
  const areas = mapa.get(123);
  assert.equal(areas.length, 2);
  assert.equal(areas[0].principal, true);
  assert.deepEqual(areas[0].turnos.map((t) => t.nombre), ['Matutino', 'Vespertino']);
  assert.equal(areaPrincipal(areas), 'Docente (+1)');
  assert.match(resumenAreas(areas), /Docente \(Computación · Matutino, Vespertino\)/);
});

test('filtroPorAreas aplica los tres filtros a la misma combinación', () => {
  const filtro = filtroPorAreas({ area: 1, carrera: 2, turno: 3 });
  assert.match(filtro.sql, /usuario_area/);
  assert.deepEqual(filtro.params, [1, 1, 2, 2, 3, 3]);
  const vacio = filtroPorAreas({});
  assert.deepEqual(vacio.params, [null, null, null, null, null, null]);
});
