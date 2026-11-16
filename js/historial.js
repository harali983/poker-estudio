// historial.js: "Mis manos" (lógica pura, con tests).
//
// Convierte cada mano cerrada en un resumen corto para la lista (tus cartas, posición,
// resultado…) y agrupa los resúmenes por partida. No lee la base de datos ni toca la pantalla:
// pantalla-manos.js le pasa las manos y las partidas ya leídas.
//
// Resultado en BB: se calcula con la BB DE ESA MANO. Al sumar varias manos se suman los
// resultados en BB mano a mano (no "total en fichas ÷ BB de ahora"), porque las ciegas
// pueden cambiar durante la partida.

import { calcularEstado, opciones, posicionesDeMano } from './motor.js';
import { netos, redondear, mesaCompleta } from './final.js';
import { evaluar } from './evaluador.js';
import { nombreJugada } from './describir.js';
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
 *  - all-in → acabar all-in (sin fichas contadas, tocar All-in); una subida que no te deja
 *    all-in no cuenta;
 *  - subir / apostar / all-in cuando no podías subir (una subida all-in incompleta no te
 *    reabrió la acción) → pagar, que es lo que resalta la pantalla;
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
  const op = opciones(antes);
  // Si no podías subir (p. ej. una subida all-in incompleta no te reabrió la acción), la
  // pantalla resalta Call en lugar de Subir / All-in: pagar cuenta como seguir el consejo.
  const noPodiasSubir = op && !op.subir && !op.apostar;
  const quedeAllin = Boolean((despues.jugadores.find((j) => j.asiento === yo.asiento) || {}).allin);
  switch (decision.consejo) {
    case 'subir':
    case 'apostar': return hice === 'agresiva' || (noPodiasSubir && hice === 'call');
    case 'allin':
      if (noPodiasSubir && hice === 'call') return true;
      // Solo cuenta acabar all-in (sin fichas contadas, haber tocado All-in)
      return quedeAllin || ev.accion === 'allin';
    case 'call': return hice === 'call';
    case 'check': return hice === 'check';
    case 'fold': return hice === 'fold' || (hice === 'check' && antes.aPagar === 0);
    default: return null;
  }
}

// ---------------------------------------------------------------- Ficha de una mano

const NOMBRE_CALLE = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };

/**
 * Todo lo que enseña la ficha de una mano cerrada (pantalla-ver-mano.js), ya con sus textos:
 * {
 *   resumen: resumenMano(mano), ciegas, notas,
 *   mesa: [cartas de la mesa que se anotaron],
 *   jugadores: [{ asiento, nombre, yo, posicion, fichasInicio, puesto, neto, retirado }],
 *   calles: [{ calle, titulo, cartas: null (preflop) | [..] ([] = sin anotar),
 *              bote: el bote al empezar la calle (null en el preflop), jugadores: cuántos seguían,
 *              lineas: [{ evento, asiento, nombre, yo, tipo, accion, texto }] }],
 *   final: { motivo, lineas: [textos], mostradas: [{ asiento, nombre, yo, cartas, jugada | null }] }
 * }
 * nombres: Map jugadorId → nombre (tú sales como "Tú"; sin nombre, "Asiento 3").
 * numero: cómo se escribe una cantidad (la pantalla pasa el formato español).
 * En cada línea, "tipo" es lo que pasó de verdad: ante, ciega, fold, check, call o agresiva.
 */
