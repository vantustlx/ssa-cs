// routes/salud.js — comprobación de vida del backend
const express = require('express');
const { version } = require('../../package.json');

function crearRouterSalud({ pool }) {
  const router = express.Router();

  router.get('/salud', async (req, res) => {
    let db = 'no-configurado';
    if (pool) {
      try {
        await pool.query('SELECT 1');
        db = 'ok';
      } catch (error) {
        db = 'error';
      }
    }
    res.json({ ok: true, servicio: 'ssa-backend', version, db });
  });

  return router;
}

module.exports = { crearRouterSalud };
