// sqliteAccessRepo.js — repositorio de accesos sobre SQLite
//
// Cada movimiento y su evento de outbox se escriben en la misma transacción para que un
// corte de energía no pierda el evento.
const crypto = require('crypto');

const iso = (fecha) => new Date(fecha).toISOString();

function nuevoUuid() {
  return crypto.randomUUID();
}

function crearEvento({
  uuid = nuevoUuid(),
  tipo,
  entidad = null,
  matricula = null,
  idVisitante = null,
  registroUuid = null,
  fecha,
  medio = null,
  contexto = {},
  texto = null,
  tipoError = null,
  descripcion = null
}) {
  return {
    uuid,
    tipo,
    entidad,
    matricula,
    id_visitante: idVisitante,
    registro_uuid: registroUuid,
    fecha: iso(fecha),
    medio,
    origen: contexto.origen || null,
    lector: contexto.lector || null,
    folio: contexto.folio || null,
    nombre: contexto.nombre || null,
    rol: contexto.rol || null,
    motivo: contexto.motivo || null,
    avisos: Array.isArray(contexto.avisos) ? contexto.avisos : [],
    texto,
    tipoError,
    descripcion
  };
}

function insertarOutbox(tx, evento) {
  tx.prepare(
    `INSERT INTO outbox (uuid, tipo, payload, creado_en, intentos, estado)
     VALUES (?, ?, ?, ?, 0, 'PENDIENTE')`
  ).run(evento.uuid, evento.tipo, JSON.stringify(evento), evento.fecha);
}

