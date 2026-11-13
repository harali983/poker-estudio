// app.js: arranque de la app. Une las piezas (selector, jugadores…) y registra el Service Worker.

import { crearSelector } from './selector.js';

// ---- 1. Aviso de "sin conexión" ----
const estadoRed = document.getElementById('estado-red');
function actualizarRed() {
  estadoRed.hidden = navigator.onLine; // solo se ve cuando NO hay internet
}
actualizarRed();
window.addEventListener('online', actualizarRed);
window.addEventListener('offline', actualizarRed);

// ---- 2. Service Worker (modo sin conexión) y aviso de versión nueva ----
if ('serviceWorker' in navigator) {
  // Si ya había un Service Worker controlando la página y cambia, es que llegó una versión nueva.
  // (La primera vez que se instala la app no había ninguno, y entonces no avisamos.)
  const habiaControlador = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (habiaControlador) document.getElementById('aviso-version').hidden = false;
  });

  navigator.serviceWorker.register('sw.js').catch((error) => {
    console.error('No se pudo registrar el Service Worker:', error);
  });
}
document.getElementById('btn-recargar').addEventListener('click', () => location.reload());

// ---- 3. Selector de cartas ----
const selector = crearSelector({
  alCambiar: recalcular, // cada vez que cambia una carta, se vuelve a calcular la equidad
});

// ---- 4. Número de jugadores (2 a 9: tú + rivales) ----
const MIN_JUGADORES = 2;
const MAX_JUGADORES = 9;
let jugadores = 2;

const textoJugadores = document.getElementById('num-jugadores');
const btnMenos = document.getElementById('btn-menos');
const btnMas = document.getElementById('btn-mas');

function cambiarJugadores(diferencia) {
  jugadores = Math.min(MAX_JUGADORES, Math.max(MIN_JUGADORES, jugadores + diferencia));
  textoJugadores.textContent = jugadores;
  btnMenos.disabled = jugadores === MIN_JUGADORES;
  btnMas.disabled = jugadores === MAX_JUGADORES;
}
btnMenos.addEventListener('click', () => { cambiarJugadores(-1); recalcular(); });
btnMas.addEventListener('click', () => { cambiarJugadores(+1); recalcular(); });
cambiarJugadores(0);

// ---- 5. Nueva mano: vaciar cartas y bote (el número de jugadores se mantiene) ----
document.getElementById('btn-nueva-mano').addEventListener('click', () => {
  selector.vaciar();
  document.getElementById('bote').value = '';
  document.getElementById('pagar').value = '';
});

// ---- 6. Cálculo de la equidad (en un Web Worker) ----
let worker = null;       // el worker que está calculando ahora (si hay)
let temporizador = null; // espera corta antes de empezar

// Esperamos 150 ms antes de calcular: si tocas varias cosas seguidas, solo se calcula una vez
function recalcular() {
  clearTimeout(temporizador);
  temporizador = setTimeout(lanzarCalculo, 150);
}

function lanzarCalculo() {
  // Cancelar el cálculo anterior: terminar el worker es la forma más sencilla y segura
  if (worker) {
    worker.terminate();
    worker = null;
  }

  const { mias, mesa } = selector.cartas();
  if (mias.length < 2) {
    document.getElementById('resultado-vacio').hidden = false;
    document.getElementById('resultado-datos').hidden = true;
    return;
  }

  // type: 'module' permite usar "import" dentro del worker
  worker = new Worker(new URL('./equidad.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (evento) => mostrarResultado(evento.data);
  worker.onerror = (error) => {
    console.error('Error en el cálculo de la equidad:', error);
    document.getElementById('manos-simuladas').textContent = 'Error en el cálculo ❌';
  };
  worker.postMessage({ mias, mesa, rivales: jugadores - 1 });

  document.getElementById('resultado-vacio').hidden = true;
  document.getElementById('resultado-datos').hidden = false;
  document.getElementById('barra-progreso').style.width = '0%';
  document.getElementById('manos-simuladas').textContent = 'Calculando…';
}

function mostrarResultado(r) {
  document.getElementById('equidad').textContent = 'Equidad ' + porcentaje(r.equidad);
  document.getElementById('margen').textContent = '±' + porcentaje(r.margen, false);
  document.getElementById('ganar').textContent = porcentaje(r.ganar);
  document.getElementById('empatar').textContent = porcentaje(r.empatar);
  document.getElementById('barra-progreso').style.width = Math.round(r.progreso * 100) + '%';
  document.getElementById('manos-simuladas').textContent =
    r.manos.toLocaleString('es-ES') + ' manos simuladas' + (r.terminado ? '' : '…');
}

// 0.634 → "63,4 %" (con coma decimal, como se escribe en español)
function porcentaje(x, conSimbolo = true) {
  const texto = (x * 100).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return conSimbolo ? texto + ' %' : texto;
}
