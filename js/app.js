// app.js: arranque de la app. Registra el Service Worker y cambia de pantalla.
//
// Navegación: cada pantalla es una <section class="pantalla" id="pantalla-…"> en index.html.
// La pantalla visible depende del final de la dirección (el "hash"): #inicio, #calculadora…
// Así los botones son enlaces normales (<a href="#calculadora">) y no hace falta nada más.

import { iniciarCalculadora } from './pantalla-calculadora.js';

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

// ---- 3. Navegación entre pantallas ----
const PANTALLAS = ['inicio', 'jugar', 'manos', 'calculadora', 'ajustes'];

// Cada pantalla con lógica se prepara la primera vez que se abre.
// Lo que devuelve (p. ej. { alSalir }) se guarda aquí.
const preparadas = {};
const INICIAR = {
  calculadora: iniciarCalculadora,
};

let actual = null;

function mostrarPantalla() {
  let nombre = location.hash.slice(1) || 'inicio';
  if (!PANTALLAS.includes(nombre)) nombre = 'inicio'; // dirección desconocida → inicio

  if (nombre === actual) return;
  if (actual && preparadas[actual] && preparadas[actual].alSalir) preparadas[actual].alSalir();

  for (const p of PANTALLAS) {
    document.getElementById('pantalla-' + p).hidden = p !== nombre;
  }
  if (INICIAR[nombre] && !preparadas[nombre]) {
    preparadas[nombre] = INICIAR[nombre]();
  }

  actual = nombre;
  window.scrollTo(0, 0); // cada pantalla empieza arriba
}

window.addEventListener('hashchange', mostrarPantalla);
mostrarPantalla();
