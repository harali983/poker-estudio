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
  alCambiar(cartas) {
    // Paso 4: aquí se lanzará el cálculo de la equidad
    console.log('Cartas:', cartas);
  },
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
btnMenos.addEventListener('click', () => cambiarJugadores(-1));
btnMas.addEventListener('click', () => cambiarJugadores(+1));
cambiarJugadores(0);

// ---- 5. Nueva mano: vaciar cartas y bote (el número de jugadores se mantiene) ----
document.getElementById('btn-nueva-mano').addEventListener('click', () => {
  selector.vaciar();
  document.getElementById('bote').value = '';
  document.getElementById('pagar').value = '';
});
