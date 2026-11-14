// preflop.js: el consejo antes del flop, por tablas de rangos según la posición (lógica pura,
// con tests en tests/tests.html). Ver el plan, "Revisión del paso 11".
//
// Antes del flop no se usa la regla de equidad (recomendacion.js): contra manos al azar hasta
// el showdown da consejos malos (UTG pagaba con AA y se retiraba con QQ). En su lugar:
//   1. Se mira QUÉ SITUACIÓN es, con los eventos de antes de tu turno: nadie ha entrado
//      (abrir), hay limpers, una subida, un 3-bet o un 4-bet o más.
//   2. La POSICIÓN se mide por los jugadores que quedan DETRÁS de ti antes del flop (ciegas
//      incluidas). Así una tabla vale para mesas de 2 a 9: el UTG de una mesa de 6 tiene 5
//      detrás, como el LJ de una de 9.
//   3. Se busca tu mano en la tabla que toca.
// Las mismas tablas dan el RANGO que se supone a cada rival según lo que hizo antes del flop
// (rangosDeRivales), para la equidad después del flop.
//
// Fichas cortas (15 BB efectivas o menos): all-in o fold, con rangos de "push".
// Si pagar, o el tamaño recomendado, es más del 40 % de tus fichas: all-in.

import { calcularEstado, posicionesDeMano } from './motor.js';
import { leerRango, unir, menos, parejasYMismoPalo, porcentaje, top, TODAS, clase } from './rangos.js';
import { ajustarTamano, pasoDeCiegas } from './teclado.js';

export const LIMITE_CORTO = 15;  // BB efectivas o menos → modo all-in o fold
export const PARTE_ALLIN = 0.4;  // pagar o subir más del 40 % de tus fichas → all-in

const R = leerRango;
const NADA = new Set();

// ---------------------------------------------------------------- Tablas

/** Rango de apertura según cuántos quedan detrás (8 = UTG de una mesa de 9). 'hu' = mano a mano. */
export const APERTURA = {
  8: R('77+, A9s+, KTs+, QTs+, JTs, AJo+, KQo'),
  6: R('66+, A8s+, A5s, KTs+, QTs+, JTs, T9s, ATo+, KQo'),
  5: R('55+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, ATo+, KJo+'),
  4: R('44+, A2s+, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, A9o+, KTo+, QJo'),
  3: R('22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, A8o+, A5o, KTo+, QTo+, JTo'),
  2: R('22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o'),
  1: R('22+, A2s+, K4s+, Q7s+, J7s+, T7s+, 97s+, 86s+, 75s+, 65s, 54s, A4o+, K9o+, Q9o+, J9o+, T9o'),
  hu: R('22+, A2+, K2+, Q2s+, Q5o+, J2s+, J7o+, T2s+, T7o+, 92s+, 97o+, 84s+, 87o, 73s+, 76o, 63s+, 52s+, 43s'),
};
APERTURA[7] = APERTURA[8];

/** Con limpers delante y sin subida: se paga (limp detrás) con estas, si no estás en las ciegas. */
export const LIMP_DETRAS = R('66-22, 54s, 65s, 76s, 87s, 98s, T9s');

/** Ante una subida, según desde dónde subió. "bb" se suma al call en la BB. */
export const ANTE_SUBIDA = {
  temprano: {
    tresBet: R('QQ+, AKs, AKo'),
    call: R('JJ-66, AQs, AJs, KQs'),
    bb: R('55-22, ATs, KJs, QJs, JTs, T9s, AQo'),
  },
  medio: {
    tresBet: R('JJ+, AQs+, AKo, A5s'),
    call: R('TT-55, AJs, ATs, KQs, KJs, QJs, JTs, T9s, AQo'),
    bb: R('44-22, A9s-A6s, A4s-A2s, KTs, QTs, J9s, 98s, AJo, KQo'),
  },
  tarde: {
    tresBet: R('TT+, AJs+, KQs, AQo+, A5s, A4s'),
    call: R('99-22, ATs-A6s, KJs, KTs, QJs, QTs, JTs, T9s, 98s, 87s, AJo, KQo'),
    bb: R('99-22, A9s-A6s, A3s-A2s, K2s-KJs, Q6s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o-AJo, K8o+, Q9o+, J9o+, T8o+, 98o, 87o'),
  },
};
/** La SB no paga: sube (3-bet) con la tabla + estas, o se retira. */
export const SB_EXTRA = R('99-88, ATs, KJs');

