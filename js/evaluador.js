// evaluador.js: ¿qué mano gana?
//
// evaluar(cartas) recibe de 5 a 7 cartas (números 0–51, ver cartas.js) y devuelve una
// PUNTUACIÓN: cuanto más alta, mejor es la mejor mano de 5 cartas que se puede formar.
// Dos manos con la misma puntuación empatan.
//
// La puntuación se construye como un número en base 16 de 6 cifras:
//   [categoría][desempate 1][desempate 2][desempate 3][desempate 4][desempate 5]
// Ejemplo: pareja de ases con K, 9, 4 → categoría 1, desempates A, K, 9, 4.
// Como la categoría es la cifra de más peso, un trío siempre gana a una doble pareja, etc.

export const CATEGORIAS = [
  'Carta alta', 'Pareja', 'Doble pareja', 'Trío', 'Escalera',
  'Color', 'Full', 'Póker', 'Escalera de color',
];

const BASE = 16 ** 5; // peso de la categoría

/** Devuelve la categoría (0–8) de una puntuación. CATEGORIAS[categoria(p)] da su nombre. */
export function categoria(puntuacion) {
  return Math.floor(puntuacion / BASE);
}

// Tablas de trabajo reutilizadas en cada llamada (crear tablas nuevas cada vez sería más lento:
// la simulación llama a evaluar() cientos de miles de veces)
const cuentaValores = new Uint8Array(13); // cuántas cartas hay de cada valor
const cuentaPalos = new Uint8Array(4);    // cuántas cartas hay de cada palo
const valoresPorPalo = new Uint16Array(4); // "máscara de bits": bit v encendido = hay una carta de valor v en ese palo

export function evaluar(cartas) {
  cuentaValores.fill(0);
  cuentaPalos.fill(0);
  valoresPorPalo.fill(0);
  let valores = 0; // máscara de bits con todos los valores presentes

  for (let i = 0; i < cartas.length; i++) {
    const v = cartas[i] >> 2;
    const p = cartas[i] & 3;
    cuentaValores[v]++;
    cuentaPalos[p]++;
    valoresPorPalo[p] |= 1 << v;
    valores |= 1 << v;
  }

  // ---- Color y escalera de color ----
  let paloColor = -1;
  for (let p = 0; p < 4; p++) {
    if (cuentaPalos[p] >= 5) paloColor = p;
  }
  if (paloColor >= 0) {
    const alta = escaleraMasAlta(valoresPorPalo[paloColor]);
    if (alta >= 0) return puntuar(8, [alta]);
  }

  // ---- Grupos: póker, tríos y parejas (recorriendo de la A al 2) ----
  let poker = -1;
  let trio1 = -1, trio2 = -1;
  let pareja1 = -1, pareja2 = -1;
  for (let v = 12; v >= 0; v--) {
    const n = cuentaValores[v];
    if (n === 4) poker = v;
    else if (n === 3) { if (trio1 < 0) trio1 = v; else if (trio2 < 0) trio2 = v; }
    else if (n === 2) { if (pareja1 < 0) pareja1 = v; else if (pareja2 < 0) pareja2 = v; }
  }

  if (poker >= 0) {
    return puntuar(7, [poker, ...mayores(sin(valores, poker), 1)]);
  }
  if (trio1 >= 0 && (trio2 >= 0 || pareja1 >= 0)) {
    // Full: el trío más alto + la mejor pareja (que puede salir de un segundo trío)
    return puntuar(6, [trio1, Math.max(trio2, pareja1)]);
  }
  if (paloColor >= 0) {
    return puntuar(5, mayores(valoresPorPalo[paloColor], 5));
  }
  const alta = escaleraMasAlta(valores);
  if (alta >= 0) {
    return puntuar(4, [alta]);
  }
  if (trio1 >= 0) {
    return puntuar(3, [trio1, ...mayores(sin(valores, trio1), 2)]);
  }
  if (pareja2 >= 0) {
    // Doble pareja: las dos más altas; el kicker puede ser una tercera pareja
    return puntuar(2, [pareja1, pareja2, ...mayores(sin(sin(valores, pareja1), pareja2), 1)]);
  }
  if (pareja1 >= 0) {
    return puntuar(1, [pareja1, ...mayores(sin(valores, pareja1), 3)]);
  }
  return puntuar(0, mayores(valores, 5));
}

// Valor más alto de una escalera dentro de la máscara, o -1 si no hay.
// 0x1F = 5 bits seguidos encendidos (cinco valores consecutivos).
function escaleraMasAlta(mascara) {
  for (let alta = 12; alta >= 4; alta--) {
    const cinco = 0x1F << (alta - 4);
    if ((mascara & cinco) === cinco) return alta;
  }
  // A-2-3-4-5 (la "rueda"): el as cuenta como 1. 0x100F = bits del 2, 3, 4, 5 y del as.
  if ((mascara & 0x100F) === 0x100F) return 3; // la carta más alta es el 5
  return -1;
}

// Los "cuantos" valores más altos de la máscara, de mayor a menor
function mayores(mascara, cuantos) {
  const lista = [];
  for (let v = 12; v >= 0 && lista.length < cuantos; v--) {
    if (mascara & (1 << v)) lista.push(v);
  }
  return lista;
}

// La máscara sin el valor v
function sin(mascara, v) {
  return mascara & ~(1 << v);
}

// Junta categoría y desempates en un solo número (base 16)
function puntuar(cat, desempates) {
  let p = cat;
  for (let i = 0; i < 5; i++) {
    p = p * 16 + (i < desempates.length ? desempates[i] : 0);
  }
  return p;
}
