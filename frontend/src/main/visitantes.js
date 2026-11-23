// visitantes.js — registro unificado de visitantes (Ocasional / Frecuente)
//
// El folio es la credencial: se teclea en "Acceder" o se lee del código de barras del pase,
// que se envía por correo cuando el visitante da uno. Sin correo, el folio se muestra en pantalla.
const { ipcMain } = require('electron');
const { normalizar, validar, calcularVigencia, generarFolio } = require('@ssa/shared');
const { enviarPaseVisitante } = require('./sendemails');

let pool;

async function insertarConFolioUnico(d, vigenteHasta) {
  for (let intento = 0; intento < 5; intento++) {
    const folio = generarFolio();
    try {
      await pool.query(
        `INSERT INTO visitante
           (nombre, apellido_paterno, apellido_materno, fecha_registro, numero_telefono, correo,
            codigo_acceso, motivo, tipo, vigente_hasta)
         VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?)`,
        [d.nombre, d.apellidoP, d.apellidoM, d.telefono, d.correo || null, folio, d.motivo, d.tipo, vigenteHasta]
      );
      return folio;
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
    }
  }
  throw new Error('No se pudo generar un folio único');
}

async function registrarVisitante(datos) {
  const d = normalizar(datos);
  const errores = validar(d);
  if (errores.length) return { estado: 'invalido', mensaje: errores.join('. ') };

  const vigenteHasta = calcularVigencia(d.tipo);
  let folio;
  let renovado = false;

  // El visitante frecuente conserva su folio: se renueva su vigencia y se le reenvía el pase
  if (d.tipo === 'Frecuente' && d.correo) {
    const [[existente]] = await pool.query(
      "SELECT id_visitante, codigo_acceso FROM visitante WHERE correo = ? AND tipo = 'Frecuente' ORDER BY id_visitante DESC LIMIT 1",
      [d.correo]
    );
    if (existente) {
      await pool.query(
        `UPDATE visitante SET nombre = ?, apellido_paterno = ?, apellido_materno = ?, numero_telefono = ?,
                motivo = ?, fecha_registro = CURDATE(), vigente_hasta = ?
          WHERE id_visitante = ?`,
        [d.nombre, d.apellidoP, d.apellidoM, d.telefono, d.motivo, vigenteHasta, existente.id_visitante]
      );
      folio = existente.codigo_acceso;
      renovado = true;
    }
  }
  if (!folio) folio = await insertarConFolioUnico(d, vigenteHasta);

  let correoEnviado = false;
  let errorCorreo = null;
  if (d.correo) {
    try {
      const nombre = `${d.nombre} ${d.apellidoP} ${d.apellidoM}`;
      await enviarPaseVisitante({ correo: d.correo, nombre, folio, tipo: d.tipo, vigenteHasta });
      correoEnviado = true;
    } catch (error) {
      console.error('[VISITANTES] No se pudo enviar el pase:', error);
      errorCorreo = error.message;
    }
  }

  console.log(`[VISITANTES] ${renovado ? 'Renovado' : 'Registrado'} visitante ${d.tipo} con folio ${folio}`);
  return { estado: 'ok', folio, tipo: d.tipo, motivo: d.motivo, vigenteHasta: vigenteHasta.toISOString(), correo: d.correo, correoEnviado, errorCorreo, renovado };
}

function setupVisitantes(poolDB) {
  pool = poolDB;
  ipcMain.handle('registrar-visitante', async (event, datos) => {
    try {
      return await registrarVisitante(datos);
    } catch (error) {
      console.error('[VISITANTES] Error al registrar visitante:', error);
      return { estado: 'error', mensaje: error.message };
    }
  });
}

module.exports = { setupVisitantes };
