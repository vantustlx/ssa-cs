// sync.js — worker de sincronización (subida de outbox y bajada de snapshot)
const LOTE = 200;
const INTERVALO_MS = 30 * 1000;
const INTERVALO_SNAPSHOT_MS = 5 * 60 * 1000;

function crearSync({
  offlineDb,
  transporte,
  estado,
  cargarSnapshot,
  aplicarSnapshot,
  lote = LOTE,
  intervaloMs = INTERVALO_MS,
  snapshotCadaMs = INTERVALO_SNAPSHOT_MS
} = {}) {
  let ejecutando = false;
  let ultimoSnapshot = 0;
  let timer = null;
  let debounce = null;

  async function marcarError(uuids, mensaje) {
    if (!uuids.length) return;
    await offlineDb.transaccion((tx) => {
      const marcar = tx.prepare(
        "UPDATE outbox SET intentos = intentos + 1, ultimo_error = ? WHERE uuid = ?"
      );
      for (const uuid of uuids) marcar.run(mensaje, uuid);
    });
  }

  async function marcarInvalidos(uuids) {
    if (!uuids.length) return;
    await offlineDb.transaccion((tx) => {
      const marcar = tx.prepare(
        "UPDATE outbox SET estado = 'ERROR', ultimo_error = 'payload inválido' WHERE uuid = ?"
      );
      for (const uuid of uuids) marcar.run(uuid);
    });
  }

  async function subirPendientes() {
    const leer = offlineDb.db.prepare(
      "SELECT uuid, payload FROM outbox WHERE estado = 'PENDIENTE' ORDER BY creado_en, rowid LIMIT ?"
    );

    while (true) {
      const filas = leer.all(lote);
      if (!filas.length) return;

      const eventos = [];
      const invalidos = [];
      for (const fila of filas) {
        try {
          eventos.push(JSON.parse(fila.payload));
        } catch (error) {
          invalidos.push(fila.uuid);
        }
      }
      if (invalidos.length) await marcarInvalidos(invalidos);
      if (!eventos.length) return;

      let resultado;
      try {
        resultado = await transporte.aplicarEventos(eventos);
      } catch (error) {
        await marcarError(eventos.map((e) => e.uuid), error.message);
        throw error;
      }

      const aplicados = new Set(resultado.aplicados || []);
      const conflictos = new Map((resultado.conflictos || []).map((c) => [c.uuid, c.motivo || 'conflicto']));

      await offlineDb.transaccion((tx) => {
        const marcar = tx.prepare(
          'UPDATE outbox SET estado = ?, intentos = intentos + 1, ultimo_error = ? WHERE uuid = ?'
        );
        for (const evento of eventos) {
          if (aplicados.has(evento.uuid)) marcar.run('ENVIADO', null, evento.uuid);
          else if (conflictos.has(evento.uuid)) marcar.run('PENDIENTE', conflictos.get(evento.uuid), evento.uuid);
        }
      });

      estado.actualizar({ ultimaSync: new Date().toISOString() });
      estado.publicar();

      // Ante un conflicto o un evento no contabilizado se reintenta en la siguiente pasada.
      if (conflictos.size) return;
      if (!aplicados.size) return;
      if (eventos.some((e) => !aplicados.has(e.uuid) && !conflictos.has(e.uuid))) return;
    }
  }

  async function bajarSnapshot() {
    const snapshot = await cargarSnapshot();
    if (!snapshot) return;
    await aplicarSnapshot(snapshot);
    ultimoSnapshot = Date.now();
    estado.actualizar({ snapshotTs: snapshot.generadoEn, ultimaSync: new Date().toISOString() });
    estado.publicar();
    console.log(
      `[SYNC] Snapshot aplicado: ${snapshot.usuarios.length} usuarios, ` +
      `${snapshot.vehiculos.length} vehículos, ${snapshot.visitantes.length} visitantes`
    );
  }

  async function ejecutar({ forzarSnapshot = false } = {}) {
    if (ejecutando) return;
    ejecutando = true;
    estado.actualizar({ sincronizando: true });
    estado.publicar();

    try {
      const online = await transporte.probarConexion();
      estado.actualizar({ online, error: online ? null : 'Sin conexión' });
      if (!online) return;

      await subirPendientes();

      if (forzarSnapshot || !ultimoSnapshot || Date.now() - ultimoSnapshot >= snapshotCadaMs) {
        await bajarSnapshot();
      }

      estado.actualizar({ ultimaSync: new Date().toISOString(), error: null });
    } catch (error) {
      estado.actualizar({ online: false, error: error.message });
      console.error('[SYNC] Error de sincronización:', error.message);
    } finally {
      ejecutando = false;
      estado.actualizar({ sincronizando: false });
      estado.publicar();
    }
  }

  function iniciar() {
    if (timer) return;
    ejecutar();
    timer = setInterval(() => ejecutar(), intervaloMs);
  }

  function detener() {
    if (timer) clearInterval(timer);
    if (debounce) clearTimeout(debounce);
    timer = null;
    debounce = null;
  }

  function solicitar() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      ejecutar();
    }, 500);
  }

  return {
    ejecutar,
    iniciar,
    detener,
    solicitar,
    sincronizarAhora: () => ejecutar({ forzarSnapshot: true }),
    subirPendientes,
    bajarSnapshot
  };
}

module.exports = { crearSync };
