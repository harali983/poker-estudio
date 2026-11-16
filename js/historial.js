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
import { POSICIONES } from './posiciones.js';

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
    // ¿Hiciste caso a la app? (solo cuentan las decisiones que se pueden comprobar)
    noSeguiste: (mano.decisiones || []).some((d) => siguioRecomendacion(mano, d) === false),
  };
}

// ---------------------------------------------------------------- ¿Seguiste la recomendación?

// Lo que hizo de verdad una acción (como en estadisticas.js): por lo que puso, no por el botón.
function tipoDeAccion(antes, despues, ev) {
  if (ev.accion === 'fold') return 'fold';
  if (despues.apuestaMaxima > antes.apuestaMaxima) return 'agresiva';
  const jA = antes.jugadores.find((j) => j.asiento === ev.asiento);
  const jD = despues.jugadores.find((j) => j.asiento === ev.asiento);
  return jA && jD && jD.puesto > jA.puesto ? 'call' : 'check';
}

/**
 * ¿Hiciste lo que te recomendó la app en esa decisión? true / false, o null si no se puede
 * saber (consejo sin calcular, o el evento ya no es una acción tuya).
 * Cuenta lo que hiciste de verdad, no el tamaño:
 *  - subir / apostar → cualquier apuesta o subida (subir a 9 cuando decía 6 cuenta como seguirla);
 *  - all-in → un all-in o cualquier subida;
 *  - call → pagar (también un all-in que solo iguala);
 *  - check → check;
 *  - fold → retirarse, o check si no había nada que pagar (pasar gratis no es desobedecer).
 */
export function siguioRecomendacion(mano, decision) {
  if (!decision || !decision.consejo) return null;
  const yo = mano.jugadores.find((j) => j.jugadorId === 'yo');
  const ev = mano.eventos[decision.evento];
  if (!yo || !ev || ev.tipo !== 'accion' || ev.asiento !== yo.asiento) return null;

  const antes = calcularEstado(mano, mano.eventos.slice(0, decision.evento));
  const despues = calcularEstado(mano, mano.eventos.slice(0, decision.evento + 1));
  const hice = tipoDeAccion(antes, despues, ev);
  switch (decision.consejo) {
    case 'subir':
    case 'apostar': return hice === 'agresiva';
    case 'allin': return hice === 'agresiva' || ev.accion === 'allin';
    case 'call': return hice === 'call';
    case 'check': return hice === 'check';
    case 'fold': return hice === 'fold' || (hice === 'check' && antes.aPagar === 0);
    default: return null;
  }
}

// ---------------------------------------------------------------- Filtros

/** Filtros vacíos (se ven todas las manos). */
export const SIN_FILTROS = Object.freeze({ posicion: '', resultado: '', cartas: '', showdown: false, noSeguiste: false });

/** ¿Hay algún filtro puesto? Un texto de cartas que no se entiende no cuenta (no filtra). */
export function hayFiltros(filtros) {
  return Boolean(filtros.posicion || filtros.resultado || filtroDeCartas(filtros.cartas) || filtros.showdown || filtros.noSeguiste);
}

const LETRAS = 'AKQJT98765432';

/**
 * Interpreta el filtro de cartas. Devuelve una función clase → ¿vale?, o null si el texto
 * no se entiende (y entonces no se filtra). Texto vacío → undefined (sin filtro).
 * Admite: "parejas", "suited" / "s", "offsuit" / "o", "AK" (AKs y AKo), "AKs", "AKo",
 * "QQ", "A" (cualquier mano con un as), "10" en lugar de "T", minúsculas y "KA" = "AK".
 */
export function filtroDeCartas(texto) {
  let t = String(texto || '').trim().toUpperCase().replace(/\s+/g, '').replace(/10/g, 'T');
  if (!t) return undefined;
  if (t === 'PAREJAS' || t === 'PAREJA' || t === 'PP') return (cl) => cl.length === 2;
  if (t === 'SUITED' || t === 'S') return (cl) => cl[2] === 's';
  if (t === 'OFFSUIT' || t === 'O') return (cl) => cl[2] === 'o';

  const m = /^([AKQJT2-9])([AKQJT2-9])?([SO])?$/.exec(t);
  if (!m) return null;
  const [, a, b, palo] = m;
  if (!b) return palo ? null : (cl) => cl.includes(a);  // "A": cualquier mano con un as
  if (a === b) return palo ? null : (cl) => cl === a + a;  // "QQ" (una pareja no es suited)
  // Ordenar las dos letras como en la clase: la más alta primero ("KA" → "AK")
  const [alta, baja] = LETRAS.indexOf(a) < LETRAS.indexOf(b) ? [a, b] : [b, a];
  const base = alta + baja;
  return palo ? (cl) => cl === base + palo.toLowerCase() : (cl) => cl.slice(0, 2) === base;
}

/** ¿Pasa esta mano (resumen) los filtros? Con cualquier filtro puesto, las manos sin ti no salen. */
export function pasaFiltros(r, filtros) {
  if (!hayFiltros(filtros)) return true;
  if (!r.jugaba) return false;
  if (filtros.posicion && r.posicion !== filtros.posicion) return false;
  if (filtros.resultado === 'ganadas' && !(r.resultado > 0)) return false;
  if (filtros.resultado === 'perdidas' && !(r.resultado < 0)) return false;
  if (filtros.resultado === 'cero' && r.resultado !== 0) return false;
  if (filtros.showdown && !r.showdown) return false;
  if (filtros.noSeguiste && !r.noSeguiste) return false;
  const deCartas = filtroDeCartas(filtros.cartas);
  if (deCartas && !(r.clase && deCartas(r.clase))) return false;
  return true;
}

/**
 * Aplica los filtros a los grupos de agruparPorPartida: quita las manos que no pasan, las
 * partidas que se quedan vacías y recalcula el total de cada partida con las manos que quedan.
 * Devuelve { grupos, total: nº de manos, vistas: nº de manos que pasan }.
 */
export function filtrarGrupos(grupos, filtros) {
  let total = 0, vistas = 0;
  const r = [];
  for (const g of grupos) {
    total += g.manos.length;
    const manos = g.manos.filter((m) => pasaFiltros(m, filtros));
    vistas += manos.length;
    if (manos.length) r.push({ ...g, manos, total: sumarResultados(manos) });
  }
  return { grupos: r, total, vistas };
}

/** Las posiciones que aparecen en tus manos (para el desplegable), en el orden de la mesa. */
export function posicionesUsadas(grupos) {
  const ORDEN = POSICIONES[9].flatMap((p) => (p === 'BTN' ? ['BTN', 'BTN/SB'] : [p]));
  const usadas = new Set();
  for (const g of grupos) for (const m of g.manos) if (m.posicion) usadas.add(m.posicion);
  const rango = (p) => (ORDEN.includes(p) ? ORDEN.indexOf(p) : ORDEN.length);
  return [...usadas].sort((a, b) => rango(a) - rango(b) || (a < b ? -1 : 1));
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
