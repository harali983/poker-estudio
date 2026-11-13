// motor.js: el "cerebro" de la mano. Sin pantalla y con tests (tests/tests.html).
//
// Una mano se guarda como una LISTA DE EVENTOS (ver el plan, 2.5):
//   { tipo: 'ante',   asiento, cantidad }
//   { tipo: 'ciega',  asiento, hasta }                 // SB y BB, las pone la app sola
//   { tipo: 'accion', calle, asiento, accion, hasta }   // accion: fold, check, call, apuesta, subida, allin
//   { tipo: 'mesa',   calle, cartas }                   // flop, turn o river
// "hasta" es el TOTAL que el jugador ha puesto en esa calle después de la acción
// ("sube hasta 60"), no lo que añade.
//
// calcularEstado() recorre los eventos desde el principio y saca a quién le toca, el bote,
// cuánto tiene que pagar, en qué calle está la mano y si ha terminado. No se guarda ningún
// estado aparte: Deshacer es quitar el último evento y volver a calcular.
//
// La app es un REGISTRO: si un evento no cuadra (no era su turno, subida menor que la
// mínima…), el motor lo aplica igualmente y añade un aviso. Manda lo que pasó en la mesa.
//
// Pendiente para el paso 12: botes secundarios y la regla de la subida all-in incompleta
// (que no reabre la acción). De momento, cualquier subida reabre la acción.

import { calcularPosiciones } from './posiciones.js';

export const CALLES = ['preflop', 'flop', 'turn', 'river'];
const CARTAS_POR_CALLE = { flop: 3, turn: 1, river: 1 };

/**
 * Prepara una mano nueva a partir de la partida: foto de los jugadores (posición y fichas)
 * y los eventos obligatorios (antes y ciegas).
 */
export function crearMano(partida, { id, numero, fecha }) {
  const pos = calcularPosiciones(partida.asientos, partida.boton);
  if (!pos) throw new Error('Tienen que jugar al menos 2 jugadores.');
  const jugadores = [...pos.preflop].sort((a, b) => a - b).map((asiento) => {
    const a = partida.asientos[asiento];
    return {
      asiento,
      jugadorId: a.jugadorId,
      posicion: pos.porAsiento[asiento].posicion,
      fichasInicio: partida.conFichas ? a.fichas : null,
    };
  });
  const mano = {
    id,
    formato: 1,
    partidaId: partida.id,
    numero,
    fecha,
    ciegas: { ...partida.ciegas },
    boton: pos.boton,
    jugadores,
    misCartas: [],
    eventos: [],
    decisiones: [],
    final: null,
    notas: '',
  };
  mano.eventos = eventosObligatorios(mano);
  return mano;
}

/** Antes y ciegas del principio de la mano. Si alguien no tiene fichas suficientes, pone las que tiene. */
export function eventosObligatorios(mano) {
  const pos = posicionesDeMano(mano);
  const { sb, bb, ante } = mano.ciegas;
  const quedan = new Map(mano.jugadores.map((j) => [j.asiento, j.fichasInicio]));
  const limitar = (asiento, cantidad) => {
    const f = quedan.get(asiento);
    const c = f === null ? cantidad : Math.min(cantidad, f);
    if (f !== null) quedan.set(asiento, f - c);
    return c;
  };

  const eventos = [];
  if (ante > 0) {
    for (const asiento of pos.preflop) {
      eventos.push({ tipo: 'ante', asiento, cantidad: limitar(asiento, ante) });
    }
  }
  if (sb > 0) eventos.push({ tipo: 'ciega', asiento: pos.sb, hasta: limitar(pos.sb, sb) });
  eventos.push({ tipo: 'ciega', asiento: pos.bb, hasta: limitar(pos.bb, bb) });
  return eventos;
}