/** Ante un 3-bet, habiendo abierto tú. */
export const ANTE_3BET = {
  cuatroBet: R('QQ+, AKs, AKo'),
  cuatroBetTarde: R('A5s'),                     // si abriste desde el CO o el BTN
  call: R('JJ'),
  callEnPosicion: R('TT, 99, AQs, AJs, KQs'),   // en posición, contra un 3-bet de tarde o de las ciegas
};

/** Ante un 4-bet o más (o ante subida + 3-bet sin haber subido tú). */
export const ANTE_4BET = { subir: R('QQ+, AKs, AKo'), call: R('JJ') };
/** Lo que se supone a un rival que paga en esa situación (las mejores habrían subido). */
const CALL_4BET_RIVAL = R('JJ, TT, AQs, AKs, AKo');

/** Fichas cortas: all-in (push) sin nadie que haya subido, según cuántos quedan detrás. */
export const PUSH = {
  8: R('66+, A9s+, KTs+, QJs, AJo+, KQo'),
  6: R('55+, A8s+, KTs+, QTs+, JTs, ATo+, KQo'),
  5: R('44+, A5s+, K9s+, QTs+, JTs, A9o+, KJo+'),
  4: R('33+, A2s+, K9s+, Q9s+, J9s+, T9s, A8o+, KTo+, QJo'),
  3: R('22+, A2s+, K7s+, Q9s+, J9s+, T9s, 98s, A5o+, KTo+, QTo+'),
  2: R('22+, A2s+, K4s+, Q8s+, J8s+, T8s+, 98s, 87s, A2o+, K9o+, QTo+, JTo'),
  1: R('22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 97s+, 87s, A2o+, K7o+, Q9o+, J9o+'),
};
PUSH[7] = PUSH[8];
PUSH.hu = PUSH[1];
/** Fichas cortas ante una subida: all-in (o call si ya está all-in), según desde dónde subió. */
export const CORTO_ANTE_SUBIDA = {
  temprano: R('99+, AQs+, AKo'),
  medio: R('88+, AJs+, AQo+, KQs'),
  tarde: R('66+, A8s+, ATo+, KQs, KJs'),
};
/** Fichas cortas ante un 3-bet o más. */
export const CORTO_ANTE_3BET = R('TT+, AQs+, AKo');

// Rangos por porcentaje, para lo que no está en las tablas (un limp, la BB que pasa…)
const LIMP_RIVAL = () => menos(top(0.5), top(0.1));   // las mejores habrían subido
const BB_PASA = () => menos(TODAS, top(0.1));

// ---------------------------------------------------------------- Análisis de la mano

const tramoDe = (detras, hu) => (hu || detras <= 3 ? 'tarde' : detras === 4 ? 'medio' : 'temprano');
const MAS_ESTRECHO = { tarde: 'medio', medio: 'temprano', temprano: 'temprano' };
const aperturaDe = (detras, hu) => (hu ? APERTURA.hu : APERTURA[Math.min(8, Math.max(1, detras))]);
const pushDe = (detras, hu) => (hu ? PUSH.hu : PUSH[Math.min(8, Math.max(1, detras))]);

/**
 * Recorre las acciones de antes del flop. Para cada una guarda la situación de quien actuó
 * (justo antes de actuar) y qué hizo: 'fold', 'check', 'call' o 'sube' (subida o all-in que sube).
 * Devuelve { acciones: [{ indice, asiento, hizo, sit }], estado (tras los eventos), pos, hu }.
 */
export function analizarPreflop(mano, eventos = mano.eventos) {
  const pos = posicionesDeMano(mano);
  const hu = pos.preflop.length === 2;
  const acciones = [];
  let antes = calcularEstado(mano, []);
  for (let i = 0; i < eventos.length; i++) {
    const ev = eventos[i];
    if (ev.tipo === 'mesa' || (ev.tipo === 'accion' && ev.calle !== 'preflop')) break;
    const despues = calcularEstado(mano, eventos.slice(0, i + 1));
    if (ev.tipo === 'accion') {
      const sit = situacion(mano, pos, hu, acciones, antes, ev.asiento);
      let hizo;
      if (ev.accion === 'fold') hizo = 'fold';
      else if (despues.apuestaMaxima > antes.apuestaMaxima) hizo = 'sube';
      else if (antes.jugadores.find((j) => j.asiento === ev.asiento).aPagar > 0) hizo = 'call';
      else hizo = 'check';
      acciones.push({ indice: i, asiento: ev.asiento, hizo, hasta: despues.jugadores.find((j) => j.asiento === ev.asiento).puesto, sit });
    }
    antes = despues;
  }
  return { acciones, estado: antes, pos, hu };
}

