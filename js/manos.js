// manos.js: guardar y leer las manos en la base de datos (almacén "manos").
// La lógica de la mano está en motor.js; aquí solo se lee y se escribe.
//
// Una mano en curso es la que tiene final === null. Cada acción se guarda al momento
// (la mano entera, con su lista de eventos), sin esperas: ver la regla de guardado del plan.

import { bd } from './db.js';
import { crearMano } from './motor.js';
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

/** Guarda la mano tal y como está (después de cada acción o de Deshacer). */
export function guardarMano(mano) {
  return bd.guardar('manos', mano);
}

/**
 * Cierra la mano terminada (lógica pura, con tests): apunta el final y prepara la partida
 * para la siguiente mano (el botón avanza y se cuenta la mano).
 * Si todos se retiraron, el que queda se lleva el bote. En el showdown, los ganadores y el
 * reparto los elegirás en el paso 9; de momento quedan sin anotar.
 */
export function cerrarMano(mano, partida, estado) {
  const final = {
    motivo: estado.motivoFin,
    ganadores: estado.motivoFin === 'retirada' ? [{ asiento: estado.ganador, cantidad: estado.bote }] : [],
    mostradas: [],
  };
  return {
    mano: { ...mano, final },
    partida: {
      ...partida,
      boton: siguienteBoton(partida.asientos, mano.boton),
      manosJugadas: (partida.manosJugadas || 0) + 1,
    },
  };
}

/** Guarda la mano cerrada y la partida actualizada a la vez (todo o nada). Devuelve la partida. */
export async function terminarMano(mano, partida, estado) {
  const cerrada = cerrarMano(mano, partida, estado);
  await bd.guardarJuntos({ manos: [cerrada.mano], partidas: [cerrada.partida] });
  return cerrada.partida;
}
