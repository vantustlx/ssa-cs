process.env.TZ = 'America/Mexico_City';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Antirrebote, contenidoQR, firmaConSecreto, crearServicioAcceso } = require('@ssa/shared');
const { crearDb } = require('../../src/main/offline/db');
const { crearEsquema } = require('../../src/main/offline/esquema');
const { crearSqliteAccessRepo } = require('../../src/main/offline/sqliteAccessRepo');
const { crearQrLocal } = require('../../src/main/offline/qrLocal');

const SECRETO = 'secreto-de-prueba';

function preparar({ conVehiculo = true, conVisitante = true, antirreboteSegundos = 0 } = {}) {
  const offlineDb = crearDb();
  crearEsquema(offlineDb.db);
  offlineDb.db.prepare(
    `INSERT INTO usuario_local
       (matricula, nombre, apellido_paterno, apellido_materno, estatus, firma_qr, area_principal, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(123, 'Ana', 'Pérez', 'López', 'Activo', firmaConSecreto(123, SECRETO), 'Estudiante', new Date().toISOString());
  if (conVehiculo) {
    offlineDb.db.prepare('INSERT INTO vehiculo_local (matricula, placa) VALUES (?, ?)').run(123, 'ABC-123-D');
  }
  if (conVisitante) {
    offlineDb.db.prepare(
      `INSERT INTO visitante_local
         (id_visitante, codigo_acceso, nombre, apellido_paterno, apellido_materno, tipo, motivo, vigente_hasta, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(1, 'ABC12345', 'Vis', 'Itante', '', 'Ocasional', 'Reunión', '2026-12-01T00:00:00.000Z', new Date().toISOString());
  }

  const repo = crearSqliteAccessRepo(offlineDb);
  const qr = crearQrLocal(repo, { aceptarSinFirma: true });
  let reloj = new Date('2026-11-23T10:00:00-06:00');
  let online = true;
  const publicados = [];
  const notificaciones = [];

  const servicio = crearServicioAcceso({
    repo,
    qr,
    antirrebote: new Antirrebote({ ventanaSegundos: antirreboteSegundos }),
    config: { intervaloMinimoSegundos: 15 },
    ahora: () => new Date(reloj),
    notificar: async (n) => { notificaciones.push(n); },
    registrarFallido: (texto, tipoError, descripcion) => repo.registrarAccesoFallido(texto, tipoError, descripcion),
    publicar: (r) => { publicados.push(r); },
    mensajeNoEncontrado: () => (online
      ? 'Matrícula no registrada'
      : 'No disponible sin conexión; consulta con administración'),
    mensajeVisitanteNoEncontrado: () => (online
      ? 'Folio de visitante no válido'
      : 'No disponible sin conexión; consulta con administración')
  });

  return {
    offlineDb,
    repo,
    servicio,
    publicados,
    notificaciones,
    avanzar: (segundos) => { reloj = new Date(reloj.getTime() + segundos * 1000); },
    setOnline: (valor) => { online = valor; }
  };
}

test('registra entrada y salida local con el QR firmado sincronizado', async () => {
  const ctx = preparar();
  try {
    const codigo = contenidoQR(123, SECRETO);
    const entrada = await ctx.servicio.registrarAcceso(codigo, 'PEATONAL', 'serial');
    assert.equal(entrada.estado, 'ENTRADA');
    assert.equal(entrada.nombre, 'Ana Pérez López');
    assert.equal(entrada.rol, 'Estudiante');
    assert.deepEqual(entrada.placas, ['ABC-123-D']);

    ctx.avanzar(20);
    const salida = await ctx.servicio.registrarAcceso(codigo, 'PEATONAL', 'serial');
    assert.equal(salida.estado, 'SALIDA');
    const eventos = ctx.offlineDb.db.prepare('SELECT tipo FROM outbox ORDER BY rowid').all();
    assert.deepEqual(eventos.map((e) => e.tipo), ['ENTRADA', 'SALIDA']);
    assert.equal(ctx.publicados.length, 2);
  } finally {
    ctx.offlineDb.cerrar();
  }
});

test('un QR firmado de un usuario no sincronizado no se da por válido offline', async () => {
  const ctx = preparar();
  try {
    ctx.setOnline(false);
    const resultado = await ctx.servicio.registrarAcceso(contenidoQR(999, SECRETO), 'PEATONAL', 'serial');
    assert.equal(resultado.estado, 'RECHAZADO');
    assert.match(resultado.mensaje, /No disponible sin conexión/);
    assert.equal(ctx.publicados.length, 1);
    const fallido = ctx.offlineDb.db.prepare("SELECT tipo FROM outbox WHERE tipo = 'ACCESO_FALLIDO'").get();
    assert.ok(fallido);
  } finally {
    ctx.offlineDb.cerrar();
  }
});

test('una matrícula sin firma y desconocida usa el mensaje offline', async () => {
  const ctx = preparar();
  try {
    ctx.setOnline(false);
    const resultado = await ctx.servicio.registrarAcceso('99999999', 'PEATONAL', 'serial');
    assert.equal(resultado.estado, 'RECHAZADO');
    assert.match(resultado.mensaje, /No disponible sin conexión/);
  } finally {
    ctx.offlineDb.cerrar();
  }
});

test('avisa cuando se usa un lector vehicular sin vehículo registrado', async () => {
  const ctx = preparar({ conVehiculo: false });
  try {
    const resultado = await ctx.servicio.registrarAcceso(contenidoQR(123, SECRETO), 'ENTRADA_VEHICULAR', 'serial');
    assert.equal(resultado.estado, 'ENTRADA');
    assert.match(resultado.avisos[0], /sin vehículo registrado/);
    assert.equal(ctx.notificaciones.length, 1);

    const [evento] = ctx.offlineDb.db.prepare("SELECT payload FROM outbox WHERE tipo = 'ENTRADA'").all();
    assert.ok(JSON.parse(evento.payload).avisos.some((a) => /sin vehículo registrado/.test(a)));
  } finally {
    ctx.offlineDb.cerrar();
  }
});

test('registra entrada y salida de un visitante sincronizado', async () => {
  const ctx = preparar();
  try {
    const entrada = await ctx.servicio.registrarAcceso('V-ABC12345', 'PEATONAL', 'serial');
    assert.equal(entrada.estado, 'ENTRADA');
    assert.equal(entrada.rol, 'Visitante ocasional');

    ctx.avanzar(20);
    const salida = await ctx.servicio.registrarAcceso('V-ABC12345', 'PEATONAL', 'serial');
    assert.equal(salida.estado, 'SALIDA');

    const eventos = ctx.offlineDb.db.prepare('SELECT tipo, payload FROM outbox ORDER BY rowid').all();
    assert.deepEqual(eventos.map((e) => e.tipo), ['ENTRADA', 'SALIDA']);
    assert.equal(JSON.parse(eventos[0].payload).entidad, 'VISITANTE');
  } finally {
    ctx.offlineDb.cerrar();
  }
});

test('ignora una lectura repetida antes del intervalo mínimo global', async () => {
  const ctx = preparar();
  try {
    const codigo = contenidoQR(123, SECRETO);
    await ctx.servicio.registrarAcceso(codigo, 'PEATONAL', 'serial');
    ctx.avanzar(10);
    const repetida = await ctx.servicio.registrarAcceso(codigo, 'SALIDA_VEHICULAR', 'serial');
    assert.equal(repetida.estado, 'REPETIDO');
    assert.match(repetida.mensaje, /lectura ignorada/);
    assert.equal(ctx.offlineDb.db.prepare('SELECT COUNT(*) AS n FROM registro_local').get().n, 1);
  } finally {
    ctx.offlineDb.cerrar();
  }
});

test('el antirrebote del mismo lector no crea una segunda entrada', async () => {
  const ctx = preparar({ antirreboteSegundos: 8 });
  try {
    const codigo = contenidoQR(123, SECRETO);
    const primera = await ctx.servicio.registrarAcceso(codigo, 'PEATONAL', 'serial');
    const segunda = await ctx.servicio.registrarAcceso(codigo, 'PEATONAL', 'serial');
    assert.equal(primera.estado, 'ENTRADA');
    assert.equal(segunda.estado, 'REPETIDO');
    assert.equal(ctx.offlineDb.db.prepare('SELECT COUNT(*) AS n FROM registro_local').get().n, 1);
    assert.equal(ctx.publicados.length, 1);
  } finally {
    ctx.offlineDb.cerrar();
  }
});
