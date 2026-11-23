// Repositorio en memoria para probar el servicio de acceso sin MySQL ni SQLite.
class FakeAccessRepo {
  constructor({ usuarios = [], vehiculos = {}, areas = {}, visitantes = [], registros = [] } = {}) {
    this.usuarios = new Map(usuarios.map((u) => [Number(u.matricula), u]));
    this.vehiculos = new Map(Object.entries(vehiculos).map(([m, placas]) => [Number(m), placas]));
    this.areas = new Map(Object.entries(areas).map(([m, rol]) => [Number(m), rol]));
    this.visitantes = new Map(visitantes.map((v) => [v.codigo_acceso, v]));
    this.registros = registros.map((r, i) => ({ id_registro: r.id_registro ?? i + 1, ...r }));
    this.nextId = this.registros.length + 1;
    this.estatus = new Map();
  }

  async conTransaccion(fn) {
    return fn(this);
  }

  async obtenerUsuarioParaAcceso(matricula) {
    return this.usuarios.get(Number(matricula)) || null;
  }

  async obtenerPlacas(matricula) {
    return this.vehiculos.get(Number(matricula)) || [];
  }

  async obtenerAreaPrincipal(matricula) {
    return this.areas.get(Number(matricula)) || '';
  }

  _movimientos(filtro) {
    return this.registros
      .filter(filtro)
      .sort((a, b) => new Date(b.fecha_entrada) - new Date(a.fecha_entrada) || b.id_registro - a.id_registro);
  }

  _ultimo(filtro, fecha) {
    const [ultimo] = this._movimientos(filtro);
    if (!ultimo) return null;
    const fin = ultimo.fecha_salida || ultimo.fecha_entrada;
    return {
      fue_salida: Boolean(ultimo.fecha_salida),
      segundos: Math.floor((new Date(fecha) - new Date(fin)) / 1000)
    };
  }

  async ultimoMovimientoUsuario(matricula, fecha) {
    return this._ultimo((r) => Number(r.matricula) === Number(matricula), fecha);
  }

  async entradaAbiertaUsuario(matricula) {
    return this._movimientos(
      (r) => Number(r.matricula) === Number(matricula) && !r.fecha_salida && !r.cierre_automatico
    )[0] || null;
  }

  async crearEntradaUsuario({ matricula, medio, fecha }) {
    this.registros.push({
      id_registro: this.nextId++,
      matricula,
      id_visitante: null,
      fecha_entrada: fecha,
      fecha_salida: null,
      medio_entrada: medio,
      medio_salida: null,
      cierre_automatico: null
    });
  }

  async cerrarEntradaUsuario({ id, medio, fecha }) {
    const registro = this.registros.find((r) => r.id_registro === id);
    if (registro) {
      registro.fecha_salida = fecha;
      registro.medio_salida = medio;
    }
  }

  async marcarCierreAutomatico({ id, fecha }) {
    const registro = this.registros.find((r) => r.id_registro === id);
    if (registro) registro.cierre_automatico = fecha;
  }

  async actualizarEstatusUsuario(matricula, estatus) {
    this.estatus.set(Number(matricula), estatus);
  }

  async obtenerVisitantePorFolio(folio) {
    return this.visitantes.get(folio) || null;
  }

  async ultimoMovimientoVisitante(idVisitante, fecha) {
    return this._ultimo((r) => Number(r.id_visitante) === Number(idVisitante), fecha);
  }

  async entradaAbiertaVisitante(idVisitante) {
    return this._movimientos(
      (r) => Number(r.id_visitante) === Number(idVisitante) && !r.fecha_salida && !r.cierre_automatico
    )[0] || null;
  }

  async crearEntradaVisitante({ idVisitante, fecha }) {
    this.registros.push({
      id_registro: this.nextId++,
      matricula: null,
      id_visitante: idVisitante,
      fecha_entrada: fecha,
      fecha_salida: null,
      medio_entrada: null,
      medio_salida: null,
      cierre_automatico: null
    });
  }

  async cerrarEntradaVisitante({ id, fecha }) {
    const registro = this.registros.find((r) => r.id_registro === id);
    if (registro) registro.fecha_salida = fecha;
  }

  async buscarUsuario(matricula) {
    return this.usuarios.get(Number(matricula)) || null;
  }
}

module.exports = { FakeAccessRepo };
