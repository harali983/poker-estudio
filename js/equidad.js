// equidad.js: simulación Monte Carlo de la equidad.
//
// Idea: en vez de calcular todas las combinaciones posibles (demasiadas), jugamos muchas
// manos al azar con las cartas que faltan y contamos cuántas ganamos, empatamos o perdemos.
//
// Esta función no toca la pantalla: la usan el Web Worker (equidad.worker.js) y la página de tests.

import { evaluar } from './evaluador.js';

/**
 * Simula "iteraciones" manos.
 *  - mias: tus 2 cartas
 *  - mesa: de 0 a 5 cartas ya conocidas
 *  - rivales: número de rivales (1–8)
 *  - rivalesConocidos: (opcional, para los tests) manos fijas de algunos rivales, p. ej. [[KK]]
 * Devuelve { manos, ganadas, empatadas, perdidas, equidad } donde "equidad" es la suma de lo
 * que te llevas en cada mano: 1 si ganas, 1/2 si empatas con uno, 1/3 si empatas con dos…
 */
export function simular({ mias, mesa = [], rivales, iteraciones, rivalesConocidos = [] }) {
  // Cartas que quedan en la baraja (las 52 menos las que ya se ven)
  const vistas = new Set([...mias, ...mesa, ...rivalesConocidos.flat()]);
  const baraja = [];
  for (let c = 0; c < 52; c++) {
    if (!vistas.has(c)) baraja.push(c);
  }

  const aleatorios = rivales - rivalesConocidos.length; // rivales con cartas al azar
  const faltanMesa = 5 - mesa.length;
  const aRepartir = faltanMesa + 2 * aleatorios;

  // Manos de 7 cartas (2 propias + 5 de la mesa) que se rellenan en cada iteración
  const miMano = [mias[0], mias[1], ...mesa, ...new Array(faltanMesa).fill(0)];
  const manosRivales = [];
  for (let r = 0; r < rivales; r++) {
    const conocidas = rivalesConocidos[r] || [0, 0];
    manosRivales.push([conocidas[0], conocidas[1], ...mesa, ...new Array(faltanMesa).fill(0)]);
  }

  let ganadas = 0, empatadas = 0, perdidas = 0, equidad = 0;

  for (let it = 0; it < iteraciones; it++) {
    // Barajado parcial de Fisher–Yates: solo mezclamos las primeras "aRepartir" cartas
    for (let j = 0; j < aRepartir; j++) {
      const k = j + Math.floor(Math.random() * (baraja.length - j));
      const tmp = baraja[j];
      baraja[j] = baraja[k];
      baraja[k] = tmp;
    }

    // Repartir: primero lo que falta de la mesa (es común a todos)…
    for (let j = 0; j < faltanMesa; j++) {
      const c = baraja[j];
      miMano[2 + mesa.length + j] = c;
      for (let r = 0; r < rivales; r++) manosRivales[r][2 + mesa.length + j] = c;
    }
    // …y luego 2 cartas a cada rival sin mano conocida
    let siguiente = faltanMesa;
    for (let r = rivalesConocidos.length; r < rivales; r++) {
      manosRivales[r][0] = baraja[siguiente++];
      manosRivales[r][1] = baraja[siguiente++];
    }

    // ¿Quién gana?
    const mia = evaluar(miMano);
    let mejorRival = -1;
    let empatadosConmigo = 0;
    for (let r = 0; r < rivales; r++) {
      const suya = evaluar(manosRivales[r]);
      if (suya > mejorRival) mejorRival = suya;
      if (suya === mia) empatadosConmigo++;
    }

    if (mia > mejorRival) {
      ganadas++;
      equidad += 1;
    } else if (mia === mejorRival) {
      empatadas++;
      equidad += 1 / (empatadosConmigo + 1); // el bote se reparte entre los empatados
    } else {
      perdidas++;
    }
  }

  return { manos: iteraciones, ganadas, empatadas, perdidas, equidad };
}