export function fichaDeMano(mano, nombres = new Map(), numero = String) {
  const estado = calcularEstado(mano);
  const pos = posicionesDeMano(mano);
  const porAsiento = new Map(mano.jugadores.map((j) => [j.asiento, j]));
  const esYo = (a) => (porAsiento.get(a) || {}).jugadorId === 'yo';
  const nombre = (a) => {
    if (esYo(a)) return 'Tú';
    const j = porAsiento.get(a);
    return (j && nombres.get(j.jugadorId)) || 'Asiento ' + (a + 1);
  };
  const quien = (a) => ({ asiento: a, nombre: nombre(a), yo: esYo(a) });

  // ---- Acciones por calle ----
  const calles = [{ calle: 'preflop', titulo: NOMBRE_CALLE.preflop, cartas: null, bote: null, jugadores: mano.jugadores.length, lineas: [] }];
  // Si todos ponen el mismo ante, una sola línea en lugar de una por jugador
  const antes = mano.eventos.filter((ev) => ev.tipo === 'ante');
  const anteIgual = antes.length > 1 && antes.every((ev) => ev.cantidad === antes[0].cantidad);
  if (anteIgual) {
    calles[0].lineas.push({ evento: null, asiento: null, nombre: 'Todos', yo: false, tipo: 'ante',
      accion: `ponen el ante (${numero(antes[0].cantidad)})`, texto: `Todos ponen el ante (${numero(antes[0].cantidad)})` });
  }

  let previo = calcularEstado(mano, []);
  mano.eventos.forEach((ev, i) => {
    const despues = calcularEstado(mano, mano.eventos.slice(0, i + 1));
    if (ev.tipo === 'mesa') {
      calles.push({ calle: ev.calle, titulo: NOMBRE_CALLE[ev.calle] || ev.calle, cartas: [...(ev.cartas || [])],
        bote: previo.bote, jugadores: previo.vivos.length, lineas: [] });
    } else if (porAsiento.has(ev.asiento) && !(ev.tipo === 'ante' && anteIgual)) {
      const { tipo, accion } = textoDeEvento(ev, previo, despues, esYo(ev.asiento), ev.asiento === pos.bb, numero);
      calles[calles.length - 1].lineas.push({ evento: i, ...quien(ev.asiento), tipo, accion, texto: nombre(ev.asiento) + ' ' + accion });
    }
    previo = despues;
  });

  // ---- Jugadores: lo que puso cada uno y su resultado ----
  const neto = netos(estado, mano.final);
  const jugadores = mano.jugadores.map((j) => {
    const e = estado.jugadores.find((x) => x.asiento === j.asiento);
    return { ...quien(j.asiento), posicion: j.posicion, fichasInicio: j.fichasInicio ?? null,
      puesto: e.total, neto: neto.get(j.asiento) ?? 0, retirado: !e.vivo };
  });

  // ---- Final: quién gana, lo devuelto, muck y cartas mostradas ----
  const f = mano.final;
  const lineas = [];
  const reparto = (ganadores) => ganadores.map((g) => `${nombre(g.asiento)} ${numero(g.cantidad)}`).join(' · ');
  if (f.botes) {
    f.botes.forEach((b, k) => {
      const nombreBote = k === 0 ? 'Bote principal' : f.botes.length === 2 ? 'Bote secundario' : 'Bote secundario ' + k;
      lineas.push(`${nombreBote} (${numero(b.cantidad)}): ${reparto(b.ganadores)}.`);
    });
  } else if (f.ganadores.length === 1) {
    const g = f.ganadores[0];
    const como = f.motivo === 'showdown' ? 'en el showdown' : 'sin showdown';
    lineas.push(esYo(g.asiento) ? `Ganas tú ${como}: te llevas ${numero(g.cantidad)}.`
      : `Gana ${nombre(g.asiento)} ${como}: se lleva ${numero(g.cantidad)}.`);
  } else if (f.ganadores.length > 1) {
    lineas.push(`Bote repartido: ${reparto(f.ganadores)}.`);
  }
  if (f.devuelto) {
    const d = f.devuelto;
    lineas.push(esYo(d.asiento) ? `Recuperas ${numero(d.cantidad)} que nadie pagó.`
      : `${nombre(d.asiento)} recupera ${numero(d.cantidad)} que nadie pagó.`);
  }
  for (const a of f.muck || []) {
    lineas.push(esYo(a) ? 'Tiras tus cartas sin enseñarlas (muck).' : `${nombre(a)} tira sus cartas sin enseñarlas (muck).`);
  }
  const mesa5 = mesaCompleta(mano);
  const mostradas = (f.mostradas || []).filter((m) => m.cartas && m.cartas.length).map((m) => ({
    ...quien(m.asiento),
    cartas: [...m.cartas],
    jugada: mesa5 && m.cartas.length === 2 ? nombreJugada(evaluar([...m.cartas, ...mesa5])) : null,
  }));

  return {
    resumen: resumenMano(mano),
    ciegas: { ...mano.ciegas },
    notas: mano.notas || '',
    mesa: [...estado.mesa],
    jugadores,
    calles,
    final: { motivo: f.motivo, lineas, mostradas },
  };
}

// Lo que hizo un evento, dicho en una frase sin el nombre: "sube hasta 6", "pagas 4 (hasta 6)".
// Las cantidades salen de lo que el motor puso de verdad (no de lo que se tecleó).
function textoDeEvento(ev, antes, despues, yo, esBB, numero) {
  const jA = antes.jugadores.find((j) => j.asiento === ev.asiento);
  const jD = despues.jugadores.find((j) => j.asiento === ev.asiento);
  const v = (el, tu) => (yo ? tu : el);
  const quedaAllin = jD.allin && !jA.allin;
  const yAllin = quedaAllin ? v(' y queda all-in', ' y quedas all-in') : '';

  if (ev.tipo === 'ante') {
    return { tipo: 'ante', accion: `${v('pone', 'pones')} el ante (${numero(redondear(jD.total - jA.total))})` + yAllin };
  }
  if (ev.tipo === 'ciega') {
    return { tipo: 'ciega', accion: `${v('pone', 'pones')} la ciega ${esBB ? 'grande' : 'pequeña'} (${numero(jD.puesto)})` + yAllin };
  }

  const tipo = tipoDeAccion(antes, despues, ev);
  const anadido = redondear(jD.puesto - jA.puesto);
  const hasta = numero(jD.puesto);
  let accion;
  switch (ev.accion) {
    case 'fold': accion = v('se retira', 'te retiras'); break;
    case 'check': accion = v('pasa', 'pasas'); break;
    case 'call':
      if (tipo === 'check') { accion = v('pasa', 'pasas'); break; } // call sin nada que pagar
      accion = `${v('paga', 'pagas')} ${numero(anadido)}` + (anadido !== jD.puesto ? ` (hasta ${hasta})` : '') + yAllin;
      break;
    case 'apuesta': accion = `${v('apuesta', 'apuestas')} ${hasta}` + yAllin; break;
    case 'subida': accion = `${v('sube', 'subes')} hasta ${hasta}` + yAllin; break;
    case 'allin': accion = v('va all-in', 'vas all-in') + (anadido > 0 ? ` (hasta ${hasta})` : ''); break;
    default: accion = String(ev.accion);
  }
  return { tipo, accion };
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
