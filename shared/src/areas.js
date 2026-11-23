// areas.js — reglas puras de áreas, carreras y turnos
//
// Formato que viaja entre renderer y proceso principal:
//   [{ id_area, id_carrera, turnos: [id_turno], principal }]
const MAX_COMBINACIONES = 10;

/**
 * Valida y normaliza las combinaciones de un usuario contra los catálogos.
 * Devuelve { errores, areas } con ids numéricos, sin duplicados de turno y una sola principal.
 */
function validarAreas(entrada, catalogos) {
  const errores = [];
  if (!Array.isArray(entrada) || entrada.length === 0) {
    return { errores: ['Agrega al menos un área'], areas: [] };
  }
  if (entrada.length > MAX_COMBINACIONES) errores.push(`Máximo ${MAX_COMBINACIONES} áreas por persona`);

  const areas = [];
  const vistas = new Set();
  entrada.forEach((item, i) => {
    const n = i + 1;
    const area = catalogos.areas.find((a) => a.id_area === Number(item && item.id_area));
    if (!area) {
      errores.push(`Área ${n}: selecciona un área`);
      return;
    }
    let idCarrera = null;
    if (area.requiere_carrera) {
      const carrera = catalogos.carreras.find((c) => c.id_carrera === Number(item.id_carrera));
      if (!carrera) errores.push(`Área ${n} (${area.nombre}): selecciona una carrera`);
      else idCarrera = carrera.id_carrera;
    }
    const turnos = [...new Set((Array.isArray(item.turnos) ? item.turnos : []).map(Number))]
      .filter((id) => catalogos.turnos.some((t) => t.id_turno === id));
    if (turnos.length === 0) errores.push(`Área ${n} (${area.nombre}): marca al menos un turno`);

    const clave = `${area.id_area}:${idCarrera}`;
    if (vistas.has(clave)) errores.push(`Área ${n} (${area.nombre}): está repetida`);
    vistas.add(clave);

    areas.push({ id_area: area.id_area, id_carrera: idCarrera, turnos, principal: Boolean(item.principal) });
  });

  const principales = areas.filter((a) => a.principal).length;
  if (principales !== 1 && errores.length === 0) errores.push('Marca una sola área como principal');
  return { errores, areas };
}

/**
 * Agrupa filas SQL (usuario_area + area + carrera + turnos) en Map matricula -> combinaciones,
 * con la principal primero según el ORDER BY de la consulta.
 */
function agruparAreas(filas) {
  const resultado = new Map();
  const porCombinacion = new Map();
  for (const f of filas) {
    let combinacion = porCombinacion.get(f.id_usuario_area);
    if (!combinacion) {
      combinacion = {
        id_area: f.id_area,
        area: f.area,
        id_carrera: f.id_carrera,
        carrera: f.carrera,
        turnos: [],
        principal: Boolean(f.principal)
      };
      porCombinacion.set(f.id_usuario_area, combinacion);
      if (!resultado.has(f.matricula)) resultado.set(f.matricula, []);
      resultado.get(f.matricula).push(combinacion);
    }
    if (f.id_turno) combinacion.turnos.push({ id_turno: f.id_turno, nombre: f.turno });
  }
  return resultado;
}

// "Estudiante (Ing. en Computación · Matutino, Vespertino); Administrativo (Ing. Química · Nocturno)"
function resumenAreas(areas = []) {
  return areas.map((a) => {
    const detalle = [a.carrera, a.turnos.map((t) => t.nombre).join(', ')].filter(Boolean).join(' · ');
    return detalle ? `${a.area} (${detalle})` : a.area;
  }).join('; ');
}

// Para espacios cortos (monitor del lector, PDF del cierre): área principal y cuántas más tiene
function areaPrincipal(areas = []) {
  if (areas.length === 0) return '';
  const principal = areas.find((a) => a.principal) || areas[0];
  return areas.length > 1 ? `${principal.area} (+${areas.length - 1})` : principal.area;
}

/**
 * Condición SQL para búsquedas por grupo. Los filtros se aplican a la MISMA combinación:
 * "Docente + Vespertino" no incluye a quien es estudiante en la tarde y docente en la mañana.
 * Cada filtro es opcional (null o '' = todos). La tabla de usuario debe llamarse "u".
 */
function filtroPorAreas({ area, carrera, turno } = {}) {
  const valor = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const [idArea, idCarrera, idTurno] = [valor(area), valor(carrera), valor(turno)];
  return {
    sql: `EXISTS (
      SELECT 1 FROM usuario_area ua
       WHERE ua.matricula = u.matricula
         AND (? IS NULL OR ua.id_area = ?)
         AND (? IS NULL OR ua.id_carrera = ?)
         AND (? IS NULL OR EXISTS (SELECT 1 FROM usuario_area_turno uat
                                    WHERE uat.id_usuario_area = ua.id_usuario_area AND uat.id_turno = ?)))`,
    params: [idArea, idArea, idCarrera, idCarrera, idTurno, idTurno]
  };
}

module.exports = { MAX_COMBINACIONES, validarAreas, agruparAreas, resumenAreas, areaPrincipal, filtroPorAreas };
