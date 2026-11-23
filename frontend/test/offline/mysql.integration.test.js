process.env.TZ = 'America/Mexico_City';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { crearDb } = require('../../src/main/offline/db');
const { crearEsquema } = require('../../src/main/offline/esquema');
const { crearSnapshot } = require('../../src/main/offline/snapshot');
const { crearTransporteMySQL } = require('../../src/main/offline/transporteMySQL');

const MATRICULA = 99001122;
const FOLIO = 'TEST1234';
const PLACA = 'TST-001-A';
const UUID_ENTRADA = crypto.randomUUID();
const UUID_SALIDA = crypto.randomUUID();
const UUID_CIERRE = crypto.randomUUID();
const UUID_FALLIDO = crypto.randomUUID();
const UUID_CONFLICTO = crypto.randomUUID();
const UUID_AVISO = crypto.randomUUID();
const CONFIG = {
  lectores: { antirreboteSegundos: 8, intervaloMinimoSegundos: 15 },
  cierre: { hora: '20:00' },
  qr: { aceptarSinFirma: false }
};

const probar = process.env.TEST_DB ? test : test.skip;

let pool;

async function limpiar() {
  await pool.query('DELETE FROM notificacion WHERE matricula = ?', [MATRICULA]);
  await pool.query('DELETE FROM accesos_fallidos WHERE matricula_intentada = ?', [FOLIO]);
  await pool.query("DELETE FROM sync_evento WHERE uuid LIKE 'test-%' OR uuid IN (?)", [[UUID_ENTRADA, UUID_SALIDA, UUID_CIERRE, UUID_FALLIDO, UUID_CONFLICTO, UUID_AVISO]]);
  await pool.query('DELETE FROM registroacceso WHERE uuid IN (?)', [[UUID_ENTRADA, UUID_AVISO]]);
  await pool.query(
    'DELETE uat FROM usuario_area_turno uat JOIN usuario_area ua ON ua.id_usuario_area = uat.id_usuario_area WHERE ua.matricula = ?',
    [MATRICULA]
  );
  await pool.query('DELETE FROM usuario_area WHERE matricula = ?', [MATRICULA]);
  await pool.query('DELETE FROM vehiculo WHERE matricula = ?', [MATRICULA]);
  await pool.query('DELETE FROM visitante WHERE codigo_acceso = ?', [FOLIO]);
  await pool.query('DELETE FROM usuario WHERE matricula = ?', [MATRICULA]);
}

