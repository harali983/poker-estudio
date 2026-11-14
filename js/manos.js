// manos.js: guardar y leer las manos en la base de datos (almacén "manos").
// La lógica de la mano está en motor.js (acciones), final.js (reparto y fichas) y
// estadisticas.js (participaciones); aquí se juntan y se guardan.
//
// Una mano en curso es la que tiene final === null. Cada acción se guarda al momento
// (la mano entera, con su lista de eventos), sin esperas: ver la regla de guardado del plan.
// Lo que se elige en el showdown (ganadores y cartas mostradas) también se guarda al momento,
// en mano.cierre, hasta que "Siguiente mano" cierra la mano.

import { bd } from './db.js';
import { crearMano } from './motor.js';
import { calcularFinal, fichasDespues } from './final.js';
import { calcularParticipaciones } from './estadisticas.js';
import { siguienteBoton } from './posiciones.js';

/** La mano en curso de la partida (o null si está entre manos). */
export async function manoEnCurso(partidaId) {
  const manos = await bd.listar('manos', 'partidaId', partidaId);
  return manos.filter((m) => m.final === null).sort((a, b) => b.numero - a.numero)[0] || null;
}

/** Empieza una mano nueva (con las antes y las ciegas ya puestas) y la guarda. */
export async function empezarMano(partida) {
  const mano = crearMano(partida, {
    id: crypto.randomUUID(),
    numero: (partida.manosJugadas || 0) + 1,
    fecha: new Date().toISOString(),
  });
  await bd.guardar('manos', mano);
  return mano;
}

/**
 * ¿Hay que pedir tus cartas al empezar la mano? Solo si juegas esta mano (estás en la
 * foto de jugadores) y aún no están puestas. Si no juegas, no se pide nada.
 */
export function pedirMisCartas(mano) {
  return mano.jugadores.some((j) => j.jugadorId === 'yo') && !(mano.misCartas || []).length;
}

/** Guarda la mano tal y como está (después de cada acción o de Deshacer). */
export function guardarMano(mano) {
  return bd.guardar('manos', mano);
}

/**
 * Cierra la mano terminada (lógica pura, con tests):
 *  - apunta el final (ganadores, lo que se devuelve y las cartas mostradas),
 *  - actualiza las fichas de la partida (si se llevan), el botón avanza y se cuenta la mano,
 *  - calcula las participaciones de cada jugador.
 * cierre: lo elegido en el showdown { ganadores: [asientos], mostradas: [{ asiento, cartas }] }.
 */
export function cerrarMano(mano, partida, estado, cierre = mano.cierre || {}) {
  const final = calcularFinal(mano, estado, cierre);
  const { cierre: _borrador, ...sinBorrador } = mano;
  const cerrada = { ...sinBorrador, final };
  const asientos = fichasDespues(partida, mano, estado, final);
  return {
    mano: cerrada,
    partida: {
      ...partida,
      asientos,
      // El botón pasa al siguiente que jugaba esta mano. Si ese se ha quedado sin fichas,
      // calcularPosiciones lo salta en la mano siguiente (botonEfectivo).
      boton: siguienteBoton(partida.asientos, mano.boton),
      manosJugadas: (partida.manosJugadas || 0) + 1,
    },
    participaciones: calcularParticipaciones(cerrada),
  };
}

/**
 * Guarda la mano cerrada, sus participaciones y la partida actualizada a la vez (todo o nada).
 * Devuelve lo cerrado ({ mano, partida, participaciones }).
 */
export async function terminarMano(mano, partida, estado, cierre) {
  const cerrada = cerrarMano(mano, partida, estado, cierre);
  await bd.guardarJuntos({
    manos: [cerrada.mano],
    partidas: [cerrada.partida],
    participaciones: cerrada.participaciones,
  });
  return cerrada;
}
