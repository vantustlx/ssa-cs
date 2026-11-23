// app.js — aplicación Express del backend
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const { crearRouterSalud } = require('./routes/salud');
const { noEncontrado, manejarErrores } = require('./middleware/errors');

/**
 * Crea la app Express.
 * @param {Object} opciones
 * @param {Object} [opciones.config] configuración del backend
 * @param {Object} [opciones.pool] pool de MySQL (opcional; /salud lo comprueba si existe)
 */
function crearApp({ config = require('./config'), pool = null } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  // Sesión firmada en cookie (admin). Se monta solo si hay secreto configurado.
  if (config.sesion && config.sesion.secret) {
    app.use(cookieSession({
      name: 'ssa.sid',
      keys: [config.sesion.secret],
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60 * 1000
    }));
  } else {
    console.warn('[BACKEND] SESSION_SECRET no configurado; el login de administrador no estará disponible');
  }

  app.use(crearRouterSalud({ pool }));
  app.use(noEncontrado);
  app.use(manejarErrores);

  return app;
}

module.exports = { crearApp };
