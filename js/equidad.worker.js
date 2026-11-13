// equidad.worker.js: Web Worker que calcula la equidad en un hilo aparte.
// Así la pantalla sigue respondiendo mientras se simulan miles de manos.
//
// Recibe:  { mias, mesa, rivales }
// Envía (varias veces): { manos, ganar, empatar, equidad, margen, progreso, terminado }
// Para cancelar un cálculo, app.js termina el worker (worker.terminate()) y crea otro.

import { simular } from './equidad.js';

const MAX_MANOS = 50000;   // como mucho 50.000 manos…
const MAX_MS = 2000;       // …o 2 segundos, lo que llegue antes
const AVISO_MS = 200;      // enviar un resultado parcial cada 0,2 s
const TANDA = 1000;        // manos por tanda entre comprobación y comprobación

self.onmessage = (evento) => {
  const { mias, mesa, rivales } = evento.data;
  const total = { manos: 0, ganadas: 0, empatadas: 0, equidad: 0 };
  const inicio = performance.now();
  let ultimoAviso = inicio;

  for (;;) {
    const r = simular({ mias, mesa, rivales, iteraciones: TANDA });
    total.manos += r.manos;
    total.ganadas += r.ganadas;
    total.empatadas += r.empatadas;
    total.equidad += r.equidad;

    const ahora = performance.now();
    const terminado = total.manos >= MAX_MANOS || ahora - inicio >= MAX_MS;
    if (terminado || ahora - ultimoAviso >= AVISO_MS) {
      self.postMessage(resumen(total, Math.max(total.manos / MAX_MANOS, (ahora - inicio) / MAX_MS), terminado));
      ultimoAviso = ahora;
    }
    if (terminado) break;
  }
};

function resumen(total, progreso, terminado) {
  const equidad = total.equidad / total.manos;
  return {
    manos: total.manos,
    ganar: total.ganadas / total.manos,
    empatar: total.empatadas / total.manos,
    equidad,
    // Margen de error aproximado al 95 %: 1,96 × √(p·(1−p)/n)
    margen: 1.96 * Math.sqrt(equidad * (1 - equidad) / total.manos),
    progreso: Math.min(1, progreso),
    terminado,
  };
}
