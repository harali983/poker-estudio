// final.js: el final de la mano (lógica pura, sin pantalla, con tests en tests/tests.html).
//
//  - Lo que nadie pagó se devuelve: si el que más puso supera al segundo, la diferencia
//    vuelve a él (no cuenta como ganancia). Pasa al retirarse todos ante una apuesta
//    y también en un all-in que el otro paga solo en parte.
//  - Botes secundarios (paso 12): si alguien que llega al showdown está all-in con menos
//    fichas que otros, el bote se divide en capas. Cada capa (bote principal, secundario 1…)
//    solo la pueden ganar los que pusieron al menos hasta ese nivel. Ver calcularBotes().
//  - Quién gana cada bote: en el showdown se marca quién tiene la mejor mano (cierre.ganadores),
//    y eso vale para el bote principal. Cada bote secundario lo ganan los ganadores del bote
//    anterior que también juegan ese bote; si ninguno lo juega (p. ej. ganó el corto), se elige
//    aparte (cierre.botes[k]). Si solo uno lo juega, es suyo.
//  - Cada bote se reparte a partes iguales entre sus ganadores. Si no se puede repartir exacto,
//    la ficha sobrante va al primer ganador a la izquierda del botón (y si sobran más, una a
//    cada uno, en ese orden).
//  - Ganador automático (v0.3.2): si la mesa está completa y se conocen las cartas de todos los
//    que se disputan cada bote (las tuyas y las mostradas), el ganador de cada bote se decide con
//    el evaluador (decidirShowdown). Si falta alguna, se elige a mano como antes. Siempre se puede
//    cambiar a mano (cierre.manual = true).
//  - Muck (v0.3.2): quien tira sus cartas sin enseñarlas (cierre.muck) renuncia al bote: no puede
//    ganar ningún bote ni cuenta como que mostró. Si en un bote solo queda uno, es suyo.
//  - El resultado de cada jugador (neto) = lo que cobra + lo que se le devuelve − lo que puso.
//  - Con fichas, la partida se actualiza con esos netos.

import { posicionesDeMano, mesaPorCalle } from './motor.js';
import { evaluar } from './evaluador.js';
import { nombreJugada } from './describir.js';

const aCentimos = (x) => Math.round(x * 100);
const deCentimos = (c) => c / 100;
export const redondear = (x) => Math.round(x * 100) / 100;

/** La ficha más pequeña de la mesa (la de la ciega o el ante más pequeños). */
export function unidadDeFichas(ciegas) {
  const valores = [ciegas.sb, ciegas.bb, ciegas.ante].filter((v) => v > 0);
  return valores.length ? Math.min(...valores) : 1;
}

/**
 * Lo que nadie pagó: { asiento, cantidad } o null.
 * Se compara lo que ha puesto cada uno en toda la mano (también los que se retiraron).
 */
export function devolucion(estado) {
  const totales = [...estado.jugadores].sort((a, b) => b.total - a.total);
  if (totales.length < 2) return null;
  const diferencia = redondear(totales[0].total - totales[1].total);
  return diferencia > 0 ? { asiento: totales[0].asiento, cantidad: diferencia } : null;
}

/** Ganadores ordenados desde el primero a la izquierda del botón (el botón, el último). */
export function ordenDesdeElBoton(mano, asientos) {
  const orden = posicionesDeMano(mano).postflop;
  return [...asientos].sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
}

/**
 * Reparte una cantidad a partes iguales. "asientos" ya va en orden (el primero a la
 * izquierda del botón primero): ese se lleva la ficha sobrante.
 * Devuelve [{ asiento, cantidad }].
 */
export function repartir(cantidad, asientos, unidad = 1) {
  const n = asientos.length;
  if (n === 0) return [];
  const total = aCentimos(cantidad);
  const u = Math.max(1, aCentimos(unidad));
  const base = Math.floor(total / (n * u)) * u;
  const partes = asientos.map(() => base);
  let resto = total - base * n;
  for (let i = 0; i < n && resto >= u; i++) { partes[i] += u; resto -= u; }
  partes[0] += resto; // menos de una ficha (solo con cantidades raras): al primero
  return asientos.map((asiento, i) => ({ asiento, cantidad: deCentimos(partes[i]) }));
}

/**
 * Botes del showdown (después de devolver lo que nadie pagó), del principal a los secundarios:
 * [{ cantidad, aptos: [asientos que pueden ganarlo] }].
 * Los niveles son lo que puso en la mano cada jugador vivo (de menos a más). Cada bote se
 * llena con lo que puso cada jugador (también los retirados) entre el nivel anterior y ese.
 */
