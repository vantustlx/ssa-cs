// qrFirmado.js — adaptador del QR: aporta el secreto de config al dominio compartido
const crypto = require('crypto');
const config = require('./config');
const { contenidoQR: contenidoConSecreto, leerQR: leerQRCompartido } = require('@ssa/shared');

// Si el .env no tiene secreto se crea uno: cambiarlo o perderlo invalida todas las credenciales emitidas
function secreto() {
  if (!process.env.QR_SECRETO) {
    config.guardarEnEnv({ QR_SECRETO: crypto.randomBytes(32).toString('hex') });
    console.warn('[QR] Se generó QR_SECRETO en .env. Respáldalo: sin él, las credenciales emitidas dejan de servir');
  }
  return process.env.QR_SECRETO;
}

function contenidoQR(matricula) {
  return contenidoConSecreto(matricula, secreto());
}

function leerQR(texto) {
  return leerQRCompartido(texto, { secreto: secreto(), aceptarSinFirma: config.qr.aceptarSinFirma });
}

module.exports = { contenidoQR, leerQR };
