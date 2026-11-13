// estadisticas.js: las "participaciones" de una mano (lógica pura, con tests).
//
// Una participación es una fila por jugador y mano con lo que HIZO y las OPORTUNIDADES que
// tuvo de hacerlo (ver el plan, 2.5, "Participaciones: hechos y oportunidades"). Así cada
// porcentaje se divide entre las veces que pudo hacerlo, no entre todas las manos.
//
// Se calcula a partir de los eventos de la mano cerrada (con su "final"): se puede regenerar
// en cualquier momento si cambia la fórmula de una estadística.
//
// Cada acción se clasifica por lo que hizo de verdad (no por el botón que se tocó):
//   agresiva → subió lo más alto puesto en la calle (apuesta, subida o all-in que sube)
//   call     → puso fichas para igualar (también un all-in que no llega)
//   check    → no puso nada
//   fold     → se retiró

import { calcularEstado } from './motor.js';
import { netos } from './final.js';
import { GRUPOS } from './posiciones.js';

const POSTFLOP = ['flop', 'turn', 'river'];
const porCalle = () => ({ flop: 0, turn: 0, river: 0 });

/** Qué hizo de verdad cada acción. Devuelve [{ indice, asiento, calle, tipo, aPagar }]. */
export function accionesClasificadas(mano) {
  const r = [];
  let antes = calcularEstado(mano, []);
  mano.eventos.forEach((ev, i) => {
    const despues = calcularEstado(mano, mano.eventos.slice(0, i + 1));
    if (ev.tipo === 'accion') {
      const jA = antes.jugadores.find((j) => j.asiento === ev.asiento);
      const jD = despues.jugadores.find((j) => j.asiento === ev.asiento);
      let tipo;
      if (ev.accion === 'fold') tipo = 'fold';
      else if (despues.apuestaMaxima > antes.apuestaMaxima) tipo = 'agresiva';
      else if (jD && jA && jD.puesto > jA.puesto) tipo = 'call';
      else tipo = 'check';
      r.push({ indice: i, asiento: ev.asiento, calle: antes.calle, tipo, aPagar: jA ? jA.aPagar : 0, vivos: antes.vivos });
    } else if (ev.tipo === 'mesa') {
      r.push({ indice: i, mesa: ev.calle, vivos: antes.vivos });
    }
    antes = despues;
  });
  return r;
}

/** Las participaciones de una mano cerrada (mano.final no es null). Una por jugador con perfil. */
export function calcularParticipaciones(mano) {
  const estado = calcularEstado(mano);
  const neto = netos(estado, mano.final);
  const filas = new Map();
  for (const j of mano.jugadores) {
    filas.set(j.asiento, {
      id: mano.id + ':' + j.asiento,
      jugadorId: j.jugadorId,
      manoId: mano.id,
      partidaId: mano.partidaId,
      fecha: mano.fecha,
      posicion: j.posicion,
      grupo: GRUPOS[j.posicion] || null,
      bb: mano.ciegas.bb,

      cuentaPreflop: true, vpip: false, pfr: false,
      puedeAbrir: false, abrio: false,
      puede3bet: false, hizo3bet: false,
      enfrenta3bet: false, foldA3bet: false,
      puedeCbet: false, hizoCbet: false,
      enfrentaCbet: false, foldACbet: false,
      apuestasEnfrentadas: porCalle(),
      foldsAApuesta: porCalle(),
      agresivas: porCalle(),
      calls: porCalle(),
      accionesPostflop: 0,

      vioFlop: false, llegoAShowdown: false, ganoShowdown: false,
      mostro: null, resultado: neto.get(j.asiento) ?? 0,
    });
  }

  // Antes del flop
  let subidas = 0;            // subidas (sin contar las ciegas)
  let voluntarias = 0;        // calls y subidas (sin contar las ciegas)
  let primerSubidor = null;
  let ultimoSubidor = null;   // el agresor antes del flop (para la c-bet)
  const yaHablo = new Set();
  // En el flop
  let agresivasFlop = 0;
  let cbetHecha = false;
  const hablaronEnFlop = new Set();

  for (const a of accionesClasificadas(mano)) {
    if (a.mesa) {
      if (a.mesa === 'flop') for (const asiento of a.vivos) if (filas.has(asiento)) filas.get(asiento).vioFlop = true;
      continue;
    }
    const f = filas.get(a.asiento);
    if (!f) continue;
    const agresiva = a.tipo === 'agresiva';

    if (a.calle === 'preflop') {
      if (!yaHablo.has(a.asiento)) {
        yaHablo.add(a.asiento);
        if (voluntarias === 0) { f.puedeAbrir = true; if (agresiva) f.abrio = true; }
      }
      if (subidas === 1 && ultimoSubidor !== a.asiento) { f.puede3bet = true; if (agresiva) f.hizo3bet = true; }
      if (subidas === 2 && primerSubidor === a.asiento) { f.enfrenta3bet = true; if (a.tipo === 'fold') f.foldA3bet = true; }
      if (agresiva || a.tipo === 'call') { f.vpip = true; voluntarias++; }
      if (agresiva) {
        f.pfr = true;
        subidas++;
        if (primerSubidor === null) primerSubidor = a.asiento;
        ultimoSubidor = a.asiento;
      }
      continue;
    }

    // Después del flop
    const calle = a.calle;
    f.accionesPostflop++;
    if (a.aPagar > 0) {
      f.apuestasEnfrentadas[calle]++;
      if (a.tipo === 'fold') f.foldsAApuesta[calle]++;
    }
    if (agresiva) f.agresivas[calle]++;
    if (a.tipo === 'call') f.calls[calle]++;

    if (calle === 'flop') {
      if (a.asiento === ultimoSubidor && !hablaronEnFlop.has(a.asiento) && agresivasFlop === 0) {
        f.puedeCbet = true;
        if (agresiva) { f.hizoCbet = true; cbetHecha = true; }
      } else if (cbetHecha && agresivasFlop === 1 && a.asiento !== ultimoSubidor) {
        f.enfrentaCbet = true;
        if (a.tipo === 'fold') f.foldACbet = true;
      }
      hablaronEnFlop.add(a.asiento);
      if (agresiva) agresivasFlop++;
    }
  }

  // La BB que gana sin hablar (todos se retiran) no cuenta para el VPIP ni el PFR
  if (mano.final.motivo === 'retirada' && estado.calle === 'preflop' && !yaHablo.has(estado.ganador)) {
    const f = filas.get(estado.ganador);
    if (f) f.cuentaPreflop = false;
  }

  // Final
  const showdown = mano.final.motivo === 'showdown';
  const ganadores = new Set(mano.final.ganadores.map((g) => g.asiento));
  for (const asiento of estado.vivos) {
    const f = filas.get(asiento);
    if (f && showdown) {
      f.llegoAShowdown = true;
      f.ganoShowdown = ganadores.has(asiento);
    }
  }
  for (const m of mano.final.mostradas || []) if (filas.has(m.asiento)) filas.get(m.asiento).mostro = m.cartas;

  // Los asientos sin nombre no tienen perfil: no se guardan
  return [...filas.values()].filter((f) => f.jugadorId);
}
