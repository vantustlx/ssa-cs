// qrLocal.js — verificación de QR con la firma sincronizada (sin QR_SECRETO en el cliente)
const { FORMATO, leerQR } = require('@ssa/shared');

function crearQrLocal(repo, { aceptarSinFirma = false } = {}) {
  return {
    leer(texto) {
      const limpio = String(texto || '').trim().toUpperCase();
      const firmado = FORMATO.exec(limpio);
      if (firmado) {
        const matricula = Number(firmado[1]);
        const firma = repo.obtenerFirma(matricula);
        // Sin datos locales no se puede distinguir una credencial nueva de una falsa.
        if (!firma) return { error: 'SIN_DATOS' };
        return leerQR(texto, { firmaDeMatricula: () => firma, aceptarSinFirma });
      }
      return leerQR(texto, { firmaDeMatricula: () => null, aceptarSinFirma });
    }
  };
}

module.exports = { crearQrLocal };
