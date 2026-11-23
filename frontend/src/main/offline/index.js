// index.js — orquestador de la capa offline del lector
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { Antirrebote, crearServicioAcceso } = require('@ssa/shared');
const { crearDb } = require('./db');
const { crearEsquema } = require('./esquema');
const { crearSqliteAccessRepo } = require('./sqliteAccessRepo');
const { crearCola } = require('./cola');
const { crearQrLocal } = require('./qrLocal');
const { crearSnapshot } = require('./snapshot');
const { crearTransporteMySQL } = require('./transporteMySQL');
const { crearEstado } = require('./estado');
const { crearSync } = require('./sync');
const { crearCierreLocal } = require('./cierreLocal');
const { firma } = require('../qrFirmado');

function crearOffline({ pool, config }) {
  const archivo = path.join(app.getPath('userData'), 'accesos.db');
  const offlineDb = crearDb({ archivo });
  crearEsquema(offlineDb.db);

  const repo = crearSqliteAccessRepo(offlineDb);
  const estado = crearEstado(offlineDb, {
    alCambiar: (actual) => {
      BrowserWindow.getAllWindows().forEach((ventana) => {
        ventana.webContents.send('estado-sincronizacion', actual);
      });
    }
  });

  const transporte = crearTransporteMySQL(pool);
  const snapshot = crearSnapshot({ pool, offlineDb, config, firma });
  const sync = crearSync({
    offlineDb,
    transporte,
    estado,
    cargarSnapshot: snapshot.leer,
    aplicarSnapshot: snapshot.aplicar
  });
  const cierre = crearCierreLocal({ offlineDb, repo, config });
  const qr = crearQrLocal(repo, { aceptarSinFirma: config.qr.aceptarSinFirma });

  const publicar = (resultado) => {
    BrowserWindow.getAllWindows().forEach((ventana) => ventana.webContents.send('lectura-acceso', resultado));
  };

  const servicio = crearServicioAcceso({
    repo,
    qr,
    antirrebote: new Antirrebote({ ventanaSegundos: config.lectores.antirreboteSegundos }),
    config: { intervaloMinimoSegundos: config.lectores.intervaloMinimoSegundos },
    notificar: async (aviso) => console.log('[OFFLINE] Aviso:', aviso.mensaje || aviso.titulo),
    registrarFallido: (texto, tipoError, descripcion) => repo.registrarAccesoFallido(texto, tipoError, descripcion),
    publicar,
    mensajeNoEncontrado: () => (estado.estado.online
      ? 'Matrícula no registrada'
      : 'No disponible sin conexión; consulta con administración'),
    mensajeVisitanteNoEncontrado: () => (estado.estado.online
      ? 'Folio de visitante no válido'
      : 'No disponible sin conexión; consulta con administración')
  });

  const cola = crearCola({ procesar: (fn) => fn() });

  function registrarAcceso(texto, lector, origen) {
    const promesa = cola.encolar(() => servicio.registrarAcceso(texto, lector, origen));
    promesa.then(() => {
      if (estado.estado.online) sync.solicitar();
    }).catch(() => {});
    return promesa;
  }

  function registrarFolioVisitante(folio) {
    const promesa = cola.encolar(() => servicio.registrarFolioVisitante(folio));
    promesa.then(() => {
      if (estado.estado.online) sync.solicitar();
    }).catch(() => {});
    return promesa;
  }

  async function iniciar() {
    // El cierre local debe correr antes de abrir los escáneres.
    try {
      await cierre.revisar();
    } catch (error) {
      console.error('[OFFLINE] No se pudo ejecutar el cierre local inicial:', error.message);
    }

    // Primer snapshot/sync con tope para no retrasar la apertura del lector.
    await Promise.race([
      sync.ejecutar({ forzarSnapshot: true }),
      new Promise((resolve) => setTimeout(resolve, 5000))
    ]);

    sync.iniciar();
    cierre.iniciar();
    estado.publicar();
  }

  function cerrar() {
    sync.detener();
    cierre.detener();
    offlineDb.cerrar();
  }

  return {
    offlineDb,
    repo,
    estado,
    transporte,
    snapshot,
    sync,
    cierre,
    servicio,
    cola,
    registrarAcceso,
    registrarFolioVisitante,
    iniciar,
    cerrar
  };
}

module.exports = { crearOffline };