function crearSqliteAccessRepo(offlineDb, {
  generarUuid = nuevoUuid,
  ahora = () => new Date()
} = {}) {
  const { db, transaccion } = offlineDb;

  function entradaAbierta(filtro, valor, tx) {
    return tx.prepare(
      `SELECT uuid AS id_registro, entrada_utc AS fecha_entrada, medio_entrada
         FROM registro_local
        WHERE ${filtro} = ? AND salida_utc IS NULL AND cierre_automatico_utc IS NULL
        ORDER BY entrada_utc DESC, rowid DESC
        LIMIT 1`
    ).get(valor) || null;
  }

  function ultimoMovimiento(filtro, valor, fecha, tx) {
    const fila = tx.prepare(
      `SELECT entrada_utc, salida_utc
         FROM registro_local
        WHERE ${filtro} = ?
        ORDER BY entrada_utc DESC, rowid DESC
        LIMIT 1`
    ).get(valor);
    if (!fila) return null;
    const fin = fila.salida_utc || fila.entrada_utc;
    return {
      fue_salida: Boolean(fila.salida_utc),
      segundos: Math.floor((new Date(fecha) - new Date(fin)) / 1000)
    };
  }

  function registroPorUuid(uuid, tx) {
    return tx.prepare(
      'SELECT uuid, matricula, id_visitante FROM registro_local WHERE uuid = ?'
    ).get(uuid) || null;
  }

  return {
    async conTransaccion(fn) {
      return transaccion(fn);
    },

    async obtenerUsuarioParaAcceso(matricula, tx) {
      return tx.prepare(
        'SELECT matricula, nombre, apellido_paterno, apellido_materno FROM usuario_local WHERE matricula = ?'
      ).get(Number(matricula)) || null;
    },

    async obtenerPlacas(matricula, tx) {
      return tx.prepare(
        'SELECT placa FROM vehiculo_local WHERE matricula = ? ORDER BY placa'
      ).all(Number(matricula)).map((fila) => fila.placa);
    },

    async obtenerAreaPrincipal(matricula, tx) {
      const fila = tx.prepare(
        'SELECT area_principal FROM usuario_local WHERE matricula = ?'
      ).get(Number(matricula));
      return (fila && fila.area_principal) || '';
    },

    async ultimoMovimientoUsuario(matricula, fecha, tx) {
      return ultimoMovimiento('matricula', Number(matricula), fecha, tx);
    },

    async entradaAbiertaUsuario(matricula, tx) {
      return entradaAbierta('matricula', Number(matricula), tx);
    },

    async crearEntradaUsuario({ matricula, medio, fecha, contexto = {} }, tx) {
      const uuid = generarUuid();
      tx.prepare(
        `INSERT INTO registro_local
           (uuid, matricula, id_visitante, entrada_utc, salida_utc, medio_entrada, medio_salida, cierre_automatico_utc, sync_estado)
         VALUES (?, ?, NULL, ?, NULL, ?, NULL, NULL, 'PENDIENTE')`
      ).run(uuid, matricula, iso(fecha), medio);
      insertarOutbox(tx, crearEvento({
        uuid,
        tipo: 'ENTRADA',
        entidad: 'USUARIO',
        matricula,
        registroUuid: uuid,
        fecha,
        medio,
        contexto
      }));
    },

    async cerrarEntradaUsuario({ id, medio, fecha, contexto = {} }, tx) {
      const registro = registroPorUuid(id, tx);
      if (!registro) throw new Error(`Entrada local no encontrada: ${id}`);
      tx.prepare(
        "UPDATE registro_local SET salida_utc = ?, medio_salida = ?, sync_estado = 'PENDIENTE' WHERE uuid = ?"
      ).run(iso(fecha), medio, id);
      insertarOutbox(tx, crearEvento({
        tipo: 'SALIDA',
        entidad: 'USUARIO',
        matricula: registro.matricula,
        registroUuid: id,
        fecha,
        medio,
        contexto
      }));
    },

    async marcarCierreAutomatico({ id, fecha, contexto = {} }, tx) {
      const registro = registroPorUuid(id, tx);
      if (!registro) throw new Error(`Entrada local no encontrada: ${id}`);
      tx.prepare(
        "UPDATE registro_local SET cierre_automatico_utc = ?, sync_estado = 'PENDIENTE' WHERE uuid = ?"
      ).run(iso(fecha), id);
      insertarOutbox(tx, crearEvento({
        tipo: 'CIERRE',
        entidad: registro.id_visitante ? 'VISITANTE' : 'USUARIO',
        matricula: registro.matricula,
        idVisitante: registro.id_visitante,
        registroUuid: id,
        fecha,
        contexto
      }));
    },

    async actualizarEstatusUsuario(matricula, estatus, tx) {
      tx.prepare('UPDATE usuario_local SET estatus = ? WHERE matricula = ?').run(estatus, Number(matricula));
    },

    async obtenerVisitantePorFolio(folio, tx) {
      return tx.prepare(
        `SELECT id_visitante, codigo_acceso, nombre, apellido_paterno, apellido_materno, tipo, motivo, vigente_hasta
           FROM visitante_local WHERE codigo_acceso = ?`
      ).get(folio) || null;
    },

    async ultimoMovimientoVisitante(idVisitante, fecha, tx) {
      return ultimoMovimiento('id_visitante', Number(idVisitante), fecha, tx);
    },

    async entradaAbiertaVisitante(idVisitante, tx) {
      return entradaAbierta('id_visitante', Number(idVisitante), tx);
    },

    async crearEntradaVisitante({ idVisitante, fecha, contexto = {} }, tx) {
      const uuid = generarUuid();
      tx.prepare(
        `INSERT INTO registro_local
           (uuid, matricula, id_visitante, entrada_utc, salida_utc, medio_entrada, medio_salida, cierre_automatico_utc, sync_estado)
         VALUES (?, NULL, ?, ?, NULL, NULL, NULL, NULL, 'PENDIENTE')`
      ).run(uuid, idVisitante, iso(fecha));
      insertarOutbox(tx, crearEvento({
        uuid,
        tipo: 'ENTRADA',
        entidad: 'VISITANTE',
        idVisitante,
        registroUuid: uuid,
        fecha,
        contexto
      }));
    },

    async cerrarEntradaVisitante({ id, fecha, contexto = {} }, tx) {
      const registro = registroPorUuid(id, tx);
      if (!registro) throw new Error(`Entrada local no encontrada: ${id}`);
      tx.prepare(
        "UPDATE registro_local SET salida_utc = ?, sync_estado = 'PENDIENTE' WHERE uuid = ?"
      ).run(iso(fecha), id);
      insertarOutbox(tx, crearEvento({
        tipo: 'SALIDA',
        entidad: 'VISITANTE',
        idVisitante: registro.id_visitante,
        registroUuid: id,
        fecha,
        contexto
      }));
    },

    async buscarUsuario(matricula) {
      return db.prepare(
        'SELECT matricula, nombre, apellido_paterno, apellido_materno FROM usuario_local WHERE matricula = ?'
      ).get(Number(matricula)) || null;
    },

    obtenerFirma(matricula) {
      const fila = db.prepare('SELECT firma_qr FROM usuario_local WHERE matricula = ?').get(Number(matricula));
      return (fila && fila.firma_qr) || null;
    },

    async registrarAccesoFallido(texto, tipoError, descripcion) {
      const evento = crearEvento({
        tipo: 'ACCESO_FALLIDO',
        fecha: ahora(),
        texto,
        tipoError,
        descripcion
      });
      await transaccion((tx) => insertarOutbox(tx, evento));
      return evento;
    }
  };
}

module.exports = { crearSqliteAccessRepo, nuevoUuid, crearEvento };