probar('integración de snapshot y transporte contra MySQL', async (t) => {
  pool = mysql.createPool({
    host: process.env.TEST_DB_HOST || '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT) || 3307,
    user: process.env.TEST_DB_USER || 'root',
    password: process.env.TEST_DB_PASSWORD || 'ssa_dev_root',
    database: process.env.TEST_DB_NAME || 'sistemaaccesofacultad',
    connectionLimit: 2
  });

  await limpiar();

  try {
    await t.test('prepara datos de prueba', async () => {
      await pool.query(
        'INSERT INTO usuario (matricula, nombre, apellido_paterno, apellido_materno, estatus) VALUES (?, ?, ?, ?, ?)',
        [MATRICULA, 'Prueba', 'Offline', 'Integración', 'Activo']
      );
      await pool.query('INSERT INTO vehiculo (matricula, placa) VALUES (?, ?)', [MATRICULA, PLACA]);
      const [area] = await pool.query(
        'INSERT INTO usuario_area (matricula, id_area, id_carrera, principal) VALUES (?, 1, 1, 1)',
        [MATRICULA]
      );
      await pool.query('INSERT INTO usuario_area_turno (id_usuario_area, id_turno) VALUES (?, 1)', [area.insertId]);
      await pool.query(
        `INSERT INTO visitante
           (nombre, apellido_paterno, apellido_materno, fecha_registro, numero_telefono, correo, codigo_acceso, motivo, tipo, vigente_hasta)
         VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, 'Ocasional', DATE_ADD(NOW(), INTERVAL 1 DAY))`,
        ['Visita', 'Prueba', 'Offline', '1234567890', 'visita@example.com', FOLIO, 'Prueba de integración']
      );
    });

    await t.test('lee y aplica el snapshot', async () => {
      const offlineDb = crearDb();
      crearEsquema(offlineDb.db);
      try {
        const snapshot = crearSnapshot({ pool, offlineDb, config: CONFIG, firma: (m) => `F-${m}` });
        const datos = await snapshot.leer();
        const usuario = datos.usuarios.find((u) => u.matricula === MATRICULA);
        assert.ok(usuario);
        assert.equal(usuario.firma_qr, `F-${MATRICULA}`);
        assert.equal(usuario.area_principal, 'Estudiante');
        assert.ok(datos.vehiculos.some((v) => v.matricula === MATRICULA && v.placa === PLACA));
        assert.ok(datos.visitantes.some((v) => v.codigo_acceso === FOLIO));

        await snapshot.aplicar(datos);
        const local = offlineDb.db.prepare('SELECT firma_qr, area_principal FROM usuario_local WHERE matricula = ?').get(MATRICULA);
        assert.equal(local.firma_qr, `F-${MATRICULA}`);
        assert.equal(local.area_principal, 'Estudiante');
      } finally {
        offlineDb.cerrar();
      }
    });

    await t.test('aplica eventos de forma idempotente', async () => {
      const transporte = crearTransporteMySQL(pool);
      const entrada = {
        uuid: UUID_ENTRADA,
        tipo: 'ENTRADA',
        entidad: 'USUARIO',
        matricula: MATRICULA,
        registro_uuid: UUID_ENTRADA,
        fecha: new Date().toISOString(),
        medio: 'PEATONAL',
        lector: 'PEATONAL',
        nombre: 'Prueba Offline Integración',
        avisos: []
      };

      const primera = await transporte.aplicarEventos([entrada]);
      assert.deepEqual(primera.aplicados, [UUID_ENTRADA]);
      const segunda = await transporte.aplicarEventos([entrada]);
      assert.deepEqual(segunda.aplicados, [UUID_ENTRADA]);

      const [[fila]] = await pool.query('SELECT COUNT(*) AS n FROM registroacceso WHERE uuid = ?', [UUID_ENTRADA]);
      assert.equal(fila.n, 1);
    });

    await t.test('aplica salida y cierre', async () => {
      const transporte = crearTransporteMySQL(pool);
      const salida = {
        uuid: UUID_SALIDA,
        tipo: 'SALIDA',
        entidad: 'USUARIO',
        matricula: MATRICULA,
        registro_uuid: UUID_ENTRADA,
        fecha: new Date().toISOString(),
        medio: 'PEATONAL'
      };
      const resultadoSalida = await transporte.aplicarEventos([salida]);
      assert.deepEqual(resultadoSalida.aplicados, [UUID_SALIDA]);

      const cierre = {
        uuid: UUID_CIERRE,
        tipo: 'CIERRE',
        entidad: 'USUARIO',
        matricula: MATRICULA,
        registro_uuid: UUID_ENTRADA,
        fecha: new Date().toISOString()
      };
      const resultadoCierre = await transporte.aplicarEventos([cierre]);
      assert.deepEqual(resultadoCierre.aplicados, [UUID_CIERRE]);

      const [[fila]] = await pool.query(
        'SELECT fecha_salida, cierre_automatico FROM registroacceso WHERE uuid = ?',
        [UUID_ENTRADA]
      );
      assert.ok(fila.fecha_salida);
      assert.ok(fila.cierre_automatico);
    });

    await t.test('registra accesos fallidos y notificaciones', async () => {
      const transporte = crearTransporteMySQL(pool);
      const fallido = {
        uuid: UUID_FALLIDO,
        tipo: 'ACCESO_FALLIDO',
        fecha: new Date().toISOString(),
        texto: FOLIO,
        tipoError: 'QR_INVALIDO',
        descripcion: 'Código no válido (lector 1)'
      };
      await transporte.aplicarEventos([fallido]);
      const [[fallidos]] = await pool.query(
        'SELECT COUNT(*) AS n FROM accesos_fallidos WHERE matricula_intentada = ?',
        [FOLIO]
      );
      assert.equal(fallidos.n, 1);

      const aviso = {
        uuid: UUID_AVISO,
        tipo: 'ENTRADA',
        entidad: 'USUARIO',
        matricula: MATRICULA,
        registro_uuid: UUID_AVISO,
        fecha: new Date().toISOString(),
        medio: 'VEHICULAR',
        lector: 'ENTRADA_VEHICULAR',
        nombre: 'Prueba Offline Integración',
        avisos: ['Entró en vehículo sin vehículo registrado']
      };
      await transporte.aplicarEventos([aviso]);
      const [[notificaciones]] = await pool.query(
        'SELECT COUNT(*) AS n FROM notificacion WHERE matricula = ? AND tipo = ?',
        [MATRICULA, 'ACCESO_INCONSISTENTE']
      );
      assert.equal(notificaciones.n, 1);
    });

    await t.test('reporta un conflicto cuando falta la entrada', async () => {
      const transporte = crearTransporteMySQL(pool);
      const salidaHuerfana = {
        uuid: UUID_CONFLICTO,
        tipo: 'SALIDA',
        entidad: 'USUARIO',
        matricula: MATRICULA,
        registro_uuid: 'no-existe',
        fecha: new Date().toISOString(),
        medio: 'PEATONAL'
      };
      const resultado = await transporte.aplicarEventos([salidaHuerfana]);
      assert.deepEqual(resultado.aplicados, []);
      assert.equal(resultado.conflictos.length, 1);
      assert.equal(resultado.conflictos[0].uuid, UUID_CONFLICTO);
    });
  } finally {
    await limpiar();
    await pool.end();
  }
});
