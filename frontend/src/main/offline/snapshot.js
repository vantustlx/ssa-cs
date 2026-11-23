// snapshot.js — snapshot completo desde MySQL (Fase 2) y su aplicación a SQLite
const { agruparAreas, areaPrincipal } = require('@ssa/shared');

function crearSnapshot({ pool, offlineDb, config, firma }) {
  async function leer() {
    const [usuarios] = await pool.query(
      'SELECT matricula, nombre, apellido_paterno, apellido_materno, estatus FROM usuario'
    );
    const [vehiculos] = await pool.query(
      'SELECT matricula, placa FROM vehiculo ORDER BY matricula, placa'
    );
    const [filasAreas] = await pool.query(
      `SELECT ua.matricula, ua.id_usuario_area, ua.id_area, a.nombre AS area, ua.id_carrera,
              c.nombre_carrera AS carrera, ua.principal, t.id_turno, t.nombre AS turno
         FROM usuario_area ua
         JOIN area a ON a.id_area = ua.id_area
         LEFT JOIN carrera c ON c.id_carrera = ua.id_carrera
         LEFT JOIN usuario_area_turno uat ON uat.id_usuario_area = ua.id_usuario_area
         LEFT JOIN turno t ON t.id_turno = uat.id_turno
        ORDER BY ua.matricula, ua.principal DESC, ua.id_usuario_area, t.id_turno`
    );
    const [visitantes] = await pool.query(
      `SELECT id_visitante, codigo_acceso, nombre, apellido_paterno, apellido_materno, tipo, motivo, vigente_hasta
         FROM visitante
        WHERE vigente_hasta >= NOW()`
    );

    const areasPorMatricula = agruparAreas(filasAreas);

    return {
      generadoEn: new Date().toISOString(),
      usuarios: usuarios.map((u) => ({
        matricula: Number(u.matricula),
        nombre: u.nombre || null,
        apellido_paterno: u.apellido_paterno || null,
        apellido_materno: u.apellido_materno || null,
        estatus: u.estatus || null,
        area_principal: areaPrincipal(areasPorMatricula.get(Number(u.matricula)) || []),
        firma_qr: firma(u.matricula)
      })),
      vehiculos: vehiculos.map((v) => ({ matricula: Number(v.matricula), placa: v.placa })),
      visitantes: visitantes.map((v) => ({
        id_visitante: Number(v.id_visitante),
        codigo_acceso: v.codigo_acceso,
        nombre: v.nombre || null,
        apellido_paterno: v.apellido_paterno || null,
        apellido_materno: v.apellido_materno || null,
        tipo: v.tipo || null,
        motivo: v.motivo || null,
        vigente_hasta: v.vigente_hasta ? new Date(v.vigente_hasta).toISOString() : null
      })),
      config: {
        antirreboteSegundos: config.lectores.antirreboteSegundos,
        intervaloMinimoSegundos: config.lectores.intervaloMinimoSegundos,
        cierreHora: config.cierre.hora,
        aceptarSinFirma: config.qr.aceptarSinFirma
      }
    };
  }

  function aplicar(snapshot) {
    return offlineDb.transaccion((tx) => {
      tx.exec('DELETE FROM usuario_local; DELETE FROM vehiculo_local; DELETE FROM visitante_local;');

      const insertarUsuario = tx.prepare(
        `INSERT INTO usuario_local
           (matricula, nombre, apellido_paterno, apellido_materno, estatus, firma_qr, area_principal, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const u of snapshot.usuarios) {
        insertarUsuario.run(
          u.matricula,
          u.nombre ?? null,
          u.apellido_paterno ?? null,
          u.apellido_materno ?? null,
          u.estatus ?? null,
          u.firma_qr ?? null,
          u.area_principal ?? '',
          snapshot.generadoEn
        );
      }

      const insertarVehiculo = tx.prepare(
        'INSERT INTO vehiculo_local (matricula, placa) VALUES (?, ?)'
      );
      for (const v of snapshot.vehiculos) insertarVehiculo.run(v.matricula, v.placa ?? null);

      const insertarVisitante = tx.prepare(
        `INSERT INTO visitante_local
           (id_visitante, codigo_acceso, nombre, apellido_paterno, apellido_materno, tipo, motivo, vigente_hasta, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const v of snapshot.visitantes) {
        insertarVisitante.run(
          v.id_visitante,
          v.codigo_acceso,
          v.nombre ?? null,
          v.apellido_paterno ?? null,
          v.apellido_materno ?? null,
          v.tipo ?? null,
          v.motivo ?? null,
          v.vigente_hasta ?? null,
          snapshot.generadoEn
        );
      }

      const guardarMeta = tx.prepare(
        'INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'
      );
      guardarMeta.run('snapshot_ts', snapshot.generadoEn);
      if (snapshot.config) guardarMeta.run('config', JSON.stringify(snapshot.config));
    });
  }

  return { leer, aplicar };
}

module.exports = { crearSnapshot };
