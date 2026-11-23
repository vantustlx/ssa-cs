// accessRepo.js — implementación MySQL del repositorio de accesos
const { agruparAreas, areaPrincipal } = require('@ssa/shared');

function crearAccessRepo(pool) {
  async function conTransaccion(fn) {
    const conexion = await pool.getConnection();
    try {
      await conexion.beginTransaction();
      const resultado = await fn(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  async function obtenerUsuarioParaAcceso(matricula, tx) {
    const [[usuario]] = await tx.query(
      'SELECT matricula, nombre, apellido_paterno, apellido_materno FROM usuario WHERE matricula = ? FOR UPDATE',
      [matricula]
    );
    return usuario || null;
  }

  async function obtenerPlacas(matricula, tx) {
    const [filas] = await tx.query('SELECT placa FROM vehiculo WHERE matricula = ? ORDER BY placa', [matricula]);
    return filas.map((f) => f.placa);
  }

  async function obtenerAreas(matricula, tx) {
    const [filas] = await tx.query(
      `SELECT ua.matricula, ua.id_usuario_area, ua.id_area, a.nombre AS area, ua.id_carrera,
              c.nombre_carrera AS carrera, ua.principal, t.id_turno, t.nombre AS turno
         FROM usuario_area ua
         JOIN area a ON a.id_area = ua.id_area
         LEFT JOIN carrera c ON c.id_carrera = ua.id_carrera
         LEFT JOIN usuario_area_turno uat ON uat.id_usuario_area = ua.id_usuario_area
         LEFT JOIN turno t ON t.id_turno = uat.id_turno
        WHERE ua.matricula = ?
        ORDER BY ua.principal DESC, ua.id_usuario_area, t.id_turno`,
      [matricula]
    );
    return agruparAreas(filas).get(Number(matricula)) || [];
  }

  async function obtenerAreaPrincipal(matricula, tx) {
    return areaPrincipal(await obtenerAreas(matricula, tx));
  }

  async function ultimoMovimientoUsuario(matricula, fecha, tx) {
    const [[ultimo]] = await tx.query(
      `SELECT fecha_salida IS NOT NULL AS fue_salida,
              TIMESTAMPDIFF(SECOND, COALESCE(fecha_salida, fecha_entrada), ?) AS segundos
         FROM registroacceso
        WHERE matricula = ?
        ORDER BY fecha_entrada DESC, id_registro DESC LIMIT 1`,
      [fecha, matricula]
    );
    return ultimo ? { fue_salida: Boolean(ultimo.fue_salida), segundos: Number(ultimo.segundos) } : null;
  }

  async function entradaAbiertaUsuario(matricula, tx) {
    const [[abierto]] = await tx.query(
      `SELECT id_registro, fecha_entrada, medio_entrada FROM registroacceso
        WHERE matricula = ? AND fecha_salida IS NULL AND cierre_automatico IS NULL
        ORDER BY fecha_entrada DESC LIMIT 1 FOR UPDATE`,
      [matricula]
    );
    return abierto || null;
  }

  async function crearEntradaUsuario({ matricula, medio, fecha }, tx) {
    await tx.query(
      'INSERT INTO registroacceso (matricula, fecha_entrada, medio_entrada) VALUES (?, ?, ?)',
      [matricula, fecha, medio]
    );
  }

  async function cerrarEntradaUsuario({ id, medio, fecha }, tx) {
    await tx.query(
      'UPDATE registroacceso SET fecha_salida = ?, medio_salida = ? WHERE id_registro = ?',
      [fecha, medio, id]
    );
  }

  async function marcarCierreAutomatico({ id, fecha }, tx) {
    await tx.query('UPDATE registroacceso SET cierre_automatico = ? WHERE id_registro = ?', [fecha, id]);
  }

  async function actualizarEstatusUsuario(matricula, estatus, tx) {
    await tx.query('UPDATE usuario SET estatus = ? WHERE matricula = ?', [estatus, matricula]);
  }

  async function obtenerVisitantePorFolio(folio, tx) {
    const [[visitante]] = await tx.query(
      `SELECT id_visitante, nombre, apellido_paterno, apellido_materno, tipo, motivo, vigente_hasta
         FROM visitante WHERE codigo_acceso = ? FOR UPDATE`,
      [folio]
    );
    return visitante || null;
  }

  async function ultimoMovimientoVisitante(idVisitante, fecha, tx) {
    const [[ultimo]] = await tx.query(
      `SELECT fecha_salida IS NOT NULL AS fue_salida,
              TIMESTAMPDIFF(SECOND, COALESCE(fecha_salida, fecha_entrada), ?) AS segundos
         FROM registroacceso
        WHERE id_visitante = ?
        ORDER BY fecha_entrada DESC, id_registro DESC LIMIT 1`,
      [fecha, idVisitante]
    );
    return ultimo ? { fue_salida: Boolean(ultimo.fue_salida), segundos: Number(ultimo.segundos) } : null;
  }

  async function entradaAbiertaVisitante(idVisitante, tx) {
    const [[abierto]] = await tx.query(
      `SELECT id_registro, fecha_entrada FROM registroacceso
        WHERE id_visitante = ? AND fecha_salida IS NULL AND cierre_automatico IS NULL
        ORDER BY fecha_entrada DESC LIMIT 1 FOR UPDATE`,
      [idVisitante]
    );
    return abierto || null;
  }

  async function crearEntradaVisitante({ idVisitante, fecha }, tx) {
    await tx.query('INSERT INTO registroacceso (id_visitante, fecha_entrada) VALUES (?, ?)', [idVisitante, fecha]);
  }

  async function cerrarEntradaVisitante({ id, fecha }, tx) {
    await tx.query('UPDATE registroacceso SET fecha_salida = ? WHERE id_registro = ?', [fecha, id]);
  }

  async function buscarUsuario(matricula) {
    const [[usuario]] = await pool.query(
      'SELECT matricula, nombre, apellido_paterno, apellido_materno FROM usuario WHERE matricula = ?',
      [matricula]
    );
    return usuario || null;
  }

  return {
    conTransaccion,
    obtenerUsuarioParaAcceso,
    obtenerPlacas,
    obtenerAreaPrincipal,
    ultimoMovimientoUsuario,
    entradaAbiertaUsuario,
    crearEntradaUsuario,
    cerrarEntradaUsuario,
    marcarCierreAutomatico,
    actualizarEstatusUsuario,
    obtenerVisitantePorFolio,
    ultimoMovimientoVisitante,
    entradaAbiertaVisitante,
    crearEntradaVisitante,
    cerrarEntradaVisitante,
    buscarUsuario
  };
}

module.exports = { crearAccessRepo };