/** La situación de "asiento" con las acciones anteriores y el estado de ese momento. */
function situacion(mano, pos, hu, acciones, estado, asiento) {
  const bb = mano.ciegas.bb;
  const detrasDe = (a) => pos.preflop.length - 1 - pos.preflop.indexOf(a);
  const posicionDe = (a) => pos.porAsiento[a].posicion;
  const yo = estado.jugadores.find((j) => j.asiento === asiento);
  const subidas = acciones.filter((a) => a.hizo === 'sube');
  const limpers = acciones.filter((a) => a.hizo === 'call' && (!subidas.length || a.indice < subidas[0].indice)).length;
  const ultima = subidas[subidas.length - 1];
  const callers = ultima ? acciones.filter((a) => a.hizo === 'call' && a.indice > ultima.indice).length : 0;

  // Fichas efectivas (en BB): las tuyas o las del rival vivo que más tiene, lo que sea menor
  const total = (j) => (j.fichas === null ? Infinity : j.fichas + j.puesto);
  const otros = estado.jugadores.filter((j) => j.vivo && j.asiento !== asiento);
  const efectivas = Math.min(total(yo), Math.max(0, ...otros.map(total))) / bb;

  const posicion = posicionDe(asiento);
  const s = {
    asiento,
    posicion,
    detras: detrasDe(asiento),
    hu,
    lugar: posicion === 'SB' ? 'sb' : posicion === 'BB' ? 'bb' : 'posicion',
    limpers,
    callers,
    efectivas,
    corto: efectivas <= LIMITE_CORTO,
    ultimaSubida: ultima ? ultima.hasta : bb,
  };
  if (!subidas.length) {
    s.tipo = limpers ? 'limpers' : 'abrir';
    return s;
  }
  const primera = subidas[0];
  const subidor = { asiento: primera.asiento, posicion: posicionDe(primera.asiento), detras: detrasDe(primera.asiento) };
  s.subidor = subidor;
  s.grande = primera.hasta > (4 + primera.sit.limpers) * bb;
  const tramo = tramoDe(subidor.detras, hu);
  s.tramo = s.grande ? MAS_ESTRECHO[tramo] : tramo;
  if (subidas.length === 1) { s.tipo = 'subida'; return s; }
  if (subidas.length === 2 && primera.asiento === asiento) {
    // Abriste tú y te han hecho 3-bet
    const tres = subidas[1];
    s.tipo = 'tres-bet';
    s.tresBetor = { asiento: tres.asiento, posicion: posicionDe(tres.asiento), detras: detrasDe(tres.asiento) };
    s.abristeTarde = !hu ? subidor.detras <= 3 && s.lugar === 'posicion' : true;
    s.enPosicion = pos.postflop.indexOf(asiento) > pos.postflop.indexOf(tres.asiento) && tramoDe(s.tresBetor.detras, hu) === 'tarde';
    return s;
  }
  s.tipo = 'cuatro-bet';
  s.subidas = subidas.length;
  return s;
}

/** La situación de quien tiene el turno ahora (null si no es antes del flop o no le toca a nadie). */
export function situacionPreflop(mano, eventos = mano.eventos) {
  const a = analizarPreflop(mano, eventos);
  if (a.estado.calle !== 'preflop' || a.estado.fase !== 'accion') return null;
  return situacion(mano, a.pos, a.hu, a.acciones, a.estado, a.estado.turno);
}

// ---------------------------------------------------------------- El consejo

const pct = (rango) => Math.round(porcentaje(rango) * 100) + ' %';
const art = (p) => (p === 'SB' || p === 'BB' ? 'la ' : 'el ');
const de = (p) => (art(p) === 'el ' ? 'del ' : 'de la ') + p;
const num = (n) => n.toLocaleString('es-ES', { maximumFractionDigits: 2 });

