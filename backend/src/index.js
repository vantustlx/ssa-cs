// index.js — arranque del backend Express
const config = require('./config');
const { crearPool } = require('./db/mysql');
const { crearApp } = require('./app');

const pool = crearPool(config.db);
const app = crearApp({ config, pool });

const servidor = app.listen(config.puerto, () => {
  console.log(`[BACKEND] Escuchando en http://localhost:${config.puerto}`);
});

function cerrar(senal) {
  console.log(`[BACKEND] ${senal}: cerrando...`);
  servidor.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
}

process.on('SIGINT', () => cerrar('SIGINT'));
process.on('SIGTERM', () => cerrar('SIGTERM'));

module.exports = { app, pool, servidor };
