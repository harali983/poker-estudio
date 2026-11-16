// historial.js: "Mis manos" (lógica pura, con tests).
//
// Convierte cada mano cerrada en un resumen corto para la lista (tus cartas, posición,
// resultado…) y agrupa los resúmenes por partida. No lee la base de datos ni toca la pantalla:
// pantalla-manos.js le pasa las manos y las partidas ya leídas.
//
// Resultado en BB: se calcula con la BB DE ESA MANO. Al sumar varias manos se suman los
// resultados en BB mano a mano (no "total en fichas ÷ BB de ahora"), porque las ciegas
// pueden cambiar durante la partida.

import { calcularEstado } from './motor.js';
import { netos, redondear } from './final.js';
import { clase } from './rangos.js';

/** ¿La mano está cerrada? (las que están en curso tienen final === null) */
export function manoCerrada(mano) {
  return Boolean(mano && mano.final);
}

/**
 * Resumen de una mano cerrada para la lista:
 * {
 *   id, partidaId, numero, fecha, bb,
 *   jugaba: ¿estabas sentado en esta mano?,
 *   asiento, posicion, misCartas: [c1, c2] | null, clase: "AKs" | null,
 *   resultado: neto en fichas (null si no jugabas), resultadoBB (sin redondear),
 *   motivo: 'showdown' | 'retirada', showdown: ¿llegaste al showdown?,
 *   bote: total puesto en la mano, jugadores: nº de jugadores, corregida
 * }
 */
export function resumenMano(mano) {
  const estado = calcularEstado(mano);
  const yo = mano.jugadores.find((j) => j.jugadorId === 'yo') || null;
  const cartas = (mano.misCartas || []).length === 2 ? [...mano.misCartas] : null;
  const bb = mano.ciegas.bb;

  let resultado = null;
  let showdown = false;
  if (yo) {
    resultado = netos(estado, mano.final).get(yo.asiento) ?? 0;
    const muck = mano.final.muck || [];
    showdown = mano.final.motivo === 'showdown' && estado.vivos.includes(yo.asiento) && !muck.includes(yo.asiento);
  }

  return {
    id: mano.id,
    partidaId: mano.partidaId,
    numero: mano.numero,
    fecha: mano.fecha,
    bb,
    jugaba: Boolean(yo),
    asiento: yo ? yo.asiento : null,
    posicion: yo ? yo.posicion : null,
    misCartas: cartas,
    clase: cartas ? clase(cartas[0], cartas[1]) : null,
    resultado,
    resultadoBB: resultado === null || !bb ? null : resultado / bb,
    motivo: mano.final.motivo,
    showdown,
    bote: estado.bote,
    jugadores: mano.jugadores.length,
    corregida: Boolean(mano.corregida),
  };
}

/** Suma los resultados de varios resúmenes (en BB, mano a mano). Las manos sin ti no cuentan. */
export function sumarResultados(resumenes) {
  const jugadas = resumenes.filter((r) => r.jugaba);
  return {
    manos: resumenes.length,
    jugadas: jugadas.length,
    resultado: redondear(jugadas.reduce((s, r) => s + r.resultado, 0)),
    resultadoBB: redondear(jugadas.reduce((s, r) => s + (r.resultadoBB ?? 0), 0)),
  };
}

/**
 * Agrupa las manos cerradas por partida, para la lista.
 * Devuelve [{ partidaId, partida (o null si ya no existe), manos: [resúmenes], total: sumarResultados }]
 *  - las partidas, de la más reciente a la más antigua (por la fecha de su última mano);
 *  - dentro de cada partida, las manos de la última a la primera.
 * Las manos en curso no salen.
 */
export function agruparPorPartida(manos, partidas = []) {
  const porId = new Map(partidas.map((p) => [p.id, p]));
  const grupos = new Map();
  for (const mano of manos) {
    if (!manoCerrada(mano)) continue;
    if (!grupos.has(mano.partidaId)) grupos.set(mano.partidaId, []);
    grupos.get(mano.partidaId).push(resumenMano(mano));
  }

  const resultado = [...grupos].map(([partidaId, resumenes]) => {
    resumenes.sort((a, b) => b.numero - a.numero || compararFechas(b.fecha, a.fecha));
    return {
      partidaId,
      partida: porId.get(partidaId) || null,
      manos: resumenes,
      total: sumarResultados(resumenes),
    };
  });
  resultado.sort((a, b) => compararFechas(ultimaFecha(b), ultimaFecha(a)));
  return resultado;
}

function ultimaFecha(grupo) {
  return grupo.manos.reduce((max, r) => (compararFechas(r.fecha, max) > 0 ? r.fecha : max), '');
}

// Las fechas se guardan como texto ISO ("2026-11-20T21:14…"), que se ordena bien como texto
function compararFechas(a, b) {
  const x = a || '', y = b || '';
  return x < y ? -1 : x > y ? 1 : 0;
}