/** Posiciones de la mano (a partir de su foto de jugadores y del botón). */
export function posicionesDeMano(mano) {
  const enMano = new Set(mano.jugadores.map((j) => j.asiento));
  const n = Math.max(mano.boton, ...enMano) + 1;
  const asientos = Array.from({ length: n }, (_, i) => ({ asiento: i, juega: enMano.has(i) }));
  return calcularPosiciones(asientos, mano.boton);
}

/**
 * Estado de la mano después de los eventos dados (por defecto, todos los de la mano).
 * {
 *   calle: 'preflop' | 'flop' | 'turn' | 'river',
 *   fase: 'accion'   → le toca a "turno"
 *       | 'cartas'   → la calle se ha cerrado: falta poner las cartas de "faltan" (flop, turn o river)
 *       | 'fin'      → la mano ha terminado ("motivoFin": 'retirada' o 'showdown')
 *   turno, faltan, motivoFin, ganador (si todos los demás se retiran),
 *   bote, apuestaMaxima (lo más alto puesto en esta calle), aPagar (lo que le falta al del turno),
 *   subidaMinima (el "hasta" mínimo para apostar o subir),
 *   mesa: [cartas], vivos: [asientos],
 *   jugadores: [{ asiento, posicion, puesto (en esta calle), total (en la mano), fichas, vivo, allin, haHablado, aPagar }],
 *   avisos: [{ evento, texto }]
 * }
 */
