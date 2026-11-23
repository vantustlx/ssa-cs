// transporteMySQL.js — replay temporal de la outbox a MySQL (Fase 2)
//
// Es el mismo contrato que usará el transporte HTTP de la Fase 3. La deduplicación
// se hace con sync_evento + registroacceso.uuid.

const TIEMPO_LIMITE_MS = 3000;

function aMysqlDatetime(iso) {
  const d = new Date(iso);
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

function crearTransporteMySQL(pool) {
  async function probarConexion() {
    let temporizador;
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, rechazar) => {
          temporizador = setTimeout(() => rechazar(new Error('Tiempo de espera de MySQL')), TIEMPO_LIMITE_MS);
        })
      ]);
      return true;
    } catch (error) {
      return false;
    } finally {
      clearTimeout(temporizador);
    }
  }

  async function yaAplicado(conexion, uuid, tipo) {
    const [resultado] = await conexion.query(
      'INSERT IGNORE INTO sync_evento (uuid, tipo) VALUES (?, ?)',
      [uuid, tipo]
    );
    return resultado.affectedRows === 0;
  }

  async function registrarNotificaciones(conexion, evento) {
    if (!['ENTRADA', 'SALIDA'].includes(evento.tipo)) return;
    const avisos = Array.isArray(evento.avisos) ? evento.avisos : [];
    for (const aviso of avisos) {
      await conexion.query(
        `INSERT INTO notificacion (tipo, matricula, titulo, mensaje, fecha_hora)
         VALUES ('ACCESO_INCONSISTENTE', ?, ?, ?, ?)`,
        [
          evento.matricula ?? null,
          `Acceso inconsistente · ${evento.lector || 'lector'}`,
          `${evento.nombre || 'Usuario'} (${evento.matricula ?? evento.id_visitante}): ${aviso}.`,
          aMysqlDatetime(evento.fecha)
        ]
      );
    }
  }

  async function aplicarEventos(eventos) {
    if (!eventos.length) return { aplicados: [], conflictos: [] };

    const conexion = await pool.getConnection();
    const aplicados = [];
    const conflictos = [];
    try {
      await conexion.beginTransaction();

      for (const evento of eventos) {
        if (await yaAplicado(conexion, evento.uuid, evento.tipo)) {
          aplicados.push(evento.uuid);
          continue;
        }

        if (evento.tipo === 'ENTRADA') {
          const [[existente]] = await conexion.query(
            'SELECT 1 AS ok FROM registroacceso WHERE uuid = ?',
            [evento.uuid]
          );
          if (!existente) {
            if (evento.entidad === 'VISITANTE') {
              await conexion.query(
                'INSERT INTO registroacceso (uuid, id_visitante, fecha_entrada) VALUES (?, ?, ?)',
                [evento.uuid, evento.id_visitante, aMysqlDatetime(evento.fecha)]
              );
            } else {
              await conexion.query(
                `INSERT INTO registroacceso (uuid, matricula, fecha_entrada, medio_entrada)
                 VALUES (?, ?, ?, ?)`,
                [evento.uuid, evento.matricula, aMysqlDatetime(evento.fecha), evento.medio]
              );
            }
          }
        } else if (evento.tipo === 'SALIDA') {
          const [resultado] = evento.entidad === 'VISITANTE'
            ? await conexion.query(
              'UPDATE registroacceso SET fecha_salida = ? WHERE uuid = ?',
              [aMysqlDatetime(evento.fecha), evento.registro_uuid]
            )
            : await conexion.query(
              'UPDATE registroacceso SET fecha_salida = ?, medio_salida = ? WHERE uuid = ?',
              [aMysqlDatetime(evento.fecha), evento.medio, evento.registro_uuid]
            );
          if (resultado.affectedRows === 0) {
            await conexion.query('DELETE FROM sync_evento WHERE uuid = ?', [evento.uuid]);
            conflictos.push({ uuid: evento.uuid, motivo: 'entrada no encontrada' });
            continue;
          }
        } else if (evento.tipo === 'CIERRE') {
          const [resultado] = await conexion.query(
            'UPDATE registroacceso SET cierre_automatico = ? WHERE uuid = ? AND cierre_automatico IS NULL',
            [aMysqlDatetime(evento.fecha), evento.registro_uuid]
          );
          if (resultado.affectedRows === 0) {
            const [[existente]] = await conexion.query(
              'SELECT 1 AS ok FROM registroacceso WHERE uuid = ?',
              [evento.registro_uuid]
            );
            if (!existente) {
              await conexion.query('DELETE FROM sync_evento WHERE uuid = ?', [evento.uuid]);
              conflictos.push({ uuid: evento.uuid, motivo: 'entrada no encontrada' });
              continue;
            }
          }
        } else if (evento.tipo === 'ACCESO_FALLIDO') {
          await conexion.query(
            `INSERT INTO accesos_fallidos (matricula_intentada, tipo_error, descripcion, fecha_hora)
             VALUES (?, ?, ?, ?)`,
            [evento.texto, evento.tipoError, evento.descripcion, aMysqlDatetime(evento.fecha)]
          );
        } else {
          await conexion.query('DELETE FROM sync_evento WHERE uuid = ?', [evento.uuid]);
          conflictos.push({ uuid: evento.uuid, motivo: `tipo desconocido: ${evento.tipo}` });
          continue;
        }

        await registrarNotificaciones(conexion, evento);
        aplicados.push(evento.uuid);
      }

      await conexion.commit();
      return { aplicados, conflictos };
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  return { probarConexion, aplicarEventos };
}

module.exports = { crearTransporteMySQL, aMysqlDatetime };
