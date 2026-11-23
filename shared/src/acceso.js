// acceso.js — reglas de entrada/salida y servicio agnóstico de base de datos
//
// Los tres lectores registran entradas y salidas: el movimiento lo decide el último estado
// de la persona, no el lector. El lector solo define el medio (peatonal o vehicular).
const {
  LECTORES,
  CODIGO_VISITANTE,
  FOLIO_VISITANTE
} = require('./lectores');
const { nombreCompleto } = require('./texto');
const { inicioDeHoy, formatoHora } = require('./fechas');
const { Antirrebote } = require('./antirrebote');

// Doble lectura: la persona ya registró un movimiento hace menos de N segundos (en cualquier lector).
function mensajeLecturaRepetida(ultimo, segundosMinimos) {
  if (!ultimo || ultimo.segundos >= segundosMinimos) return null;
  return `Ya registró su ${ultimo.fue_salida ? 'salida' : 'entrada'} hace ${Math.max(0, ultimo.segundos)} s; lectura ignorada`;
}

// Decide el movimiento a partir de la entrada abierta. Si es de un día anterior, se cierra y cuenta como entrada.
function decidirMovimiento({ entradaAbierta, ahora, inicioDelDia }) {
  if (entradaAbierta && new Date(entradaAbierta.fecha_entrada) < inicioDelDia) {
    return {
      tipo: 'ENTRADA',
      cerrarAnterior: true,
      aviso: `Tenía una entrada del ${formatoHora(entradaAbierta.fecha_entrada)} sin salida; se cerró automáticamente`
    };
  }
  return { tipo: entradaAbierta ? 'SALIDA' : 'ENTRADA', cerrarAnterior: false, aviso: null };
}

// Incoherencias que no bloquean el paso: se muestran al vigilante y se notifican al administrador.
function avisosDeAcceso({ tipo, medio, placas = [] }) {
  if (medio === 'VEHICULAR' && placas.length === 0) {
    return [`${tipo === 'ENTRADA' ? 'Entró' : 'Salió'} en vehículo sin vehículo registrado`];
  }
  return [];
}

/**
 * Crea el servicio de registro de accesos.
 *
 * @param {Object} deps
 * @param {Object} deps.repo repositorio (MySQL o SQLite)
 * @param {{leer:(texto:string)=>Object|null}} deps.qr verificador de QR
 * @param {Antirrebote} [deps.antirrebote]
 * @param {Object} [deps.config] { intervaloMinimoSegundos, antirreboteSegundos }
 * @param {() => Date} [deps.ahora]
 * @param {Function} [deps.notificar] crea notificación de inconsistencia
 * @param {Function} [deps.registrarFallido] registra acceso fallido
 * @param {Function} [deps.publicar] publica el resultado a las ventanas
 */
