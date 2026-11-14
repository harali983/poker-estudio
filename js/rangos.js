// rangos.js: manos de inicio y rangos (lógica pura, con tests en tests/tests.html).
//
// Las 1.326 manos de 2 cartas se agrupan en 169 CLASES:
//   - parejas: "AA", "77"…            (6 combinaciones cada una)
//   - del mismo palo: "AKs", "T9s"…   (4 combinaciones)
//   - de distinto palo: "AKo", "72o"… (12 combinaciones)
// Un RANGO es un conjunto de clases. Se escribe como en los libros:
//   "77+"      → 77, 88, 99, TT, JJ, QQ, KK, AA
//   "A9s+"     → A9s, ATs, AJs, AQs, AKs
//   "A2s-A5s"  → A2s, A3s, A4s, A5s
//   "99-22"    → de 22 a 99
//   "KQ"       → KQs y KQo;   "A2+" → A2s+ y A2o+
//
// ORDEN: las 169 clases de la más fuerte a la más débil (equidad contra una mano al azar,
// calculada una vez con el simulador de la app). top(0.15) = el 15 % mejor de las combinaciones.

import { VALORES, carta, valorDe, paloDe } from './cartas.js';

const LETRAS = 'AKQJT98765432'; // de mayor a menor
const valorDeLetra = (l) => VALORES.indexOf(l);       // '2' → 0 … 'A' → 12
const letra = (v) => VALORES[v];
export const TOTAL_COMBOS = 1326;

/** Clase de una mano: A♠ K♠ → "AKs"; A♠ K♦ → "AKo"; 7♣ 7♦ → "77". */
export function clase(c1, c2) {
  const v1 = valorDe(c1), v2 = valorDe(c2);
  const alta = Math.max(v1, v2), baja = Math.min(v1, v2);
  if (alta === baja) return letra(alta) + letra(baja);
  return letra(alta) + letra(baja) + (paloDe(c1) === paloDe(c2) ? 's' : 'o');
}

/** Combinaciones de una clase: 6, 4 o 12. */
export function numCombos(cl) {
  return cl.length === 2 ? 6 : (cl[2] === 's' ? 4 : 12);
}

/** Todas las combinaciones [c1, c2] de una clase. */
export function combosDe(cl) {
  const a = valorDeLetra(cl[0]), b = valorDeLetra(cl[1]);
  const r = [];
  for (let p1 = 0; p1 < 4; p1++) {
    for (let p2 = 0; p2 < 4; p2++) {
      if (cl.length === 2) { if (p2 > p1) r.push([carta(a, p1), carta(b, p2)]); }
      else if (cl[2] === 's') { if (p1 === p2) r.push([carta(a, p1), carta(b, p2)]); }
      else if (p1 !== p2) r.push([carta(a, p1), carta(b, p2)]);
    }
  }
  return r;
}

/** Las 169 clases. */
export const CLASES = (() => {
  const r = [];
  for (let i = 0; i < 13; i++) {
    for (let j = i; j < 13; j++) {
      if (i === j) r.push(LETRAS[i] + LETRAS[j]);
      else { r.push(LETRAS[i] + LETRAS[j] + 's'); r.push(LETRAS[i] + LETRAS[j] + 'o'); }
    }
  }
  return r;
})();

function noPareja(alta, baja, tipo) {
  return tipo ? [letra(alta) + letra(baja) + tipo] : [letra(alta) + letra(baja) + 's', letra(alta) + letra(baja) + 'o'];
}

/** Lee un rango escrito ("77+, A9s+, KTs+, AJo+, KQo") y devuelve un Set de clases. */
export function leerRango(texto) {
  const r = new Set();
  for (const bruto of texto.split(',')) {
    const t = bruto.trim().replace('–', '-');
    if (!t) continue;
    let m;
    if ((m = t.match(/^([2-9TJQKA])\1(\+)?$/))) {                       // 77, 77+
      const v = valorDeLetra(m[1]);
      for (let x = v; x <= (m[2] ? 12 : v); x++) r.add(letra(x) + letra(x));
    } else if ((m = t.match(/^([2-9TJQKA])\1-([2-9TJQKA])\2$/))) {      // 99-22
      const a = valorDeLetra(m[1]), b = valorDeLetra(m[2]);
      for (let x = Math.min(a, b); x <= Math.max(a, b); x++) r.add(letra(x) + letra(x));
    } else if ((m = t.match(/^([2-9TJQKA])([2-9TJQKA])([so])?(\+)?$/))) { // AKs, A9s+, KQ
      const alta = valorDeLetra(m[1]), baja = valorDeLetra(m[2]);
      if (baja >= alta) throw new Error('Rango no válido: ' + t);
      for (let x = baja; x <= (m[4] ? alta - 1 : baja); x++) noPareja(alta, x, m[3]).forEach((c) => r.add(c));
    } else if ((m = t.match(/^([2-9TJQKA])([2-9TJQKA])([so])?-([2-9TJQKA])([2-9TJQKA])([so])?$/)) && m[1] === m[4] && m[3] === m[6]) {
      const alta = valorDeLetra(m[1]);                                   // A2s-A5s, K2s-KJs
      const a = valorDeLetra(m[2]), b = valorDeLetra(m[5]);
      for (let x = Math.min(a, b); x <= Math.max(a, b); x++) noPareja(alta, x, m[3]).forEach((c) => r.add(c));
    } else {
      throw new Error('Rango no válido: ' + t);
    }
  }
  return r;
}

