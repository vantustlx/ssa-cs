// texto.js — utilidades de texto compartidas
function nombreCompleto(persona = {}) {
  return [persona.nombre, persona.apellido_paterno, persona.apellido_materno].filter(Boolean).join(' ');
}

module.exports = { nombreCompleto };
