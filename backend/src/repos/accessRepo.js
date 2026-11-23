// accessRepo.js — contrato del repositorio de accesos (MySQL o SQLite)
//
// El servicio de @ssa/shared solo conoce esta interfaz. Cada método que modifica o lee
// estado de un movimiento recibe la transacción (tx) para que el servicio controle el commit.
//
// @typedef {Object} Tx transacción opaca (conexión MySQL o transacción SQLite)
//
// @typedef {Object} UsuarioAcceso
// @property {number} matricula
// @property {string} nombre
// @property {string} apellido_paterno
// @property {string} apellido_materno
//
// @typedef {Object} MovimientoReciente
// @property {boolean} fue_salida
// @property {number} segundos
//
// @typedef {Object} EntradaAbierta
// @property {number|string} id_registro
// @property {Date|string} fecha_entrada
// @property {string} medio_entrada
//
// @typedef {Object} VisitanteAcceso
// @property {number|string} id_visitante
// @property {string} nombre
// @property {string} apellido_paterno
// @property {string} apellido_materno
// @property {string} tipo
// @property {string} motivo
// @property {Date|string} vigente_hasta

const METODOS = [
  'conTransaccion',
  'obtenerUsuarioParaAcceso',
  'obtenerPlacas',
  'obtenerAreaPrincipal',
  'ultimoMovimientoUsuario',
  'entradaAbiertaUsuario',
  'crearEntradaUsuario',
  'cerrarEntradaUsuario',
  'marcarCierreAutomatico',
  'actualizarEstatusUsuario',
  'obtenerVisitantePorFolio',
  'ultimoMovimientoVisitante',
  'entradaAbiertaVisitante',
  'crearEntradaVisitante',
  'cerrarEntradaVisitante',
  'buscarUsuario'
];

// Devuelve los métodos que le faltan a un repositorio para cumplir el contrato.
function cumpleContrato(repo) {
  return METODOS.filter((metodo) => !repo || typeof repo[metodo] !== 'function');
}

module.exports = { METODOS, cumpleContrato };
