// index.js — superficie pública del dominio compartido
const lectores = require('./lectores');
const texto = require('./texto');
const fechas = require('./fechas');
const antirrebote = require('./antirrebote');
const qr = require('./qr');
const areas = require('./areas');
const validacion = require('./validacion');
const visitantes = require('./visitantes');
const acceso = require('./acceso');

module.exports = {
  ...lectores,
  ...texto,
  ...fechas,
  ...antirrebote,
  ...qr,
  ...areas,
  ...validacion,
  ...visitantes,
  ...acceso
};
