// cola.js — procesa lecturas una a una, en orden, sin esperar a la red
function crearCola({ procesar } = {}) {
  let cadena = Promise.resolve();
  let pendientes = 0;

  function encolar(item) {
    pendientes += 1;
    const resultado = cadena.then(async () => {
      pendientes -= 1;
      return procesar(item);
    });
    // La cadena sigue aunque una lectura falle; el error se propaga solo a su llamador.
    cadena = resultado.catch(() => {});
    return resultado;
  }

  return {
    encolar,
    pendientes: () => pendientes
  };
}

module.exports = { crearCola };
