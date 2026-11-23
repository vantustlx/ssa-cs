// qr.js — contenido del QR de la credencial: matrícula + firma HMAC con el secreto del servidor
//
// Formato: FCB<matrícula>K<firma>, p. ej. FCB20222009KQ4ZB7M2XWJ5RT6NA
// Solo letras mayúsculas y dígitos: los lectores tipo teclado no alteran símbolos según la
// distribución del teclado, y se acepta en minúsculas por si el lector tiene Bloq Mayús activado.
// El cliente nunca recibe el secreto: el servidor le sincroniza la firma ya calculada.
const crypto = require('crypto');

const FORMATO = /^FCB(\d{1,9})K([A-Z2-7]{16})$/;
const SOLO_MATRICULA = /^\d{1,9}$/;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// 80 bits de la HMAC en base32 (16 caracteres)
function firmaConSecreto(matricula, secreto) {
  const bytes = crypto.createHmac('sha256', String(secreto)).update(String(matricula)).digest().subarray(0, 10);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g).map((b) => BASE32[parseInt(b, 2)]).join('');
}

function contenidoQR(matricula, secreto) {
  const numero = Number(matricula);
  return `FCB${numero}K${firmaConSecreto(numero, secreto)}`;
}

function iguales(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Interpreta lo leído por un lector.
 * @param {string} texto
 * @param {Object} opciones
 * @param {string} [opciones.secreto] secreto HMAC (servidor)
 * @param {(matricula:number)=>string|null} [opciones.firmaDeMatricula] firma precalculada (cliente offline)
 * @param {boolean} [opciones.aceptarSinFirma] acepta credenciales anteriores (solo matrícula)
 * @returns {{matricula:number}|{error:'FIRMA_INVALIDA'|'SIN_FIRMA'}|null}
 */
function leerQR(texto, { secreto, firmaDeMatricula, aceptarSinFirma = false } = {}) {
  const limpio = String(texto || '').trim().toUpperCase();
  const firmado = FORMATO.exec(limpio);
  if (firmado) {
    let esperado;
    if (typeof firmaDeMatricula === 'function') {
      esperado = firmaDeMatricula(Number(firmado[1]));
    } else if (secreto) {
      esperado = firmaConSecreto(Number(firmado[1]), secreto);
    } else {
      throw new Error('leerQR requiere "secreto" o "firmaDeMatricula"');
    }
    return esperado && iguales(esperado, firmado[2])
      ? { matricula: Number(firmado[1]) }
      : { error: 'FIRMA_INVALIDA' };
  }
  if (SOLO_MATRICULA.test(limpio)) {
    // Credenciales anteriores a la firma: solo mientras se reenvían
    return aceptarSinFirma ? { matricula: Number(limpio) } : { error: 'SIN_FIRMA' };
  }
  return null;
}

module.exports = { FORMATO, SOLO_MATRICULA, BASE32, firmaConSecreto, contenidoQR, leerQR };
