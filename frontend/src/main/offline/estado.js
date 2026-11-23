// estado.js — estado de sincronización del lector (para IPC y UI)
function crearEstado(offlineDb, { alCambiar = () => {} } = {}) {
  const { db } = offlineDb;
  const filaSnapshot = db.prepare('SELECT valor FROM meta WHERE clave = ?').get('snapshot_ts');
  const estado = {
    online: false,
    pendientes: 0,
    snapshotTs: (filaSnapshot && filaSnapshot.valor) || null,
    ultimaSync: null,
    error: null,
    sincronizando: false
  };

  function contarPendientes() {
    const fila = db.prepare("SELECT COUNT(*) AS total FROM outbox WHERE estado = 'PENDIENTE'").get();
    return Number(fila && fila.total) || 0;
  }

  function instantanea() {
    return { ...estado, pendientes: contarPendientes() };
  }

  function actualizar(parcial = {}) {
    Object.assign(estado, parcial);
  }

  function publicar() {
    alCambiar(instantanea());
  }

  return { estado, actualizar, instantanea, publicar, contarPendientes };
}

module.exports = { crearEstado };
