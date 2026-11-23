const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const PROHIBIDOS = ['electron', 'mysql2', 'serialport'];

function archivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(dir, entrada.name);
    return entrada.isDirectory() ? archivos(ruta) : [ruta];
  });
}

test('shared no depende de Electron, MySQL ni serialport', () => {
  for (const archivo of archivos(SRC)) {
    const contenido = fs.readFileSync(archivo, 'utf8');
    for (const modulo of PROHIBIDOS) {
      assert.ok(
        !new RegExp(`require\\(['"]${modulo}['"]\\)`).test(contenido),
        `${path.relative(SRC, archivo)} no debe requerir "${modulo}"`
      );
    }
  }
});
