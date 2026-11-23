process.env.TZ = 'America/Mexico_City';

const test = require('node:test');
const assert = require('node:assert/strict');
const { contenidoQR, leerQR } = require('../src/qr');
const { Antirrebote } = require('../src/antirrebote');
const { crearServicioAcceso } = require('../src/acceso');
const { FakeAccessRepo } = require('./helpers/fakeAccessRepo');

const SECRETO = 'secreto-de-prueba';
const USUARIO = { matricula: 123, nombre: 'Ana', apellido_paterno: 'Pérez', apellido_materno: 'López' };

function crear(opciones = {}) {
  const repo = new FakeAccessRepo(opciones);
  let reloj = new Date('2026-11-23T10:00:00-06:00');
  const notificaciones = [];
  const fallidos = [];
  const publicados = [];
  const servicio = crearServicioAcceso({
    repo,
    qr: { leer: (texto) => leerQR(texto, { secreto: SECRETO, aceptarSinFirma: opciones.aceptarSinFirma }) },
    antirrebote: new Antirrebote({ ventanaSegundos: opciones.antirreboteSegundos ?? 0 }),
    config: { intervaloMinimoSegundos: opciones.intervaloMinimoSegundos ?? 15 },
    ahora: () => new Date(reloj),
    notificar: async (n) => { notificaciones.push(n); },
    registrarFallido: async (...args) => { fallidos.push(args); },
    publicar: (r) => { publicados.push(r); }
  });
  return {
    repo,
    servicio,
    notificaciones,
    fallidos,
    publicados,
    avanzar: (segundos) => { reloj = new Date(reloj.getTime() + segundos * 1000); },
    setReloj: (fecha) => { reloj = new Date(fecha); }
  };
}

test('registra entrada y luego salida de un usuario', async () => {
  const ctx = crear({ usuarios: [USUARIO], areas: { 123: 'Estudiante' }, vehiculos: { 123: ['ABC-123-D'] } });
  const codigo = contenidoQR(123, SECRETO);

  const entrada = await ctx.servicio.registrarAcceso(codigo, 'PEATONAL', 'serial');
  assert.equal(entrada.estado, 'ENTRADA');
  assert.equal(entrada.nombre, 'Ana Pérez López');
  assert.equal(entrada.rol, 'Estudiante');
  assert.deepEqual(entrada.placas, ['ABC-123-D']);
  assert.equal(ctx.repo.registros.length, 1);

  ctx.avanzar(20);
  const salida = await ctx.servicio.registrarAcceso(codigo, 'PEATONAL', 'serial');
  assert.equal(salida.estado, 'SALIDA');
  assert.ok(ctx.repo.registros[0].fecha_salida);
  assert.equal(ctx.publicados.length, 2);
});

test('cierra una entrada de un día anterior y cuenta la lectura como entrada', async () => {
  const ayer = new Date('2026-11-22T09:00:00-06:00');
  const ctx = crear({
    usuarios: [USUARIO],
    registros: [{ matricula: 123, fecha_entrada: ayer, fecha_salida: null, cierre_automatico: null, medio_entrada: 'PEATONAL' }]
  });

  const resultado = await ctx.servicio.registrarAcceso(contenidoQR(123, SECRETO), 'PEATONAL', 'serial');
  assert.equal(resultado.estado, 'ENTRADA');
  assert.equal(resultado.avisos.length, 1);
  assert.ok(ctx.repo.registros[0].cierre_automatico);
  assert.equal(ctx.repo.registros.length, 2);
  assert.equal(ctx.notificaciones.length, 1);
  assert.equal(ctx.notificaciones[0].tipo, 'ACCESO_INCONSISTENTE');
});

test('ignora una lectura repetida antes del intervalo mínimo, en cualquier lector', async () => {
  const ctx = crear({ usuarios: [USUARIO] });
  const codigo = contenidoQR(123, SECRETO);

  await ctx.servicio.registrarAcceso(codigo, 'PEATONAL', 'serial');
  ctx.avanzar(10);
  const repetida = await ctx.servicio.registrarAcceso(codigo, 'SALIDA_VEHICULAR', 'serial');

  assert.equal(repetida.estado, 'REPETIDO');
  assert.match(repetida.mensaje, /lectura ignorada/);
  assert.equal(ctx.repo.registros.length, 1);
});