export function calcularBotes(estado) {
  const devuelto = devolucion(estado);
  const puesto = (j) => aCentimos(j.total) - (devuelto && devuelto.asiento === j.asiento ? aCentimos(devuelto.cantidad) : 0);
  const vivos = estado.jugadores.filter((j) => j.vivo);
  const niveles = [...new Set(vivos.map(puesto))].sort((a, b) => a - b);
  const botes = [];
  let anterior = 0;
  niveles.forEach((nivel, k) => {
    const ultimo = k === niveles.length - 1;
    let c = 0;
    for (const j of estado.jugadores) {
      const p = puesto(j);
      // Lo que un retirado puso por encima del nivel más alto (raro) va al último bote
      c += (ultimo ? p : Math.min(p, nivel)) - Math.min(p, anterior);
    }
    const aptos = vivos.filter((j) => puesto(j) >= nivel).map((j) => j.asiento);
    if (c > 0 || k === 0) botes.push({ cantidad: deCentimos(c), aptos });
    anterior = nivel;
  });
  return botes;
}

/** Los que pueden ganar un bote, sin los que hicieron muck (nunca se queda vacío). */
function sinMuck(aptos, muck) {
  const quedan = aptos.filter((a) => !muck.has(a));
  return quedan.length ? quedan : aptos;
}

/** Botes del showdown con sus aptos, quitando a los que hicieron muck. */
function botesSinMuck(estado, cierre) {
  const muck = new Set(cierre.muck || []);
  return calcularBotes(estado).map((b) => ({ ...b, aptos: sinMuck(b.aptos, muck) }));
}

/**
 * ¿Puede hacer muck este jugador? Solo si en cada bote que juega queda al menos otro que no
 * haya hecho muck (alguien tiene que ganarlo).
 */
export function puedeHacerMuck(estado, cierre, asiento) {
  const muck = new Set([...(cierre.muck || []), asiento]);
  return calcularBotes(estado).every((b) => !b.aptos.includes(asiento) || b.aptos.some((a) => !muck.has(a)));
}

/** Las 2 cartas conocidas de un jugador en el showdown (las tuyas o las mostradas), o null. */
export function cartasDe(mano, cierre, asiento) {
  const j = mano.jugadores.find((x) => x.asiento === asiento);
  const cartas = j && j.jugadorId === 'yo' ? (mano.misCartas || [])
    : ((cierre.mostradas || []).find((m) => m.asiento === asiento) || {}).cartas || [];
  return cartas.length === 2 ? cartas : null;
}

/** Las 5 cartas de la mesa, o null si falta alguna (o alguna calle se anotó "sin cartas"). */
export function mesaCompleta(mano) {
  const m = mesaPorCalle(mano.eventos);
  const cartas = [...(m.flop || []), ...(m.turn || []), ...(m.river || [])];
  return cartas.length === 5 ? cartas : null;
}

/**
 * Decide el showdown con el evaluador (sin pantalla, con tests):
 * { porBote: [[asientos que ganan cada bote]], puntuaciones: Map asiento → puntuación }
 * o null si en algún bote que se disputan dos o más falta la mesa o las cartas de alguno.
 * Un bote en el que solo queda uno (los demás hicieron muck) es suyo sin mirar cartas.
 */
export function decidirShowdown(mano, estado, cierre = {}) {
  const mesa = mesaCompleta(mano);
  const muck = new Set(cierre.muck || []);
  const puntuaciones = new Map();
  const porBote = [];
  for (const b of botesSinMuck(estado, cierre)) {
    if (b.aptos.length === 1) { porBote.push([...b.aptos]); continue; }
    if (!mesa) return null;
    for (const a of b.aptos) {
      if (puntuaciones.has(a)) continue;
      const cartas = cartasDe(mano, cierre, a);
      if (!cartas) return null;
      puntuaciones.set(a, evaluar([...cartas, ...mesa]));
    }
    const mejor = Math.max(...b.aptos.map((a) => puntuaciones.get(a)));
    porBote.push(b.aptos.filter((a) => puntuaciones.get(a) === mejor));
  }
  // También la jugada de los demás que enseñan (para explicar el resultado)
  if (mesa) {
    for (const a of estado.vivos) {
      const cartas = !muck.has(a) && cartasDe(mano, cierre, a);
      if (cartas && !puntuaciones.has(a)) puntuaciones.set(a, evaluar([...cartas, ...mesa]));
    }
  }
  return { porBote, puntuaciones };
}