function crearServicioAcceso({
  repo,
  qr,
  antirrebote,
  config = {},
  ahora = () => new Date(),
  notificar = async () => {},
  registrarFallido = async () => {},
  publicar = () => {}
} = {}) {
  const intervaloMinimoSegundos = Number.isFinite(config.intervaloMinimoSegundos)
    ? config.intervaloMinimoSegundos
    : 15;
  const anti = antirrebote || new Antirrebote({ ventanaSegundos: config.antirreboteSegundos || 8 });

  async function rechazar(base, texto, tipoError, mensaje) {
    const donde = base.lector ? `lector ${base.numero} · ${LECTORES[base.lector].nombre}` : base.origen;
    try {
      await registrarFallido(texto, tipoError, `${mensaje} (${donde})`);
    } catch (error) {
      console.error('[ACCESO] No se pudo registrar el acceso fallido:', error);
    }
    return { ...base, estado: 'RECHAZADO', mensaje };
  }

  async function registrarEnBD(base, matricula, info) {
    const fecha = ahora();
    const inicio = inicioDeHoy(fecha);
    const avisos = [];

    const salida = await repo.conTransaccion(async (tx) => {
      const usuario = await repo.obtenerUsuarioParaAcceso(matricula, tx);
      if (!usuario) {
        return { rechazo: { texto: matricula, tipoError: 'MATRICULA_NO_ENCONTRADA', mensaje: 'Matrícula no registrada' } };
      }

      const placas = await repo.obtenerPlacas(matricula, tx);
      const rol = await repo.obtenerAreaPrincipal(matricula, tx);
      const datos = { matricula, nombre: nombreCompleto(usuario), rol, placas };

      const ultimo = await repo.ultimoMovimientoUsuario(matricula, fecha, tx);
      const repetida = mensajeLecturaRepetida(ultimo, intervaloMinimoSegundos);
      if (repetida) return { resultado: { ...base, ...datos, estado: 'REPETIDO', mensaje: repetida } };

      let abierto = await repo.entradaAbiertaUsuario(matricula, tx);
      const decision = decidirMovimiento({ entradaAbierta: abierto, ahora: fecha, inicioDelDia: inicio });
      if (decision.cerrarAnterior) {
        await repo.marcarCierreAutomatico({ id: abierto.id_registro, fecha }, tx);
        avisos.push(decision.aviso);
        abierto = null;
      }

      const tipo = decision.tipo;
      avisos.push(...avisosDeAcceso({ tipo, medio: info.medio, placas }));

      if (tipo === 'ENTRADA') {
        await repo.crearEntradaUsuario({ matricula, medio: info.medio, fecha }, tx);
        await repo.actualizarEstatusUsuario(matricula, 'Activo', tx);
      } else {
        await repo.cerrarEntradaUsuario({ id: abierto.id_registro, medio: info.medio, fecha }, tx);
        await repo.actualizarEstatusUsuario(matricula, 'Inactivo', tx);
      }

      return {
        resultado: {
          ...base,
          ...datos,
          estado: tipo,
          avisos,
          mensaje: tipo === 'ENTRADA' ? 'Entrada registrada' : 'Salida registrada'
        }
      };
    });

    if (salida.rechazo) {
      return rechazar(base, salida.rechazo.texto, salida.rechazo.tipoError, salida.rechazo.mensaje);
    }

    const resultado = salida.resultado;
    for (const aviso of resultado.avisos || []) {
      await notificar({
        tipo: 'ACCESO_INCONSISTENTE',
        matricula,
        titulo: `Acceso inconsistente · lector ${info.numero} (${info.nombre})`,
        mensaje: `${resultado.nombre} (${matricula}): ${aviso}.`
      }).catch((error) => console.error('[ACCESO] No se pudo notificar la inconsistencia:', error));
    }
    return resultado;
  }

  async function registrarVisitanteEnBD(base, folio) {
    const fecha = ahora();
    const inicio = inicioDeHoy(fecha);

    const salida = await repo.conTransaccion(async (tx) => {
      const visitante = await repo.obtenerVisitantePorFolio(folio, tx);
      if (!visitante) {
        return { rechazo: { texto: folio, tipoError: 'VISITANTE_NO_VALIDO', mensaje: 'Folio de visitante no válido' } };
      }
      if (!visitante.vigente_hasta || new Date(visitante.vigente_hasta) < fecha) {
        return { rechazo: { texto: folio, tipoError: 'VISITANTE_VENCIDO', mensaje: 'Pase de visitante vencido' } };
      }

      const datos = {
        visitante: true,
        folio,
        nombre: nombreCompleto(visitante),
        rol: `Visitante ${String(visitante.tipo || '').toLowerCase()}`,
        motivo: visitante.motivo
      };

      const ultimo = await repo.ultimoMovimientoVisitante(visitante.id_visitante, fecha, tx);
      const repetida = mensajeLecturaRepetida(ultimo, intervaloMinimoSegundos);
      if (repetida) return { resultado: { ...base, ...datos, estado: 'REPETIDO', mensaje: repetida } };

      let abierto = await repo.entradaAbiertaVisitante(visitante.id_visitante, tx);
      if (abierto && new Date(abierto.fecha_entrada) < inicio) {
        await repo.marcarCierreAutomatico({ id: abierto.id_registro, fecha }, tx);
        abierto = null;
      }

      if (abierto) {
        await repo.cerrarEntradaVisitante({ id: abierto.id_registro, fecha }, tx);
      } else {
        await repo.crearEntradaVisitante({ idVisitante: visitante.id_visitante, fecha }, tx);
      }

      const estado = abierto ? 'SALIDA' : 'ENTRADA';
      return {
        resultado: {
          ...base,
          ...datos,
          estado,
          mensaje: estado === 'ENTRADA' ? 'Entrada registrada' : 'Salida registrada'
        }
      };
    });

    if (salida.rechazo) {
      return rechazar(base, salida.rechazo.texto, salida.rechazo.tipoError, salida.rechazo.mensaje);
    }
    return salida.resultado;
  }

  /**
   * Registra la lectura de un QR en el lector indicado y publica el resultado.
   * @param {string} textoLeido
   * @param {string} lector PEATONAL | ENTRADA_VEHICULAR | SALIDA_VEHICULAR
   * @param {string} origen serial | camara | teclado
   */
  async function registrarAcceso(textoLeido, lector, origen) {
    const info = LECTORES[lector];
    if (!info) throw new Error(`Lector desconocido: ${lector}`);

    const texto = String(textoLeido || '').trim();
    const base = { lector, numero: info.numero, origen, hora: ahora().toISOString(), avisos: [], placas: [] };
    let resultado;

    if (!texto) return { ...base, estado: 'REPETIDO' };
    if (anti.repetida(`${lector}:${texto}`)) {
      // El escáner o la cámara releen mientras la persona sostiene el QR: no se publica nada
      return { ...base, estado: 'REPETIDO' };
    }

    const visitante = CODIGO_VISITANTE.exec(texto.toUpperCase());
    const credencial = visitante ? null : qr.leer(texto);

    if (!visitante && !credencial) {
      resultado = await rechazar(base, texto, 'QR_INVALIDO', 'Código no válido');
    } else if (credencial && credencial.error === 'SIN_FIRMA') {
      resultado = await rechazar(base, texto, 'QR_SIN_FIRMA', 'Credencial anterior: pide al administrador que te la reenvíe');
    } else if (credencial && credencial.error) {
      resultado = await rechazar(base, texto, 'QR_FALSIFICADO', 'Código no válido');
    } else {
      try {
        resultado = visitante
          ? await registrarVisitanteEnBD(base, visitante[1])
          : await registrarEnBD(base, credencial.matricula, info);
      } catch (error) {
        console.error('[ACCESO] Error al registrar el acceso:', error);
        resultado = { ...base, estado: 'RECHAZADO', mensaje: 'Error del sistema, intenta de nuevo' };
      }
    }

    publicar(resultado);
    return resultado;
  }

  // Folio tecleado en "Acceder" (para quien no trae el pase en el celular)
  async function registrarFolioVisitante(textoFolio) {
    const folio = String(textoFolio || '').trim().toUpperCase().replace(/^V-/, '');
    const base = { lector: null, numero: null, origen: 'folio', hora: ahora().toISOString(), avisos: [], placas: [] };
    if (!FOLIO_VISITANTE.test(folio)) {
      return rechazar(base, folio, 'VISITANTE_NO_VALIDO', 'Folio de visitante no válido');
    }
    try {
      return await registrarVisitanteEnBD(base, folio);
    } catch (error) {
      console.error('[ACCESO] Error al registrar el folio del visitante:', error);
      return { ...base, estado: 'RECHAZADO', mensaje: 'Error del sistema, intenta de nuevo' };
    }
  }

  return { registrarAcceso, registrarFolioVisitante, antirrebote: anti };
}

module.exports = {
  LECTORES,
  mensajeLecturaRepetida,
  decidirMovimiento,
  avisosDeAcceso,
  crearServicioAcceso
};