test('avisa cuando se usa un lector vehicular sin vehículo registrado', async () => {
  const ctx = crear({ usuarios: [USUARIO], areas: { 123: 'Docente' } });
  const resultado = await ctx.servicio.registrarAcceso(contenidoQR(123, SECRETO), 'ENTRADA_VEHICULAR', 'serial');

  assert.equal(resultado.estado, 'ENTRADA');
  assert.match(resultado.avisos[0], /sin vehículo registrado/);
  assert.equal(ctx.notificaciones.length, 1);
});

test('rechaza una matrícula no registrada y la guarda como acceso fallido', async () => {
  const ctx = crear();
  const resultado = await ctx.servicio.registrarAcceso(contenidoQR(999, SECRETO), 'PEATONAL', 'serial');

  assert.equal(resultado.estado, 'RECHAZADO');
  assert.equal(resultado.mensaje, 'Matrícula no registrada');
  assert.equal(ctx.fallidos.length, 1);
  assert.equal(ctx.fallidos[0][1], 'MATRICULA_NO_ENCONTRADA');
  assert.equal(ctx.publicados.length, 1);
});

test('rechaza un código con formato desconocido', async () => {
  const ctx = crear();
  const resultado = await ctx.servicio.registrarAcceso('basura', 'PEATONAL', 'serial');

  assert.equal(resultado.estado, 'RECHAZADO');
  assert.equal(ctx.fallidos[0][1], 'QR_INVALIDO');
});

test('registra entrada y salida de un visitante vigente', async () => {
  const ctx = crear({
    visitantes: [{
      id_visitante: 1,
      codigo_acceso: 'ABC12345',
      nombre: 'Vis',
      apellido_paterno: 'Itante',
      apellido_materno: '',
      tipo: 'Ocasional',
      motivo: 'Reunión',
      vigente_hasta: new Date('2026-12-01T00:00:00-06:00')
    }]
  });

  const entrada = await ctx.servicio.registrarAcceso('V-ABC12345', 'PEATONAL', 'serial');
  assert.equal(entrada.estado, 'ENTRADA');
  assert.equal(entrada.rol, 'Visitante ocasional');

  ctx.avanzar(20);
  const salida = await ctx.servicio.registrarAcceso('V-ABC12345', 'PEATONAL', 'serial');
  assert.equal(salida.estado, 'SALIDA');
});

test('rechaza un pase de visitante vencido', async () => {
  const ctx = crear({
    visitantes: [{
      id_visitante: 1,
      codigo_acceso: 'ABC12345',
      nombre: 'Vis',
      apellido_paterno: 'Itante',
      apellido_materno: '',
      tipo: 'Ocasional',
      motivo: 'Reunión',
      vigente_hasta: new Date('2026-11-01T00:00:00-06:00')
    }]
  });

  const resultado = await ctx.servicio.registrarAcceso('V-ABC12345', 'PEATONAL', 'serial');
  assert.equal(resultado.estado, 'RECHAZADO');
  assert.equal(ctx.fallidos[0][1], 'VISITANTE_VENCIDO');
});

test('acepta el folio tecleado sin el prefijo V-', async () => {
  const ctx = crear({
    visitantes: [{
      id_visitante: 1,
      codigo_acceso: 'ABC12345',
      nombre: 'Vis',
      apellido_paterno: 'Itante',
      apellido_materno: '',
      tipo: 'Ocasional',
      motivo: 'Reunión',
      vigente_hasta: new Date('2026-12-01T00:00:00-06:00')
    }]
  });

  const resultado = await ctx.servicio.registrarFolioVisitante('abc12345');
  assert.equal(resultado.estado, 'ENTRADA');
  assert.equal(resultado.origen, 'folio');
});

test('el antirrebote del mismo lector no publica ni registra la segunda lectura', async () => {
  const ctx = crear({ usuarios: [USUARIO], antirreboteSegundos: 8 });
  const codigo = contenidoQR(123, SECRETO);

  const primera = await ctx.servicio.registrarAcceso(codigo, 'PEATONAL', 'serial');
  const segunda = await ctx.servicio.registrarAcceso(codigo, 'PEATONAL', 'serial');

  assert.equal(primera.estado, 'ENTRADA');
  assert.equal(segunda.estado, 'REPETIDO');
  assert.equal(ctx.repo.registros.length, 1);
  assert.equal(ctx.publicados.length, 1);
});
