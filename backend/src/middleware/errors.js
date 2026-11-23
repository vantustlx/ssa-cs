// middleware/errors.js — 404 y manejador central de errores
function noEncontrado(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}

function manejarErrores(error, req, res, next) {
  console.error('[BACKEND] Error no controlado:', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Error interno del servidor' });
}

module.exports = { noEncontrado, manejarErrores };
