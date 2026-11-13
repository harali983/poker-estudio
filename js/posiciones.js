// posiciones.js: posición de cada jugador (BTN, SB, BB, UTG…) según el botón y quién juega.
// Lógica pura (sin pantalla), con tests en tests/tests.html. Ver el plan, sección 2.2.
//
// Los asientos van numerados 0, 1, 2… en el sentido de las agujas del reloj: el siguiente
// asiento es el de la izquierda, que es el que habla después.
// Solo cuentan los asientos que juegan la mano (juega !== false).

/** Posiciones en el orden en que se habla antes del flop, según cuántos juegan. */
export const POSICIONES = {
  2: ['BTN/SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['UTG', 'BTN', 'SB', 'BB'],
  5: ['UTG', 'CO', 'BTN', 'SB', 'BB'],
  6: ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'],
  7: ['UTG', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};

/**
 * Grupo de cada posición (para las estadísticas: con pocas manos, cada posición suelta
 * tiene muy pocos datos). En el mano a mano, el botón cuenta como posición tardía:
 * pone la ciega pequeña, pero después del flop habla el último.
 */
export const GRUPOS = {
  'UTG': 'temprana',
  'UTG+1': 'temprana',
  'MP': 'media',
  'LJ': 'media',
  'HJ': 'media',
  'CO': 'tardía',
  'BTN': 'tardía',
  'BTN/SB': 'tardía',
  'SB': 'ciegas',
  'BB': 'ciegas',
};

/** Índices de los asientos que juegan, de menor a mayor. */
export function asientosQueJuegan(asientos) {
  return asientos.filter((a) => a.juega !== false).map((a) => a.asiento);
}

/**
 * El botón de verdad para esta mano: si el asiento del botón no juega, el botón pasa al
 * siguiente asiento que sí juega. null si no juega nadie.
 */
export function botonEfectivo(asientos, boton) {
  const n = asientos.length;
  for (let d = 0; d < n; d++) {
    const i = (boton + d) % n;
    if (asientos[i].juega !== false) return i;
  }
  return null;
}

/**
 * Calcula las posiciones de la mano. Devuelve null si juegan menos de 2.
 * {
 *   boton, sb, bb,               // asientos con el botón y las ciegas
 *   preflop:  [asientos],        // orden en que se habla antes del flop
 *   postflop: [asientos],        // orden después del flop (empieza el de la izquierda del botón)
 *   porAsiento: { [asiento]: { posicion: 'CO', grupo: 'tardía' } },
 * }
 */
export function calcularPosiciones(asientos, boton) {
  const juegan = asientosQueJuegan(asientos);
  const n = juegan.length;
  if (n < 2) return null;

  const btn = botonEfectivo(asientos, boton);
  const k = juegan.indexOf(btn);
  const desde = (d) => juegan[(k + d) % n]; // d asientos (que juegan) a la izquierda del botón

  const nombres = POSICIONES[n];
  // Antes del flop empieza el de la izquierda de la BB (3 a la izquierda del botón).
  // Mano a mano, el botón pone la ciega pequeña y habla primero.
  const inicio = n === 2 ? 0 : 3;
  const preflop = nombres.map((_, j) => desde(inicio + j));
  const postflop = juegan.map((_, j) => desde(1 + j)); // ...y el botón, el último

  const porAsiento = {};
  preflop.forEach((asiento, j) => {
    porAsiento[asiento] = { posicion: nombres[j], grupo: GRUPOS[nombres[j]] };
  });

  return {
    boton: btn,
    sb: n === 2 ? btn : desde(1),
    bb: n === 2 ? desde(1) : desde(2),
    preflop,
    postflop,
    porAsiento,
  };
}

/**
 * "Siguiente mano": el botón pasa al siguiente asiento que juega (a la izquierda).
 * Si nadie más juega, se queda donde está.
 */
export function siguienteBoton(asientos, boton) {
  const actual = botonEfectivo(asientos, boton);
  if (actual === null) return boton;
  const n = asientos.length;
  for (let d = 1; d <= n; d++) {
    const i = (actual + d) % n;
    if (asientos[i].juega !== false) return i;
  }
  return actual;
}
