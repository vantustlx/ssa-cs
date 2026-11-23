// antirrebote.js — ignora la misma lectura repetida en el mismo lector dentro de una ventana
class Antirrebote {
  /**
   * @param {Object} opciones
   * @param {number} [opciones.ventanaSegundos=8] segundos en que se ignora la misma clave
   * @param {number} [opciones.maxEntradas=500] tope de claves antes de purgar las vencidas
   */
  constructor({ ventanaSegundos = 8, maxEntradas = 500 } = {}) {
    this.ventanaMs = ventanaSegundos * 1000;
    this.maxEntradas = maxEntradas;
    this.ultimas = new Map();
  }

  /**
   * Registra la clave y devuelve true si se trata de una repetición dentro de la ventana.
   * @param {string} clave
   * @returns {boolean}
   */
  repetida(clave) {
    const ahora = Date.now();
    const anterior = this.ultimas.get(clave);
    this.ultimas.set(clave, ahora);
    if (this.ultimas.size > this.maxEntradas) {
      for (const [k, t] of this.ultimas) {
        if (ahora - t > this.ventanaMs) this.ultimas.delete(k);
      }
    }
    return anterior !== undefined && ahora - anterior < this.ventanaMs;
  }

  limpiar() {
    this.ultimas.clear();
  }
}

module.exports = { Antirrebote };
