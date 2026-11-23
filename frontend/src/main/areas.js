// areas.js — áreas, carreras y turnos de los usuarios
//
// Una persona (un solo registro en usuario, un solo QR) puede tener varias combinaciones
// en usuario_area: área + carrera (solo en áreas con requiere_carrera) + turnos (casillas
// en usuario_area_turno). Una de ellas es la principal.
// Formato que viaja entre renderer y proceso principal:
//   [{ id_area, id_carrera, turnos: [id_turno], principal }]
const { ipcMain } = require('electron');
const {
  validarAreas,
  agruparAreas,
  resumenAreas,
  areaPrincipal,
  filtroPorAreas
} = require('@ssa/shared');

let pool;

async function obtenerCatalogos(db = pool) {
  const [areas] = await db.query('SELECT id_area, nombre, requiere_carrera FROM area ORDER BY id_area');
  const [carreras] = await db.query('SELECT id_carrera, nombre_carrera AS nombre FROM carrera ORDER BY id_carrera');
  const [turnos] = await db.query('SELECT id_turno, nombre FROM turno ORDER BY id_turno');
  return {
    areas: areas.map((a) => ({ ...a, requiere_carrera: Boolean(a.requiere_carrera) })),
    carreras,
    turnos
  };
}

// Reemplaza las combinaciones del usuario (usar dentro de una transacción)
async function guardarAreas(conexion, matricula, areas) {
  await conexion.query('DELETE FROM usuario_area WHERE matricula = ?', [matricula]);
  for (const area of areas) {
    const [resultado] = await conexion.query(
      'INSERT INTO usuario_area (matricula, id_area, id_carrera, principal) VALUES (?, ?, ?, ?)',
      [matricula, area.id_area, area.id_carrera, area.principal ? 1 : 0]
    );
    await conexion.query(
      'INSERT INTO usuario_area_turno (id_usuario_area, id_turno) VALUES ?',
      [area.turnos.map((idTurno) => [resultado.insertId, idTurno])]
    );
  }
}

/**
 * Combinaciones de varios usuarios: Map matricula -> [{ id_area, area, id_carrera, carrera, turnos, principal }],
 * con la principal primero.
 */
async function obtenerAreasDeUsuarios(matriculas, db = pool) {
  const resultado = new Map();
  const lista = [...new Set(matriculas.filter((m) => m != null).map(Number))];
  if (lista.length === 0) return resultado;
  const [filas] = await db.query(
    `SELECT ua.matricula, ua.id_usuario_area, ua.id_area, a.nombre AS area, ua.id_carrera,
            c.nombre_carrera AS carrera, ua.principal, t.id_turno, t.nombre AS turno
       FROM usuario_area ua
       JOIN area a ON a.id_area = ua.id_area
       LEFT JOIN carrera c ON c.id_carrera = ua.id_carrera
       LEFT JOIN usuario_area_turno uat ON uat.id_usuario_area = ua.id_usuario_area
       LEFT JOIN turno t ON t.id_turno = uat.id_turno
      WHERE ua.matricula IN (?)
      ORDER BY ua.matricula, ua.principal DESC, ua.id_usuario_area, t.id_turno`,
    [lista]
  );
  return agruparAreas(filas);
}

// Agrega la propiedad "areas" a cada fila que tenga matricula
async function adjuntarAreas(filas, db = pool) {
  const mapa = await obtenerAreasDeUsuarios(filas.map((f) => f.matricula), db);
  return filas.map((f) => ({ ...f, areas: mapa.get(Number(f.matricula)) || [] }));
}

function setupAreas(poolDB) {
  pool = poolDB;
  ipcMain.handle('obtener-catalogos', () => obtenerCatalogos());
}

module.exports = {
  setupAreas,
  obtenerCatalogos,
  validarAreas,
  guardarAreas,
  obtenerAreasDeUsuarios,
  adjuntarAreas,
  resumenAreas,
  areaPrincipal,
  filtroPorAreas
};