/**
 * Lo elegido en el showdown que vale de verdad: si no se eligió a mano (cierre.manual) y se
 * puede decidir con las cartas, los ganadores de cada bote salen de decidirShowdown.
 */
export function cierreEfectivo(mano, estado, cierre = {}) {
  const auto = cierre.manual || estado.motivoFin !== 'showdown' ? null : decidirShowdown(mano, estado, cierre);
  if (!auto) return cierre;
  const botes = {};
  auto.porBote.forEach((g, k) => { if (k > 0) botes[k] = g; });
  return { ...cierre, ganadores: auto.porBote[0] || [], botes };
}

/**
 * Ganadores de cada bote (asientos), según lo elegido en el showdown (ver arriba):
 * [{ cantidad, aptos, elegidos, heredado }]. heredado = false si hay que elegirlo aparte.
 * Los que hicieron muck no están en "aptos". El cierre que se pasa ya es el efectivo.
 */
export function ganadoresPorBote(estado, cierre = {}) {
  let previos = cierre.ganadores || [];
  return botesSinMuck(estado, cierre).map((b, k) => {
    const aptos = new Set(b.aptos);
    let elegidos = previos.filter((a) => aptos.has(a));
    let heredado = true;
    if (b.aptos.length === 1) {
      elegidos = [...b.aptos]; // solo lo juega uno (o los demás hicieron muck): es suyo
    } else if (k > 0 && !elegidos.length) {
      heredado = false;
      elegidos = ((cierre.botes || {})[k] || []).filter((a) => aptos.has(a));
    }
    previos = elegidos;
    return { ...b, elegidos, heredado };
  });
}

/**
 * El final de la mano a partir del estado (fase 'fin') y de lo elegido en el showdown.
 * cierre: { ganadores: [asientos], botes: { k: [asientos] }, mostradas: [{ asiento, cartas }],
 *           muck: [asientos], manual: true | undefined }
 * (solo en el showdown; "botes" solo para los botes secundarios que no se deducen solos).
 * Si se puede, los ganadores se deciden con las cartas (ver cierreEfectivo).
 * {
 *   motivo: 'retirada' | 'showdown',
 *   ganadores: [{ asiento, cantidad }]   ← lo que cobra cada uno (sumando todos los botes)
 *   botes: [{ cantidad, aptos, ganadores: [{ asiento, cantidad }] }]  ← solo si hay botes secundarios
 *   devuelto: { asiento, cantidad } | null   ← lo que nadie pagó (no es ganancia)
 *   mostradas: [{ asiento, cartas }]   ← sin las de quien hizo muck
 *   muck: [asientos]                    ← solo si alguien hizo muck
 * }
 */
export function calcularFinal(mano, estado, cierreElegido = {}) {
  const cierre = cierreEfectivo(mano, estado, cierreElegido);
  const devuelto = devolucion(estado);
  const aRepartir = redondear(estado.bote - (devuelto ? devuelto.cantidad : 0));
  let ganadores;
  let botes = null;
  let mostradas = [];
  let muck = [];
  if (estado.motivoFin === 'retirada') {
    ganadores = [{ asiento: estado.ganador, cantidad: aRepartir }];
  } else {
    muck = estado.vivos.filter((a) => (cierre.muck || []).includes(a));
    const vivos = new Set(estado.vivos.filter((a) => !muck.includes(a)));
    const unidad = unidadDeFichas(mano.ciegas);
    const porBote = ganadoresPorBote(estado, cierre);
    if (porBote.length <= 1) {
      const elegidos = (porBote.length ? porBote[0].elegidos : []).filter((a) => vivos.has(a));
      ganadores = repartir(aRepartir, ordenDesdeElBoton(mano, elegidos), unidad);
    } else {
      botes = porBote.map((b) => ({
        cantidad: b.cantidad,
        aptos: b.aptos,
        ganadores: repartir(b.cantidad, ordenDesdeElBoton(mano, b.elegidos), unidad),
      }));
      // Lo que cobra cada uno, sumando todos los botes (y solo si ya se sabe quién gana cada bote)
      const suma = new Map();
      if (botes.every((b) => b.ganadores.length)) {
        for (const b of botes) for (const g of b.ganadores) suma.set(g.asiento, aCentimos(g.cantidad) + (suma.get(g.asiento) || 0));
      }
      ganadores = ordenDesdeElBoton(mano, [...suma.keys()]).map((a) => ({ asiento: a, cantidad: deCentimos(suma.get(a)) }));
    }
    mostradas = (cierre.mostradas || []).filter((m) => vivos.has(m.asiento) && m.cartas && m.cartas.length);
    // Tus cartas, si llegas al showdown y las anotaste
    const yo = mano.jugadores.find((j) => j.jugadorId === 'yo');
    if (yo && vivos.has(yo.asiento) && (mano.misCartas || []).length === 2 && !mostradas.some((m) => m.asiento === yo.asiento)) {
      mostradas = [...mostradas, { asiento: yo.asiento, cartas: [...mano.misCartas] }];
    }
  }
  const r = botes
    ? { motivo: estado.motivoFin, ganadores, botes, devuelto, mostradas }
    : { motivo: estado.motivoFin, ganadores, devuelto, mostradas };
  if (muck.length) r.muck = muck;
  return r;
}

