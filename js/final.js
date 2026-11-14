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
//  - El resultado de cada jugador (neto) = lo que cobra + lo que se le devuelve − lo que puso.
//  - Con fichas, la partida se actualiza con esos netos.

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

/**
 * Ganadores de cada bote (asientos), según lo elegido en el showdown (ver arriba):
 * [{ cantidad, aptos, elegidos, heredado }]. heredado = false si hay que elegirlo aparte.
 */
export function ganadoresPorBote(estado, cierre = {}) {
  const botes = calcularBotes(estado);
  let previos = cierre.ganadores || [];
  return botes.map((b, k) => {
    const aptos = new Set(b.aptos);
    let elegidos = previos.filter((a) => aptos.has(a));
    let heredado = true;
    if (k > 0 && !elegidos.length) {
      heredado = false;
      elegidos = b.aptos.length === 1 ? [...b.aptos] : ((cierre.botes || {})[k] || []).filter((a) => aptos.has(a));
    }
    if (k === 0) elegidos = elegidos.filter((a) => aptos.has(a));
    previos = elegidos;
    return { ...b, elegidos, heredado };
  });
}

/**
 * El final de la mano a partir del estado (fase 'fin') y de lo elegido en el showdown.
 * cierre: { ganadores: [asientos], botes: { k: [asientos] }, mostradas: [{ asiento, cartas }] }
 * (solo en el showdown; "botes" solo para los botes secundarios que no se deducen solos).
 * {
 *   motivo: 'retirada' | 'showdown',
 *   ganadores: [{ asiento, cantidad }]   ← lo que cobra cada uno (sumando todos los botes)
 *   botes: [{ cantidad, aptos, ganadores: [{ asiento, cantidad }] }]  ← solo si hay botes secundarios
 *   devuelto: { asiento, cantidad } | null   ← lo que nadie pagó (no es ganancia)
 *   mostradas: [{ asiento, cartas }]
 * }
 */
export function calcularFinal(mano, estado, cierre = {}) {
  const devuelto = devolucion(estado);
  const aRepartir = redondear(estado.bote - (devuelto ? devuelto.cantidad : 0));
  let ganadores;
  let botes = null;
  let mostradas = [];
  if (estado.motivoFin === 'retirada') {
    ganadores = [{ asiento: estado.ganador, cantidad: aRepartir }];
  } else {
    const vivos = new Set(estado.vivos);
    const unidad = unidadDeFichas(mano.ciegas);
    const porBote = ganadoresPorBote(estado, cierre);
    if (porBote.length <= 1) {
      const elegidos = (cierre.ganadores || []).filter((a) => vivos.has(a));
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
  return botes
    ? { motivo: estado.motivoFin, ganadores, botes, devuelto, mostradas }
    : { motivo: estado.motivoFin, ganadores, devuelto, mostradas };
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
