// transporte.js — contrato del transporte de sincronización
//
// Fase 2: MySQL directo (transporteMySQL.js). Fase 3: HTTP (misma interfaz).
/**
 * @typedef {Object} Transporte
 * @property {() => Promise<boolean>} probarConexion
 * @property {(eventos: Object[]) => Promise<{aplicados: string[], conflictos: {uuid:string, motivo:string}[]}>} aplicarEventos
 */

function cumpleContratoTransporte(transporte) {
  return ['probarConexion', 'aplicarEventos'].filter(
    (metodo) => !transporte || typeof transporte[metodo] !== 'function'
  );
}

module.exports = { cumpleContratoTransporte };
