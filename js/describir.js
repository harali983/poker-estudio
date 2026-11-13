// describir.js: "¿qué mano tengo?" en palabras (lógica pura, con tests en tests/tests.html).
//
// describirMano(mias, mesa) devuelve la mano hecha y los proyectos:
//   - Mano hecha (con evaluar()): "Pareja de J (de la mesa) con A", "Doble pareja, K y 7
//     (la de 7 es de la mesa)", "Trío de 7 (set: pareja en mano)", "Color al A"…
//     Se dice qué parte es de la mesa, porque una pareja de la mesa la tienen todos.
//   - Proyectos (solo en el flop y el turn): color y escalera, con sus OUTS (cartas que la
//     completan) y la probabilidad de ligarla. Solo cuentan si usan alguna de tus cartas:
//     un proyecto que está entero en la mesa también lo tienen los demás.
//
// Los outs no se cuentan dos veces: en un proyecto de color + escalera abierta, las 2 cartas
// que completan las dos cosas cuentan una vez (9 + 8 − 2 = 15 outs).

import { evaluar, categoria, escaleraMasAlta, CATEGORIAS } from './evaluador.js';
import { VALORES_TEXTO, valorDe, paloDe } from './cartas.js';

const V = (v) => VALORES_TEXTO[v];
const AS = 12;

/** Los 5 desempates de una puntuación (ver evaluador.js), de más a menos peso. */
function desempates(puntuacion) {
  const d = [];
  let p = puntuacion;
  for (let i = 0; i < 5; i++) { d.unshift(p % 16); p = Math.floor(p / 16); }
  return d;
}

function mascaraDeValores(cartas) {
  let m = 0;
  for (const c of cartas) m |= 1 << valorDe(c);
  return m;
}

/**
 * Describe tu mano. mias: tus 2 cartas; mesa: 0 a 5 cartas.
 * Devuelve null si no tienes las 2 cartas. Con 1 o 2 cartas en la mesa (todavía eligiendo
 * el flop) se describe como antes del flop.
 * {
 *   categoria (0–8, ver CATEGORIAS), nombre ('Pareja'…), texto ('Pareja de J (de la mesa) con A'),
 *   deLaMesa (true si juegas la mesa: tus cartas no cuentan),
 *   proyectos: [{ tipo: 'color' | 'escalera-abierta' | 'escalera-doble-interna' | 'escalera-interna', texto, outs }],
 *   outs (sin repetir), cartasOut, probabilidad (0–1, de ligar alguno hasta el river), textoProyectos
 * }
 */
export function describirMano(mias, mesa = []) {
  if (!mias || mias.length !== 2) return null;
  if (mesa.length < 3) return describirPreflop(mias);

  const todas = [...mias, ...mesa];
  const puntuacion = evaluar(todas);
  const cat = categoria(puntuacion);
  const d = desempates(puntuacion);
  const deLaMesa = mesa.length === 5 && evaluar(mesa) === puntuacion;
  const texto = deLaMesa ? textoBase(cat, d) + ' (todo de la mesa)' : textoHecha(cat, d, mias, mesa);
  return { categoria: cat, nombre: CATEGORIAS[cat], texto, deLaMesa, ...proyectos(mias, mesa, cat) };
}

function describirPreflop(mias) {
  const [a, b] = [...mias].sort((x, y) => valorDe(y) - valorDe(x));
  const va = valorDe(a), vb = valorDe(b);
  const par = va === vb;
  const texto = par ? `Pareja de ${V(va)} en mano`
    : `${V(va)} y ${V(vb)} ${paloDe(a) === paloDe(b) ? 'del mismo palo' : 'de distinto palo'}`;
  return { categoria: par ? 1 : 0, nombre: CATEGORIAS[par ? 1 : 0], texto, deLaMesa: false, ...sinProyectos() };
}

// Nombre de la jugada, sin decir de quién son las cartas
function textoBase(cat, d) {
  switch (cat) {
    case 0: return `Carta alta, ${V(d[0])}`;
    case 1: return `Pareja de ${V(d[0])}`;
    case 2: return `Doble pareja, ${V(d[0])} y ${V(d[1])}`;
    case 3: return `Trío de ${V(d[0])}`;
    case 4: return `Escalera al ${V(d[0])}`;
    case 5: return `Color al ${V(d[0])}`;
    case 6: return `Full de ${V(d[0])} con ${V(d[1])}`;
    case 7: return `Póker de ${V(d[0])}`;
    default: return d[0] === AS ? 'Escalera de color real' : `Escalera de color al ${V(d[0])}`;
  }
}

