// acceso.js — adaptador IPC del lector
//
// La decisión de entrada/salida vive en @ssa/shared y se ejecuta contra SQLite local
// (offline/index.js). Las lecturas se encolan para soportar ráfagas sin esperar a la red.
const { ipcMain } = require('electron');
const config = require('./config');
const { LECTORES, MATRICULA_VALIDA } = require('@ssa/shared');
const { crearOffline } = require('./offline');

let offline = null;
let poolRef = null;

async function setupAcceso(pool) {
  poolRef = pool;
  offline = crearOffline({ pool, config });

  // Lecturas de la cámara o de un lector tipo teclado en la ventana del lector
  ipcMain.handle('registrar-acceso', (event, { texto, lector, origen }) =>
    registrarAcceso(texto, lector, origen || 'camara'));
  ipcMain.handle('buscar-usuario-por-matricula', (event, matricula) => buscarUsuario(matricula));
  ipcMain.handle('registrar-acceso-visitante', (event, folio) => registrarFolioVisitante(folio));
  ipcMain.handle('estado-sincronizacion', () => offline.estado.instantanea());
  ipcMain.handle('sincronizar-ahora', () => offline.sync.sincronizarAhora());

  return offline;
}

function registrarAcceso(texto, lector, origen) {
  if (!offline) throw new Error('La capa offline aún no está inicializada');
  return offline.registrarAcceso(texto, lector, origen);
}

function registrarFolioVisitante(textoFolio) {
  if (!offline) throw new Error('La capa offline aún no está inicializada');
  return offline.registrarFolioVisitante(textoFolio);
}

// Para asociar placas: solo consulta a MySQL (pantalla de administrador, siempre online).
async function buscarUsuario(matricula) {
  const texto = String(matricula || '').trim();
  if (!MATRICULA_VALIDA.test(texto)) return null;
  const [[usuario]] = await poolRef.query(
    'SELECT matricula, nombre, apellido_paterno, apellido_materno FROM usuario WHERE matricula = ?',
    [Number(texto)]
  );
  return usuario || null;
}

module.exports = { LECTORES, setupAcceso, registrarAcceso };
