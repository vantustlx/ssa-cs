// db.js — SQLite local del lector (node:sqlite) con transacciones serializadas
const fs = require('fs');
const path = require('path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (error) {
  throw new Error(
    'node:sqlite no está disponible en este Electron. Instala better-sqlite3 como respaldo o actualiza Electron.'
  );
}

/**
 * Abre la base local y devuelve un envoltorio con transacciones serializadas.
 * @param {{archivo?: string}} [opciones]
 */
function crearDb({ archivo = ':memory:' } = {}) {
  if (archivo !== ':memory:') fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const db = new DatabaseSync(archivo);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 3000');
  db.exec('PRAGMA foreign_keys = ON');

  // Todas las escrituras (escaneos, snapshot, outbox, cierre) pasan por esta cola.
  let cola = Promise.resolve();
  function ejecutar(fn) {
    const resultado = cola.then(() => fn());
    cola = resultado.catch(() => {});
    return resultado;
  }

  async function transaccion(fn) {
    return ejecutar(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const resultado = await fn(db);
        db.exec('COMMIT');
        return resultado;
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch (rollbackError) {
          // La transacción ya pudo haberse cerrado por un error de SQLite.
        }
        throw error;
      }
    });
  }

  function cerrar() {
    try {
      db.close();
    } catch (error) {
      console.error('[OFFLINE] No se pudo cerrar SQLite:', error.message);
    }
  }

  return { db, transaccion, ejecutar, cerrar, archivo };
}

module.exports = { crearDb };