/** Qué dice la tabla para la clase "cl" en la situación "s" (sin tamaños ni la regla del 40 %). */
export function decidirPreflop(s, cl) {
  const en = (r) => r.has(cl);
  const desde = `${cl} desde ${art(s.posicion)}${s.posicion}`;
  const ante = s.subidor ? `${cl} en ${art(s.posicion)}${s.posicion} ante subida ${de(s.subidor.posicion)}` : desde;

  if (s.corto) {
    const corto = `con ${num(Math.floor(s.efectivas * 10) / 10)} BB efectivas (${LIMITE_CORTO} o menos) se juega all-in o fold`;
    if (s.tipo === 'abrir' || s.tipo === 'limpers') {
      const r = pushDe(s.detras, s.hu);
      if (en(r)) return { accion: 'allin', motivo: `${desde}: ${corto}, y está en el rango de all-in ${de(s.posicion)} (${pct(r)})` };
      return { accion: 'fold', motivo: `${desde}: ${corto}, y no está en el rango de all-in ${de(s.posicion)} (${pct(r)})` };
    }
    const r = s.tipo === 'subida' ? CORTO_ANTE_SUBIDA[s.tramo] : CORTO_ANTE_3BET;
    const que = s.tipo === 'subida' ? `ante subida ${de(s.subidor.posicion)}` : 'ante un 3-bet o más';
    if (en(r)) return { accion: 'allin', motivo: `${cl} ${que}: ${corto}, y está en el rango de all-in (${pct(r)})` };
    return { accion: 'fold', motivo: `${cl} ${que}: ${corto}, y no está en el rango de all-in (${pct(r)})` };
  }

  if (s.tipo === 'abrir') {
    const r = aperturaDe(s.detras, s.hu);
    const bbs = s.lugar === 'sb' && !s.hu ? 3 : 2.5;
    if (en(r)) return { accion: 'subir', bb: bbs, motivo: `${desde}: está en el rango de apertura ${de(s.posicion)} (${pct(r)})` };
    return { accion: 'fold', motivo: `${desde}: no está en el rango de apertura ${de(s.posicion)} (${pct(r)})` };
  }

  if (s.tipo === 'limpers') {
    const r = aperturaDe(s.detras + 1, s.hu && s.lugar !== 'bb');
    const limp = s.limpers === 1 ? '1 limper' : `${s.limpers} limpers`;
    if (en(r)) return { accion: 'subir', bb: 3 + s.limpers, motivo: `${desde} con ${limp}: está en el rango para aislar (el de apertura de una posición antes, ${pct(r)})` };
    if (s.lugar === 'bb') return { accion: 'check', motivo: `${desde} con ${limp}: no es para subir, y pasar es gratis` };
    if (en(LIMP_DETRAS)) return { accion: 'call', motivo: `${desde} con ${limp}: pareja pequeña o conectores del mismo palo, se entra barato (${s.lugar === 'sb' ? 'completar' : 'limp'}) para ver el flop` };
    return { accion: 'fold', motivo: `${desde} con ${limp}: no está en el rango para aislar ni para entrar barato` };
  }

  if (s.tipo === 'subida') {
    const t = ANTE_SUBIDA[s.tramo];
    const tres = s.lugar === 'sb' ? unir(t.tresBet, SB_EXTRA) : t.tresBet;
    let call = s.lugar === 'sb' ? NADA : s.lugar === 'bb' ? unir(t.call, t.bb) : t.call;
    call = menos(call, tres);
    if (s.callers > 0) call = parejasYMismoPalo(call);
    const tramo = s.grande ? `subida grande: tabla de ${s.tramo}` : `subida de ${s.tramo}`;
    const mult = (s.lugar === 'posicion' ? 3 : 4) + s.callers;
    if (en(tres)) return { accion: 'subir', veces: mult, motivo: `${ante}: está en el rango de 3-bet (${tramo}, ${pct(tres)})` };
    if (en(call)) {
      const multi = s.callers > 0 ? '; con más jugadores ya dentro, solo parejas y manos del mismo palo' : '';
      return { accion: 'call', motivo: `${ante}: está en el rango de call${s.lugar === 'bb' ? ' de la BB' : ''} (${tramo}, ${pct(call)})${multi}` };
    }
    const sb = s.lugar === 'sb' ? '; desde la SB se sube o se retira' : '';
    return { accion: 'fold', motivo: `${ante}: no está en el rango de 3-bet ni de call (${tramo})${sb}` };
  }

  if (s.tipo === 'tres-bet') {
    const cuatro = s.abristeTarde ? unir(ANTE_3BET.cuatroBet, ANTE_3BET.cuatroBetTarde) : ANTE_3BET.cuatroBet;
    const call = s.enPosicion ? unir(ANTE_3BET.call, ANTE_3BET.callEnPosicion) : ANTE_3BET.call;
    const ante3 = `${cl}: abriste desde ${art(s.posicion)}${s.posicion} y ${art(s.tresBetor.posicion)}${s.tresBetor.posicion} hizo 3-bet`;
    const veces = s.lugar === 'posicion' ? 2.2 : 2.5;
    if (en(cuatro)) return { accion: 'subir', veces, motivo: `${ante3}: está en el rango de 4-bet (${pct(cuatro)})` };
    if (en(call)) return { accion: 'call', motivo: `${ante3}: está en el rango de call${s.enPosicion ? ' (en posición)' : ''} (${pct(call)})` };
    return { accion: 'fold', motivo: `${ante3}: no está en el rango de 4-bet ni de call` };
  }

  // Ante un 4-bet o más, o ante subida + 3-bet sin haber subido tú
  const que = s.subidas >= 3 ? `${cl} ante un ${s.subidas + 1}-bet` : `${cl} ante subida y 3-bet`;
  if (en(ANTE_4BET.subir)) {
    if (s.subidas >= 3) return { accion: 'allin', motivo: `${que}: QQ+ y AK van all-in` };
    return { accion: 'subir', veces: s.lugar === 'posicion' ? 2.2 : 2.5, motivo: `${que}: QQ+ y AK suben (4-bet)` };
  }
  if (en(ANTE_4BET.call)) return { accion: 'call', motivo: `${que}: con JJ se paga` };
  return { accion: 'fold', motivo: `${que}: solo se sigue con QQ+, AK (subir) y JJ (call)` };
}

