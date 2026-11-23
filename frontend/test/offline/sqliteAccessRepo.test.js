const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDb } = require('../../src/main/offline/db');
const { crearEsquema } = require('../../src/main/offline/esquema');
const { crearSqliteAccessRepo } = require('../../src/main/offline/sqliteAccessRepo');

function preparar() {
  const offlineDb = crearDb();
  crearEsquema(offlineDb.db);
  offlineDb.db.prepare(
    `INSERT INTO usuario_local
       (matricula, nombre, apellido_paterno, apellido_materno, estatus, firma_qr, area_principal, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(123, 'Ana', 'Pérez', 'López', 'Activo', 'FIRMA-123', 'Estudiante', new Date().toISOString());
  offlineDb.db.prepare('INSERT INTO vehiculo_local (matricula, placa) VALUES (?, ?)').run(123, 'ABC-123-D');
  offlineDb.db.prepare(
    `INSERT INTO visitante_local
       (id_visitante, codigo_acceso, nombre, apellido_paterno, apellido_materno, tipo, motivo, vigente_hasta, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(1, 'ABC12345', 'Vis', 'Itante', '', 'Ocasional', 'Reunión', '2026-12-01T00:00:00.000Z', new Date().toISOString());
  const repo = crearSqliteAccessRepo(offlineDb);
  return { offlineDb, repo };
}

const contexto = {
  lector: 'PEATONAL',
  origen: 'serial',
  nombre: 'Ana Pérez López',
  rol: 'Estudiante',
  avisos: []
};

test('registra entrada y escribe el evento en la outbox en la misma transacción', async () => {
  const { offlineDb, repo } = preparar();
  try {
    const fecha = new Date('2026-11-23T10:00:00-06:00');
    await repo.conTransaccion(async (tx) => {
      const usuario = await repo.obtenerUsuarioParaAcceso(123, tx);
      assert.equal(usuario.nombre, 'Ana');
      assert.deepEqual(await repo.obtenerPlacas(123, tx), ['ABC-123-D']);
      assert.equal(await repo.obtenerAreaPrincipal(123, tx), 'Estudiante');
      assert.equal(await repo.entradaAbiertaUsuario(123, tx), null);

      await repo.crearEntradaUsuario({ matricula: 123, medio: 'PEATONAL', fecha, contexto }, tx);
    });

    const abierta = await repo.conTransaccion((tx) => repo.entradaAbiertaUsuario(123, tx));
    assert.ok(abierta);
    assert.equal(offlineDb.db.prepare('SELECT COUNT(*) AS n FROM registro_local').get().n, 1);

    const [evento] = offlineDb.db.prepare('SELECT tipo, payload FROM outbox').all();
    assert.equal(evento.tipo, 'ENTRADA');
    const payload = JSON.parse(evento.payload);
    assert.equal(payload.entidad, 'USUARIO');
    assert.equal(payload.matricula, 123);
    assert.equal(payload.medio, 'PEATONAL');
    assert.equal(payload.registro_uuid, abierta.id_registro);
  } finally {
    offlineDb.cerrar();
  }
});

test('registra la salida y encola SALIDA con el registro correcto', async () => {
  const { offlineDb, repo } = preparar();
  try {
    const entrada = new Date('2026-11-23T10:00:00-06:00');
    const salida = new Date('2026-11-23T10:00:30-06:00');
    await repo.conTransaccion((tx) =>
      repo.crearEntradaUsuario({ matricula: 123, medio: 'VEHICULAR', fecha: entrada, contexto }, tx));
    const abierta = await repo.conTransaccion((tx) => repo.entradaAbiertaUsuario(123, tx));

    await repo.conTransaccion((tx) =>
      repo.cerrarEntradaUsuario({ id: abierta.id_registro, medio: 'PEATONAL', fecha: salida, contexto }, tx));

    const eventos = offlineDb.db.prepare('SELECT tipo, payload FROM outbox ORDER BY rowid').all();
    assert.deepEqual(eventos.map((e) => e.tipo), ['ENTRADA', 'SALIDA']);
    const salidaEvento = JSON.parse(eventos[1].payload);
    assert.equal(salidaEvento.registro_uuid, abierta.id_registro);
    assert.equal(salidaEvento.medio, 'PEATONAL');

    const registro = offlineDb.db.prepare('SELECT salida_utc, medio_salida FROM registro_local').get();
    assert.ok(registro.salida_utc);
    assert.equal(registro.medio_salida, 'PEATONAL');
  } finally {
    offlineDb.cerrar();
  }
});

test('marca el cierre automático y encola CIERRE', async () => {
  const { offlineDb, repo } = preparar();
  try {
    const ayer = new Date('2026-11-22T09:00:00-06:00').toISOString();
    offlineDb.db.prepare(
      `INSERT INTO registro_local
         (uuid, matricula, id_visitante, entrada_utc, salida_utc, medio_entrada, medio_salida, cierre_automatico_utc, sync_estado)
       VALUES (?, ?, NULL, ?, NULL, 'PEATONAL', NULL, NULL, 'PENDIENTE')`
    ).run('entrada-ayer', 123, ayer);

    await repo.conTransaccion((tx) =>
      repo.marcarCierreAutomatico({ id: 'entrada-ayer', fecha: new Date('2026-11-23T08:00:00-06:00'), contexto: { origen: 'cierre_local' } }, tx));

    const registro = offlineDb.db.prepare('SELECT cierre_automatico_utc FROM registro_local WHERE uuid = ?').get('entrada-ayer');
    assert.ok(registro.cierre_automatico_utc);
    const [evento] = offlineDb.db.prepare("SELECT tipo, payload FROM outbox WHERE tipo = 'CIERRE'").all();
    assert.equal(evento.tipo, 'CIERRE');
    assert.equal(JSON.parse(evento.payload).registro_uuid, 'entrada-ayer');
  } finally {
    offlineDb.cerrar();
  }
});

test('registra entrada y salida de visitante sin medio', async () => {
  const { offlineDb, repo } = preparar();
  try {
    const entrada = new Date('2026-11-23T10:00:00-06:00');
    const salida = new Date('2026-11-23T10:01:00-06:00');
    try {
      await repo.conTransaccion((tx) =>
        repo.crearEntradaVisitante({ idVisitante: 1, fecha: entrada, contexto: { folio: 'ABC12345', nombre: 'Vis Itante', rol: 'Visitante ocasional', motivo: 'Reunión' } }, tx));
      const abierta = await repo.conTransaccion((tx) => repo.entradaAbiertaVisitante(1, tx));
      assert.ok(abierta);
      await repo.conTransaccion((tx) =>
        repo.cerrarEntradaVisitante({ id: abierta.id_registro, fecha: salida, contexto: {} }, tx));
    } catch (error) {
      console.error('ERROR VISITANTE', error);
      throw error;
    }

    const eventos = offlineDb.db.prepare('SELECT tipo, payload FROM outbox ORDER BY rowid').all();
    assert.deepEqual(eventos.map((e) => e.tipo), ['ENTRADA', 'SALIDA']);
    for (const evento of eventos) {
      const payload = JSON.parse(evento.payload);
      assert.equal(payload.entidad, 'VISITANTE');
      assert.equal(payload.id_visitante, 1);
      assert.equal(payload.medio, null);
    }
  } finally {
    offlineDb.cerrar();
  }
});

test('registra un acceso fallido en la outbox', async () => {
  const { offlineDb, repo } = preparar();
  try {
    await repo.registrarAccesoFallido('codigo-x', 'QR_INVALIDO', 'Código no válido (lector 1)');
    const [evento] = offlineDb.db.prepare("SELECT tipo, payload FROM outbox WHERE tipo = 'ACCESO_FALLIDO'").all();
    assert.ok(evento);
    const payload = JSON.parse(evento.payload);
    assert.equal(payload.texto, 'codigo-x');
    assert.equal(payload.tipoError, 'QR_INVALIDO');
  } finally {
    offlineDb.cerrar();
  }
});

test('encuentra la firma QR local y devuelve null para desconocidos', () => {
  const { offlineDb, repo } = preparar();
  try {
    assert.equal(repo.obtenerFirma(123), 'FIRMA-123');
    assert.equal(repo.obtenerFirma(999), null);
  } finally {
    offlineDb.cerrar();
  }
});
