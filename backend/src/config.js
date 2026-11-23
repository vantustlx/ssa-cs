// config.js — configuración del backend desde backend/.env
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

try {
  process.loadEnvFile(ENV_PATH);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.warn('[CONFIG] No se encontró backend/.env; copia backend/.env.example y complétalo');
}

const config = {
  puerto: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sistemaaccesofacultad'
  },
  sesion: {
    secret: process.env.SESSION_SECRET || ''
  },
  admin: {
    usuario: process.env.ADMIN_USUARIO || '',
    password: process.env.ADMIN_PASSWORD || ''
  },
  qr: {
    secreto: process.env.QR_SECRETO || '',
    aceptarSinFirma: /^(si|sí|true|1)$/i.test(process.env.QR_ACEPTAR_SIN_FIRMA || '')
  },
  correo: {
    usuario: process.env.GMAIL_USER || '',
    password: process.env.GMAIL_APP_PASSWORD || ''
  },
  confirmacion: {
    url: (process.env.CONFIRMACION_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.CONFIRMACION_API_KEY || ''
  },
  cierre: {
    hora: process.env.CIERRE_HORA || '20:00',
    carpeta: process.env.CIERRE_CARPETA || null
  },
  respaldo: {
    carpeta: process.env.RESPALDO_CARPETA || null,
    dias: Number(process.env.RESPALDO_DIAS) || 30,
    mysqldump: process.env.RESPALDO_MYSQLDUMP || null
  }
};

module.exports = config;
