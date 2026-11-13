// final.js: el final de la mano (lógica pura, sin pantalla, con tests en tests/tests.html).
//
//  - Lo que nadie pagó se devuelve: si el que más puso supera al segundo, la diferencia
//    vuelve a él (no cuenta como ganancia). Pasa al retirarse todos ante una apuesta
//    y también en un all-in que el otro paga solo en parte.
//  - El resto del bote se reparte a partes iguales entre los ganadores. Si no se puede
//    repartir exacto, la ficha sobrante va al primer ganador a la izquierda del botón
//    (y si sobran más, una a cada uno, en ese orden).
//  - El resultado de cada jugador (neto) = lo que cobra + lo que se le devuelve − lo que puso.
//  - Con fichas, la partida se actualiza con esos netos.
//
// Pendiente para el paso 12: botes secundarios. Hasta entonces, si hay all-ins con fichas
// distintas, avisoBotes() avisa de que el reparto puede no ser exacto.

import { posicionesDeMano } from './motor.js';

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
 * El final de la mano a partir del estado (fase 'fin') y de lo elegido en el showdown.
 * cierre: { ganadores: [asientos], mostradas: [{ asiento, cartas }] } (solo en el showdown).
 * {
 *   motivo: 'retirada' | 'showdown',
 *   ganadores: [{ asiento, cantidad }]   ← lo que cobra cada uno del bote
 *   devuelto: { asiento, cantidad } | null   ← lo que nadie pagó (no es ganancia)
 *   mostradas: [{ asiento, cartas }]
 * }
 */
export function calcularFinal(mano, estado, cierre = {}) {
  const devuelto = devolucion(estado);
  const aRepartir = redondear(estado.bote - (devuelto ? devuelto.cantidad : 0));
  let ganadores;
  let mostradas = [];
  if (estado.motivoFin === 'retirada') {
    ganadores = [{ asiento: estado.ganador, cantidad: aRepartir }];
  } else {
    const vivos = new Set(estado.vivos);
    const elegidos = (cierre.ganadores || []).filter((a) => vivos.has(a));
    ganadores = repartir(aRepartir, ordenDesdeElBoton(mano, elegidos), unidadDeFichas(mano.ciegas));
    mostradas = (cierre.mostradas || []).filter((m) => vivos.has(m.asiento) && m.cartas && m.cartas.length);
    // Tus cartas, si llegas al showdown y las anotaste
    const yo = mano.jugadores.find((j) => j.jugadorId === 'yo');
    if (yo && vivos.has(yo.asiento) && (mano.misCartas || []).length === 2 && !mostradas.some((m) => m.asiento === yo.asiento)) {
      mostradas = [...mostradas, { asiento: yo.asiento, cartas: [...mano.misCartas] }];
    }
  }
  return { motivo: estado.motivoFin, ganadores, devuelto, mostradas };
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
 * Aviso si el reparto puede no ser exacto por falta de botes secundarios (llegan en el paso 12):
 * algún jugador que sigue en la mano está all-in con menos fichas puestas que otro.
 */
export function avisoBotes(estado) {
  if (estado.fase !== 'fin' || estado.motivoFin !== 'showdown') return null;
  const devuelto = devolucion(estado);
  const total = (j) => j.total - (devuelto && devuelto.asiento === j.asiento ? devuelto.cantidad : 0);
  const maximo = Math.max(...estado.jugadores.map(total));
  const corto = estado.jugadores.some((j) => j.vivo && j.allin && total(j) < maximo - 1e-9);
  return corto
    ? 'Hay all-ins con fichas distintas: el reparto puede no ser exacto (los botes secundarios llegan más adelante).'
    : null;
}