export function calcularEstado(mano, eventos = mano.eventos) {
  const pos = posicionesDeMano(mano);
  const bb = mano.ciegas.bb;
  const js = new Map();
  for (const j of mano.jugadores) {
    js.set(j.asiento, {
      asiento: j.asiento,
      posicion: j.posicion,
      puesto: 0,
      total: 0,
      fichas: j.fichasInicio ?? null,
      vivo: true,
      allin: false,
      haHablado: false,
    });
  }

  const e = {
    calle: 'preflop',
    fase: 'accion',
    turno: null,
    faltan: null,
    motivoFin: null,
    ganador: null,
    apuestaMaxima: 0,
    incremento: bb,        // tamaño de la última apuesta o subida completa (para la subida mínima)
    ultimoQueHablo: null,
    mesa: [],
    avisos: [],
  };

  const aPagarDe = (j) => Math.max(0, Math.min(e.apuestaMaxima - j.puesto, j.fichas ?? Infinity));
  const nombre = (asiento) => 'asiento ' + (asiento + 1);

  // Pone fichas hasta "hasta" en esta calle (o las que le queden, si no le llegan)
  function poner(j, hasta, i) {
    let diferencia = hasta - j.puesto;
    if (diferencia < 0) diferencia = 0;
    if (j.fichas !== null && diferencia >= j.fichas) {
      if (diferencia > j.fichas) {
        e.avisos.push({ evento: i, texto: `El ${nombre(j.asiento)} no tiene tantas fichas: pone las que le quedan (${j.fichas}).` });
      }
      diferencia = j.fichas;
      j.allin = true;
    }
    j.puesto += diferencia;
    j.total += diferencia;
    if (j.fichas !== null) j.fichas -= diferencia;
  }

  eventos.forEach((ev, i) => {
    const j = js.get(ev.asiento);
    if (ev.tipo !== 'mesa' && !j) {
      e.avisos.push({ evento: i, texto: `El ${nombre(ev.asiento)} no juega esta mano.` });
      return;
    }

    if (ev.tipo === 'ante') {
      const c = j.fichas === null ? ev.cantidad : Math.min(ev.cantidad, j.fichas);
      j.total += c;
      if (j.fichas !== null) { j.fichas -= c; if (j.fichas === 0) j.allin = true; }
    } else if (ev.tipo === 'ciega') {
      poner(j, ev.hasta, i);
      e.apuestaMaxima = Math.max(e.apuestaMaxima, j.puesto);
    } else if (ev.tipo === 'accion') {
      aplicarAccion(j, ev, i);
    } else if (ev.tipo === 'mesa') {
      aplicarMesa(ev, i);
    }
    actualizar();
  });

  function aplicarAccion(j, ev, i) {
    if (e.fase === 'fin') e.avisos.push({ evento: i, texto: 'La mano ya había terminado.' });
    else if (e.fase === 'cartas') e.avisos.push({ evento: i, texto: `La calle ya se había cerrado: faltaba el ${e.faltan}.` });
    else if (ev.asiento !== e.turno) e.avisos.push({ evento: i, texto: `No era su turno: le tocaba al ${nombre(e.turno)}.` });
    if (!j.vivo) e.avisos.push({ evento: i, texto: `El ${nombre(j.asiento)} ya se había retirado.` });

    const aPagar = aPagarDe(j);
    const maximaAntes = e.apuestaMaxima;
    const minimaAntes = maximaAntes + Math.max(e.incremento, bb);

    switch (ev.accion) {
      case 'fold':
        j.vivo = false;
        break;
      case 'check':
        if (aPagar > 0) e.avisos.push({ evento: i, texto: `Check con ${aPagar} por pagar.` });
        break;
      case 'call':
        // Un call sin nada que pagar es un check (no pone fichas)
        if (aPagar === 0) {
          e.avisos.push({ evento: i, texto: 'Call sin nada que pagar: se anota como check.' });
          break;
        }
        poner(j, ev.hasta ?? maximaAntes, i);
        break;
      case 'apuesta':
      case 'subida':
      case 'allin': {
        let hasta = ev.hasta;
        if (ev.accion === 'allin') {
          if (j.fichas !== null) hasta = j.puesto + j.fichas;
          j.allin = true;
        }
        if (hasta === undefined || hasta === null) {
          e.avisos.push({ evento: i, texto: 'Falta la cantidad.' });
          break;
        }
        poner(j, hasta, i);
        if (j.puesto > maximaAntes) {
          const subida = j.puesto - maximaAntes;
          if (j.puesto < minimaAntes && !j.allin) {
            e.avisos.push({ evento: i, texto: `Subida menor que la mínima (hasta ${minimaAntes}).` });
          }
          if (subida >= e.incremento) e.incremento = subida;
          e.apuestaMaxima = j.puesto;
          // Una apuesta o subida obliga a hablar otra vez a todos los demás
          for (const otro of js.values()) if (otro !== j) otro.haHablado = false;
        } else if (ev.accion !== 'allin') {
          e.avisos.push({ evento: i, texto: `No supera la apuesta que había (${maximaAntes}).` });
        }
        break;
      }
      default:
        e.avisos.push({ evento: i, texto: `Acción desconocida: ${ev.accion}.` });
    }
    j.haHablado = true;
    e.ultimoQueHablo = j.asiento;
  }

  function aplicarMesa(ev, i) {
    if (e.fase !== 'cartas') {
      e.avisos.push({ evento: i, texto: e.fase === 'fin' ? 'La mano ya había terminado.' : 'La calle todavía no se había cerrado.' });
    } else if (ev.calle !== e.faltan) {
      e.avisos.push({ evento: i, texto: `Se esperaba el ${e.faltan}, no el ${ev.calle}.` });
    }
    if (ev.cartas && CARTAS_POR_CALLE[ev.calle] && ev.cartas.length !== CARTAS_POR_CALLE[ev.calle]) {
      e.avisos.push({ evento: i, texto: `El ${ev.calle} tiene ${CARTAS_POR_CALLE[ev.calle]} carta(s).` });
    }
    e.calle = ev.calle;
    e.mesa.push(...(ev.cartas || []));
    for (const j of js.values()) { j.puesto = 0; j.haHablado = false; }
    e.apuestaMaxima = 0;
    e.incremento = bb;
    e.ultimoQueHablo = null;
  }

  // Después de cada evento: ¿sigue la acción, se cierra la calle o se acaba la mano?
  function actualizar() {
    const vivos = [...js.values()].filter((j) => j.vivo);
    if (vivos.length === 1) {
      Object.assign(e, { fase: 'fin', motivoFin: 'retirada', ganador: vivos[0].asiento, turno: null, faltan: null });
      return;
    }
    const puedenActuar = vivos.filter((j) => !j.allin);
    let pendientes = puedenActuar.filter((j) => !j.haHablado || j.puesto < e.apuestaMaxima);
    // Si solo queda uno con fichas y no tiene nada que pagar, no hay con quién apostar
    if (puedenActuar.length <= 1) pendientes = pendientes.filter((j) => j.puesto < e.apuestaMaxima);

    if (pendientes.length === 0) {
      e.turno = null;
      if (e.calle === 'river') {
        Object.assign(e, { fase: 'fin', motivoFin: 'showdown', faltan: null });
      } else {
        Object.assign(e, { fase: 'cartas', faltan: CALLES[CALLES.indexOf(e.calle) + 1] });
      }
      return;
    }

    // Le toca al siguiente pendiente en el orden de habla de esta calle
    const orden = e.calle === 'preflop' ? pos.preflop : pos.postflop;
    const pendiente = new Set(pendientes.map((j) => j.asiento));
    const desde = e.ultimoQueHablo === null ? -1 : orden.indexOf(e.ultimoQueHablo);
    e.turno = null;
    for (let d = 1; d <= orden.length; d++) {
      const asiento = orden[(desde + d + orden.length) % orden.length];
      if (pendiente.has(asiento)) { e.turno = asiento; break; }
    }
    Object.assign(e, { fase: 'accion', faltan: null, motivoFin: null, ganador: null });
  }

  const jugadores = [...js.values()].map((j) => ({ ...j, aPagar: aPagarDe(j) }));
  const delTurno = e.turno === null ? null : js.get(e.turno);
  return {
    calle: e.calle,
    fase: e.fase,
    turno: e.turno,
    faltan: e.faltan,
    motivoFin: e.motivoFin,
    ganador: e.ganador,
    bote: jugadores.reduce((s, j) => s + j.total, 0),
    apuestaMaxima: e.apuestaMaxima,
    aPagar: delTurno ? aPagarDe(delTurno) : 0,
    subidaMinima: e.apuestaMaxima + Math.max(e.incremento, bb),
    mesa: e.mesa,
    vivos: jugadores.filter((j) => j.vivo).map((j) => j.asiento),
    jugadores,
    avisos: e.avisos,
  };
}

