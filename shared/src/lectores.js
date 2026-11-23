// lectores.js — los tres lectores y los formatos de códigos aceptados
const LECTORES = {
  PEATONAL: { numero: 1, nombre: 'Peatonal', medio: 'PEATONAL' },
  ENTRADA_VEHICULAR: { numero: 2, nombre: 'Entrada vehicular', medio: 'VEHICULAR' },
  SALIDA_VEHICULAR: { numero: 3, nombre: 'Salida vehicular', medio: 'VEHICULAR' }
};

const ROLES = Object.keys(LECTORES);

// Solo dígitos: evita que un QR ajeno (texto o URL) coincida con la matrícula 0
const MATRICULA_VALIDA = /^\d{1,9}$/;
// Pase de visitante: el código de barras contiene "V-" + folio; en "Acceder" se teclea solo el folio
const CODIGO_VISITANTE = /^V-([A-Z0-9]{6,10})$/;
const FOLIO_VISITANTE = /^[A-Z0-9]{6,10}$/;

module.exports = { LECTORES, ROLES, MATRICULA_VALIDA, CODIGO_VISITANTE, FOLIO_VISITANTE };