/**
 * El consejo antes del flop para quien tiene el turno (tú), con tus 2 cartas.
 * Devuelve { consejo: 'fold' | 'check' | 'call' | 'subir' | 'allin', hasta, texto, sit, fuente: 'tabla' }
 * o null si no es antes del flop o no hay turno.
 */
export function recomendarPreflop(mano, mias, eventos = mano.eventos) {
  const a = analizarPreflop(mano, eventos);
  const estado = a.estado;
  if (estado.calle !== 'preflop' || estado.fase !== 'accion') return null;
  const s = situacion(mano, a.pos, a.hu, a.acciones, estado, estado.turno);
  const cl = clase(mias[0], mias[1]);
  const d = decidirPreflop(s, cl);
  const bb = mano.ciegas.bb;
  const yo = estado.jugadores.find((j) => j.asiento === estado.turno);
  const fichas = yo.fichas; // las que le quedan (null si no se llevan)
  const aPagar = estado.aPagar;
  const r = { sit: s, clase: cl, fuente: 'tabla', hasta: null };
  // ¿Ir all-in sería solo pagar? (no te llega para más, o nadie vivo puede pagar una subida)
  const puedenPagar = estado.jugadores.some((j) => j.vivo && j.asiento !== yo.asiento && !j.allin && (j.fichas === null || j.fichas > 0));
  const allinEsCall = fichas !== null && (fichas <= aPagar || !puedenPagar);
  const sinFichas = (t) => `${t} (no te llega para más: es all-in)`;

  let accion = d.accion;
  let motivo = d.motivo;
  if (accion === 'fold' && aPagar === 0) accion = 'check';
  if (accion === 'check' && aPagar > 0) accion = 'fold';

  if (accion === 'subir') {
    const exacto = d.bb ? d.bb * bb : d.veces * s.ultimaSubida;
    const t = ajustarTamano(estado, exacto, pasoDeCiegas(mano.ciegas));
    if (t.allin || allinEsCall) accion = 'allin';
    else if (fichas !== null && t.hasta - yo.puesto > PARTE_ALLIN * fichas) {
      accion = 'allin';
      motivo += `; subir hasta ${num(t.hasta)} ya es más del 40 % de tus fichas`;
    } else {
      const tam = d.bb ? `${num(d.bb)} BB` : `${num(d.veces)}× la subida`;
      return { ...r, consejo: 'subir', hasta: t.hasta, texto: `Subir hasta ${num(t.hasta)} (${tam}): ${motivo}.` };
    }
  }
  if (accion === 'call' && fichas !== null && aPagar > PARTE_ALLIN * fichas && !allinEsCall) {
    accion = 'allin';
    motivo += `; pagar ${num(aPagar)} ya es más del 40 % de tus fichas`;
  }
  if (accion === 'allin') {
    if (fichas === null) {
      return { ...r, consejo: 'allin', texto: `All-in: ${motivo}.` };
    }
    const hasta = yo.puesto + fichas;
    if (allinEsCall) return { ...r, consejo: 'call', texto: sinFichas(`Call: ${motivo}`) + '.' };
    return { ...r, consejo: 'allin', hasta, texto: `All-in (hasta ${num(hasta)}): ${motivo}.` };
  }
  const verbo = { fold: 'Fold', check: 'Check', call: 'Call' }[accion];
  return { ...r, consejo: accion, texto: `${verbo}: ${motivo}.` };
}

