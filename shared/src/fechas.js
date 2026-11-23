// fechas.js — criterios de fecha/hora compartidos entre cliente y servidor
function inicioDeHoy(ahora = new Date()) {
  const hoy = new Date(ahora);
  hoy.setHours(0, 0, 0, 0);
  return hoy;
}

function formatoHora(fecha) {
  return new Date(fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

module.exports = { inicioDeHoy, formatoHora };
