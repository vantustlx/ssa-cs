// cierreLocal.js — cierre diario sobre SQLite (recuperación y hora programada)
const { inicioDeHoy } = require('@ssa/shared');

const INTERVALO_MS = 60 * 1000;

function horaDeCierreHoy(ahora, horaTexto) {
  const [h, m] = String(horaTexto || '20:00').split(':').map(Number);
  const hora = new Date(ahora);
  hora.setHours(Number.isFinite(h) ? h : 20, Number.isFinite(m) ? m : 0, 0, 0);
  return hora;
}

function claveDia(fecha) {
  const dos = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

function crearCierreLocal({ offlineDb, repo, config, ahora = () => new Date() }) {
  let timer = null;

  async function revisar() {
    const fecha = ahora();
    const inicio = inicioDeHoy(fecha);
    const resultado = { recuperacion: 0, programado: 0 };

    await offlineDb.transaccion(async (tx) => {
      const abiertas = tx.prepare(
        'SELECT uuid, entrada_utc FROM registro_local WHERE salida_utc IS NULL AND cierre_automatico_utc IS NULL'
      ).all();

      // 1) Entradas de días anteriores que el cierre no alcanzó a cerrar.
      for (const registro of abiertas) {
        if (new Date(registro.entrada_utc) < inicio) {
          await repo.marcarCierreAutomatico(
            { id: registro.uuid, fecha, contexto: { origen: 'cierre_local' } },
            tx
          );
          resultado.recuperacion += 1;
        }
      }

      // 2) Cierre programado de hoy (también si la app arrancó después de la hora).
      const hora = horaDeCierreHoy(fecha, config.cierre.hora);
      const clave = claveDia(fecha);
      const hecho = tx.prepare('SELECT valor FROM meta WHERE clave = ?').get('ultimo_cierre_local');

      if (fecha >= hora && (!hecho || hecho.valor !== clave)) {
        const restantes = tx.prepare(
          `SELECT uuid FROM registro_local
            WHERE salida_utc IS NULL AND cierre_automatico_utc IS NULL AND entrada_utc < ?`
        ).all(fecha.toISOString());

        for (const registro of restantes) {
          await repo.marcarCierreAutomatico(
            { id: registro.uuid, fecha, contexto: { origen: 'cierre_local' } },
            tx
          );
          resultado.programado += 1;
        }

        tx.prepare(
          'INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'
        ).run('ultimo_cierre_local', clave);
      }
    });

    return resultado;
  }

  function iniciar() {
    if (timer) return timer;
    timer = setInterval(() => {
      revisar().catch((error) => console.error('[CIERRE LOCAL] Error:', error.message));
    }, INTERVALO_MS);
    return timer;
  }

  function detener() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { revisar, iniciar, detener };
}

module.exports = { crearCierreLocal, horaDeCierreHoy, claveDia };