export const unir = (...rangos) => new Set(rangos.flatMap((x) => [...x]));
export const menos = (a, b) => new Set([...a].filter((c) => !b.has(c)));
export const contarCombos = (rango) => [...rango].reduce((s, c) => s + numCombos(c), 0);
/** Parte de todas las manos (0–1) que hay en el rango. */
export const porcentaje = (rango) => contarCombos(rango) / TOTAL_COMBOS;
/** Solo las parejas y las manos del mismo palo (las que juegan mejor contra varios rivales). */
export const parejasYMismoPalo = (rango) => new Set([...rango].filter((c) => c.length === 2 || c[2] === 's'));

/** Combinaciones del rango que no usan ninguna de las cartas muertas (bloqueadores). */
export function combosDeRango(rango, muertas = []) {
  const m = new Set(muertas);
  const r = [];
  for (const cl of rango) for (const [a, b] of combosDe(cl)) if (!m.has(a) && !m.has(b)) r.push([a, b]);
  return r;
}

/** Las 169 clases de la más fuerte a la más débil (equidad contra 1 mano al azar; AA 85 %, 32o 32 %). */
export const ORDEN = [
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', 'AKs', '77', 'AQs', 'AJs', 'AKo', 'ATs',
  'AQo', 'AJo', 'KQs', '66', 'A9s', 'KJs', 'ATo', 'A8s', 'KTs', 'KQo', 'A7s', 'KJo', 'A9o',
  'QJs', '55', 'A5s', 'A6s', 'K9s', 'KTo', 'QTs', 'A8o', 'A4s', 'A7o', 'K8s', 'A3s', 'A5o',
  'QJo', 'Q9s', 'K9o', 'A6o', 'K7s', 'JTs', 'A2s', 'QTo', '44', 'A4o', 'K6s', 'Q8s', 'K8o',
  'A3o', 'J9s', 'K5s', 'K7o', 'JTo', 'Q9o', 'K4s', 'A2o', 'Q7s', 'K6o', 'K3s', 'J8s', 'Q8o',
  'T9s', '33', 'Q6s', 'K5o', 'J9o', 'K2s', 'Q5s', 'T8s', 'K4o', 'J7s', 'Q4s', 'K3o', 'Q7o',
  'T9o', 'J8o', 'Q6o', 'Q3s', '98s', 'T7s', 'J6s', 'K2o', 'Q2s', '22', 'Q5o', 'J5s', 'J7o',
  'T8o', '97s', 'Q4o', 'J4s', 'T6s', 'J3s', 'Q3o', '98o', 'T7o', '87s', 'J6o', 'Q2o', '96s',
  'J5o', 'J2s', 'T5s', 'T4s', 'T6o', '86s', '97o', 'J4o', 'T3s', '95s', '87o', '76s', 'T2s',
  'J3o', '85s', 'J2o', '96o', 'T5o', '75s', 'T4o', '94s', '93s', '65s', '86o', '95o', '84s',
  'T3o', '76o', '92s', 'T2o', '74s', '54s', '85o', '64s', '83s', '75o', '94o', '82s', '73s',
  '93o', '63s', '53s', '65o', '84o', '92o', '43s', '74o', '72s', '64o', '54o', '62s', '52s',
  '83o', '82o', '73o', '42s', '53o', '63o', '32s', '43o', '52o', '72o', '62o', '42o', '32o',
];

/** El "top X %": las clases más fuertes hasta llegar a esa parte de las combinaciones. */
export function top(parte) {
  const objetivo = parte * TOTAL_COMBOS;
  const r = new Set();
  let n = 0;
  for (const cl of ORDEN) {
    if (n >= objetivo) break;
    r.add(cl);
    n += numCombos(cl);
  }
  return r;
}

export const TODAS = new Set(CLASES);