// ---------------------------------------------------------------- Rangos de los rivales

/** El rango que se supone a quien hizo "hizo" (sube, call o check) en la situación "s". */
export function rangoDeAccion(s, hizo) {
  let r = null;
  if (hizo === 'check') return BB_PASA();
  if (s.corto && hizo === 'sube') {
    r = s.tipo === 'abrir' || s.tipo === 'limpers' ? pushDe(s.detras, s.hu)
      : s.tipo === 'subida' ? CORTO_ANTE_SUBIDA[s.tramo] : CORTO_ANTE_3BET;
  } else if (s.tipo === 'abrir') {
    r = hizo === 'sube' ? aperturaDe(s.detras, s.hu) : LIMP_RIVAL();
  } else if (s.tipo === 'limpers') {
    r = hizo === 'sube' ? aperturaDe(s.detras + 1, s.hu && s.lugar !== 'bb') : LIMP_RIVAL();
  } else if (s.tipo === 'subida') {
    const t = ANTE_SUBIDA[s.tramo];
    const tres = s.lugar === 'sb' ? unir(t.tresBet, SB_EXTRA) : t.tresBet;
    if (hizo === 'sube') r = tres;
    else {
      // La SB no debería pagar: se le supone el call de la posición
      r = menos(s.lugar === 'bb' ? unir(t.call, t.bb) : t.call, tres);
      if (s.callers > 0) r = parejasYMismoPalo(r);
    }
  } else if (s.tipo === 'tres-bet') {
    r = hizo === 'sube'
      ? (s.abristeTarde ? unir(ANTE_3BET.cuatroBet, ANTE_3BET.cuatroBetTarde) : ANTE_3BET.cuatroBet)
      : unir(ANTE_3BET.call, ANTE_3BET.callEnPosicion);
  } else {
    r = hizo === 'sube' ? ANTE_4BET.subir : CALL_4BET_RIVAL;
  }
  if (r && r.size) return r;
  // Por si una tabla sale vacía: por porcentajes
  return hizo === 'sube' ? top(0.15) : menos(top(0.35), top(0.05));
}

const QUE_HIZO = { sube: 'subió', call: 'pagó', check: 'pasó' };

/**
 * Rango supuesto de cada rival vivo según su última acción voluntaria antes del flop.
 * Devuelve [{ asiento, rango (Set de clases) | null, motivo }] para los rivales vivos
 * (rango null = no se sabe: se le reparte una mano al azar).
 */
export function rangosDeRivales(mano, yo, eventos = mano.eventos) {
  const a = analizarPreflop(mano, eventos);
  const vivos = calcularEstado(mano, eventos).vivos.filter((x) => x !== yo);
  return vivos.map((asiento) => {
    const ultima = [...a.acciones].reverse().find((x) => x.asiento === asiento && x.hizo !== 'fold');
    if (!ultima) return { asiento, rango: null, motivo: 'sin acción antes del flop' };
    const rango = rangoDeAccion(ultima.sit, ultima.hizo);
    return { asiento, rango, motivo: `${QUE_HIZO[ultima.hizo]} desde ${art(ultima.sit.posicion)}${ultima.sit.posicion} (${pct(rango)})` };
  });
}