/**
 * Botones que tienen sentido para el jugador al que le toca (ver el plan, 2.3):
 * sin nada que pagar, Check y Apostar; con algo que pagar, Fold, Call y Subir; All-in siempre.
 */
export function opciones(estado) {
  if (estado.fase !== 'accion') return null;
  const j = estado.jugadores.find((x) => x.asiento === estado.turno);
  const aPagar = estado.aPagar;
  const leQuedanMas = j.fichas === null || j.fichas > aPagar;
  return {
    fold: aPagar > 0,
    check: aPagar === 0,
    call: aPagar > 0,
    apostar: estado.apuestaMaxima === 0 && leQuedanMas,
    subir: estado.apuestaMaxima > 0 && leQuedanMas,
    allin: true,
    aPagar,
    subidaMinima: estado.subidaMinima,
  };
}

/** ¿Hay algo que deshacer? Las antes y las ciegas no se deshacen: las pone la app. */
export function puedeDeshacer(eventos) {
  const ultimo = eventos[eventos.length - 1];
  return Boolean(ultimo) && ultimo.tipo !== 'ciega' && ultimo.tipo !== 'ante';
}

/** Deshacer: quita el último evento (una acción o una carta de la mesa). */
export function deshacer(eventos) {
  return puedeDeshacer(eventos) ? eventos.slice(0, -1) : eventos;
}