// La jugada, diciendo qué parte es tuya y qué parte de la mesa
function textoHecha(cat, d, mias, mesa) {
  const enMano = (v) => mias.filter((c) => valorDe(c) === v).length;
  const maxMesa = Math.max(...mesa.map(valorDe));
  // Tu acompañante (kicker), solo si es el mejor: "con A". Si el mejor es de la mesa, no se dice
  const kicker = (desde, grupo) => {
    const k = d[desde];
    const mio = mias.some((c) => valorDe(c) === k && !grupo.includes(k));
    return mio ? ` con ${V(k)}` : '';
  };
  const base = textoBase(cat, d);
  if (cat === 1) {
    const v = d[0];
    if (enMano(v) === 2) return `${base} en mano` + (v > maxMesa ? ' (por encima de la mesa)' : '');
    if (enMano(v) === 1) return base + (v === maxMesa ? ' (la más alta de la mesa)' : '') + kicker(1, [v]);
    return `${base} (de la mesa)` + kicker(1, [v]);
  }
  if (cat === 2) {
    const deMesa = [d[0], d[1]].filter((v) => enMano(v) === 0);
    if (deMesa.length === 2) return `${base} (las dos de la mesa)` + kicker(2, [d[0], d[1]]);
    if (deMesa.length === 1) return `${base} (la de ${V(deMesa[0])} es de la mesa)`;
    return base;
  }
  if (cat === 3) {
    const v = d[0];
    if (enMano(v) === 2) return `${base} (set: pareja en mano)`;
    if (enMano(v) === 1) return base + kicker(1, [v]);
    return `${base} (de la mesa)` + kicker(1, [v]);
  }
  if (cat === 7 && enMano(d[0]) === 0) return `${base} (de la mesa)` + kicker(1, [d[0]]);
  return base;
}

function sinProyectos() {
  return { proyectos: [], outs: 0, cartasOut: [], probabilidad: 0, textoProyectos: '' };
}

// Proyectos de color y de escalera, con sus outs
function proyectos(mias, mesa, cat) {
  if (mesa.length !== 3 && mesa.length !== 4) return sinProyectos();
  const conocidas = new Set([...mias, ...mesa]);
  const desconocidas = [];
  for (let c = 0; c < 52; c++) if (!conocidas.has(c)) desconocidas.push(c);
  const todas = [...mias, ...mesa];
  const lista = [];

  // Color: 4 cartas del mismo palo, alguna tuya
  if (cat < 5) {
    for (let p = 0; p < 4; p++) {
      const n = todas.filter((c) => paloDe(c) === p).length;
      const mio = mias.filter((c) => paloDe(c) === p).length;
      if (n === 4 && mio >= 1) {
        const cartas = desconocidas.filter((c) => paloDe(c) === p);
        lista.push({ tipo: 'color', texto: mio === 1 ? 'Proyecto de color (con una sola carta tuya)' : 'Proyecto de color', cartas });
      }
    }
  }

  // Escalera: valores que la completan, y que no la completarían solo con la mesa
  if (cat < 4) {
    const mTodas = mascaraDeValores(todas);
    const mMesa = mascaraDeValores(mesa);
    const valores = [];
    for (let r = 0; r < 13; r++) {
      const alta = escaleraMasAlta(mTodas | (1 << r));
      if (alta < 0 || escaleraMasAlta(mMesa | (1 << r)) >= alta) continue;
      if (desconocidas.some((c) => valorDe(c) === r)) valores.push(r);
    }
    if (valores.length) {
      const cartas = desconocidas.filter((c) => valores.includes(valorDe(c)));
      const tipo = valores.length === 1 ? 'escalera-interna'
        : (esAbierta(valores, mTodas) ? 'escalera-abierta' : 'escalera-doble-interna');
      const texto = { 'escalera-interna': 'Escalera interna', 'escalera-abierta': 'Escalera abierta',
        'escalera-doble-interna': 'Doble escalera interna' }[tipo];
      lista.push({ tipo, texto, cartas });
    }
  }

  if (!lista.length) return sinProyectos();
  const union = [...new Set(lista.flatMap((x) => x.cartas))].sort((a, b) => a - b);
  const u = desconocidas.length;
  const o = union.length;
  // Hasta el river: con 2 cartas por salir (flop), 1 − P(ninguna de las 2 es out); con 1 (turn), o / u
  const probabilidad = mesa.length === 3 ? 1 - ((u - o) * (u - o - 1)) / (u * (u - 1)) : o / u;
  const cuando = mesa.length === 3 ? 'hasta el river' : 'en el river';
  const textoProyectos = lista.map((x) => x.texto).join(' + ')
    + ` (${o} outs: ${Math.round(probabilidad * 100)} % ${cuando})`;
  return {
    proyectos: lista.map((x) => ({ tipo: x.tipo, texto: x.texto, outs: x.cartas.length })),
    outs: o,
    cartasOut: union,
    probabilidad,
    textoProyectos,
  };
}

// Escalera abierta: 4 valores seguidos y se completa por los dos lados (el as cuenta abajo en A-2-3-4-5)
function esAbierta(valores, mascara) {
  const seguidas = (desde) => [0, 1, 2, 3].every((k) => mascara & (1 << (desde + k)));
  for (const r of valores) {
    if (valores.includes(r + 5) && seguidas(r + 1)) return true;
  }
  // 2-3-4-5 se completa con el A o con el 6
  return valores.includes(AS) && valores.includes(4) && seguidas(0);
}

/** Texto corto para la pantalla: la mano hecha y, si hay, los proyectos. */
export function textoMano(desc) {
  if (!desc) return '';
  return desc.texto + (desc.textoProyectos ? ' · ' + desc.textoProyectos : '');
}