/** ¿Falta elegir quién gana algún bote? (entonces la mano no se puede cerrar) */
export function faltanGanadores(final) {
  return final.botes ? final.botes.some((b) => !b.ganadores.length) : !final.ganadores.length;
}

/** Resultado neto de cada jugador: Map asiento → cobrado + devuelto − puesto. */
export function netos(estado, final) {
  const r = new Map();
  for (const j of estado.jugadores) r.set(j.asiento, 0 - j.total);
  for (const g of final.ganadores) r.set(g.asiento, r.get(g.asiento) + g.cantidad);
  if (final.devuelto) r.set(final.devuelto.asiento, r.get(final.devuelto.asiento) + final.devuelto.cantidad);
  for (const [a, v] of r) r.set(a, redondear(v));
  return r;
}

/**
 * Las fichas de la partida después de la mano: a cada jugador de la mano se le suma su neto
 * (así se respeta lo que se haya cambiado en la mesa durante la mano, p. ej. una recompra).
 * Quien se queda sin fichas deja de jugar las próximas manos (se cambia en la mesa si recompra).
 * Devuelve los asientos nuevos.
 */
export function fichasDespues(partida, mano, estado, final) {
  if (!partida.conFichas || mano.jugadores.some((j) => j.fichasInicio === null)) return partida.asientos;
  const n = netos(estado, final);
  const deMano = new Map(mano.jugadores.map((j) => [j.asiento, j]));
  return partida.asientos.map((a) => {
    const j = deMano.get(a.asiento);
    if (!j || j.jugadorId !== a.jugadorId || a.fichas === null || a.fichas === undefined) return a;
    const fichas = Math.max(0, redondear(a.fichas + n.get(a.asiento)));
    return fichas > 0 ? { ...a, fichas } : { ...a, fichas, juega: false };
  });
}

/**
 * Por qué gana quien gana, con la jugada de cada uno (para la pantalla del showdown):
 * "Gana Tú: pareja de Q · Ana: pareja de 7". decision: lo que devuelve decidirShowdown.
 * nombre(asiento) da el nombre que se muestra. Con botes secundarios se dice quién gana cada uno.
 */
export function motivoShowdown(decision, estado, cierre, nombre) {
  const { porBote, puntuaciones } = decision;
  const muck = new Set(cierre.muck || []);
  const jugada = (a) => (puntuaciones.has(a) ? nombreJugada(puntuaciones.get(a)) : null);
  const ganan = (asientos) => {
    const quien = asientos.length === 1 ? 'Gana ' + nombre(asientos[0])
      : 'Empatan ' + asientos.slice(0, -1).map(nombre).join(', ') + ' y ' + nombre(asientos[asientos.length - 1]);
    const j = jugada(asientos[0]);
    return j ? quien + ': ' + j : quien;
  };
  const partes = [];
  const principales = porBote[0] || [];
  if (porBote.length > 1) {
    partes.push('Bote principal: ' + ganan(principales).replace(/^G/, 'g').replace(/^E/, 'e'));
    porBote.slice(1).forEach((g, i) => {
      if (g.join() === principales.join()) return; // los mismos: no hace falta repetirlo
      const nombreBote = porBote.length === 2 ? 'Secundario' : 'Secundario ' + (i + 1);
      partes.push(nombreBote + ': ' + ganan(g).replace(/^G/, 'g').replace(/^E/, 'e'));
    });
  } else {
    partes.push(ganan(principales));
  }
  const yaDichos = new Set(porBote.flat());
  const resto = estado.vivos.filter((a) => !yaDichos.has(a));
  resto.sort((a, b) => (puntuaciones.get(b) ?? -1) - (puntuaciones.get(a) ?? -1));
  for (const a of resto) {
    if (muck.has(a)) partes.push(nombre(a) + ': muck');
    else if (jugada(a)) partes.push(nombre(a) + ': ' + jugada(a));
  }
  return partes.join(' · ');
}
