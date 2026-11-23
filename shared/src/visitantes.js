// visitantes.js — reglas puras del registro de visitantes (Ocasional / Frecuente)
const crypto = require('crypto');

const TIPOS = ['Ocasional', 'Frecuente'];
const MESES_VIGENCIA_FRECUENTE = 6;
// Sin 0/O ni 1/I para que el folio se pueda teclear sin confusiones (32 símbolos: reparto uniforme)
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LONGITUD_FOLIO = 8;
const SOLO_LETRAS = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]{2,50}$/;
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generarFolio() {
  return Array.from(crypto.randomBytes(LONGITUD_FOLIO), (b) => ALFABETO[b % ALFABETO.length]).join('');
}

function calcularVigencia(tipo, ahora = new Date()) {
  const fecha = new Date(ahora);
  if (tipo === 'Frecuente') {
    fecha.setMonth(fecha.getMonth() + MESES_VIGENCIA_FRECUENTE);
  } else {
    fecha.setHours(23, 59, 59, 0); // el ocasional solo entra el día que se registra
  }
  return fecha;
}

function normalizar(datos = {}) {
  const limpio = (v) => String(v || '').trim();
  return {
    tipo: limpio(datos.tipo),
    motivo: limpio(datos.motivo),
    nombre: limpio(datos.nombre),
    apellidoP: limpio(datos.apellidoP),
    apellidoM: limpio(datos.apellidoM),
    correo: limpio(datos.correo).toLowerCase(),
    telefono: limpio(datos.telefono)
  };
}

function validar(d) {
  const errores = [];
  if (!TIPOS.includes(d.tipo)) errores.push('Tipo de visitante inválido');
  if (d.motivo.length < 3) errores.push('Motivo de al menos 3 caracteres');
  if (!SOLO_LETRAS.test(d.nombre)) errores.push('Nombre inválido');
  if (!SOLO_LETRAS.test(d.apellidoP)) errores.push('Apellido paterno inválido');
  if (!SOLO_LETRAS.test(d.apellidoM)) errores.push('Apellido materno inválido');
  if (d.correo && !CORREO_VALIDO.test(d.correo)) errores.push('Correo electrónico inválido');
  if (!/^\d{10,15}$/.test(d.telefono)) errores.push('Teléfono debe tener 10–15 dígitos');
  return errores;
}

module.exports = {
  TIPOS,
  MESES_VIGENCIA_FRECUENTE,
  ALFABETO,
  LONGITUD_FOLIO,
  generarFolio,
  calcularVigencia,
  normalizar,
  validar
};
