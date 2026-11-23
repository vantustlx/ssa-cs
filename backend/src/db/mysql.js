// db/mysql.js — creación del pool de MySQL del backend
const mysql = require('mysql2');

function crearPool(dbConfig) {
  return mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    connectionLimit: 10,
    waitForConnections: true
  }).promise();
}

module.exports = { crearPool };
