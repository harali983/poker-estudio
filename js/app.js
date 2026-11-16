// app.js: arranque de la app. Registra el Service Worker y cambia de pantalla.
//
// Navegación: cada pantalla es una <section class="pantalla" id="pantalla-…"> en index.html.
// La pantalla visible depende del final de la dirección (el "hash"): #inicio, #calculadora…
// Así los botones son enlaces normales (<a href="#calculadora">) y no hace falta nada más.

import { iniciarCalculadora } from './pantalla-calculadora.js';
import { iniciarAjustes } from './pantalla-ajustes.js';
import { iniciarInicio } from './pantalla-inicio.js';
import { iniciarMesa } from './pantalla-mesa.js';
import { iniciarMano } from './pantalla-mano.js';
import { iniciarManos } from './pantalla-manos.js';
import { iniciarVerMano } from './pantalla-ver-mano.js';
import { bd, pedirPersistencia } from './db.js';
import { mostrarError } from './avisos.js';

// ---- 0. Errores de la base de datos: que nunca fallen en silencio ----
// Si una operación de guardar o leer falla y nadie lo gestiona, aquí se enseña el mensaje.
window.addEventListener('unhandledrejection', (evento) => {
  const motivo = evento.reason;
  if (motivo && motivo.name === 'ErrorBD') {
    evento.preventDefault();
    mostrarError(motivo.message);
  }
});

// Abrir la base de datos al arrancar y pedir almacenamiento persistente
// (para que Safari no borre los datos por su cuenta). El estado se ve en Ajustes.
bd.abrir()
  .then(() => pedirPersistencia())
  .then((estado) => console.info('Almacenamiento persistente:', estado))
  .catch((error) => mostrarError(error.message));

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
// La altura de cada pantalla la decide la app (abajo), no el navegador: si no, al volver con
// "atrás" el navegador recoloca la lista de Mis manos antes de que esté pintada.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const PANTALLAS = ['inicio', 'jugar', 'mano', 'manos', 'ver-mano', 'calculadora', 'ajustes'];

// Cada pantalla con lógica se prepara la primera vez que se abre.
// Lo que devuelve ({ alEntrar, alSalir }, ambos opcionales) se guarda aquí.
const preparadas = {};
const INICIAR = {
  inicio: iniciarInicio,
  jugar: iniciarMesa,
  mano: iniciarMano,
  manos: iniciarManos,
  'ver-mano': iniciarVerMano,
  calculadora: iniciarCalculadora,
  ajustes: iniciarAjustes,
};

let actual = null;
let parametroActual = null;
let alturaDeLaLista = 0; // por dónde ibas en Mis manos al abrir una mano (para volver al mismo sitio)

// La dirección puede llevar un dato detrás de una barra: "#ver-mano/<id de la mano>".
// Ese dato se le pasa a alEntrar() de la pantalla, junto con la pantalla de la que se viene.
function mostrarPantalla() {
  const [pedida, ...resto] = (location.hash.slice(1) || 'inicio').split('/');
  const nombre = PANTALLAS.includes(pedida) ? pedida : 'inicio'; // dirección desconocida → inicio
  let parametro = null;
  if (nombre === pedida && resto.length) {
    try { parametro = decodeURIComponent(resto.join('/')); } catch { parametro = resto.join('/'); }
  }

  if (nombre === actual && parametro === parametroActual) return;
  if (actual && preparadas[actual] && preparadas[actual].alSalir) preparadas[actual].alSalir();
  if (actual === 'manos' && nombre === 'ver-mano') alturaDeLaLista = window.scrollY;
  // Al volver de la ficha a la lista, se vuelve a la altura donde estabas
  const altura = actual === 'ver-mano' && nombre === 'manos' ? alturaDeLaLista : 0;

  for (const p of PANTALLAS) {
    document.getElementById('pantalla-' + p).hidden = p !== nombre;
  }
  if (INICIAR[nombre] && !preparadas[nombre]) {
    preparadas[nombre] = INICIAR[nombre]();
  }
  const listo = preparadas[nombre] && preparadas[nombre].alEntrar ? preparadas[nombre].alEntrar(parametro, { desde: actual }) : null;

  actual = nombre;
  parametroActual = parametro;
  window.scrollTo(0, 0); // cada pantalla empieza arriba
  if (altura) {
    // La lista se pinta después de leer la base de datos: se espera a que esté
    Promise.resolve(listo).then(() => { if (actual === nombre) window.scrollTo(0, altura); }, () => {});
  }
}

window.addEventListener('hashchange', mostrarPantalla);
mostrarPantalla();

// ---- 4. Guardar lo pendiente antes de que iOS congele o cierre la app ----
// "visibilitychange" (oculta): cambias de app, bloqueas el iPhone o vas a la pantalla de inicio.
// "pagehide": la página se cierra o se descarga. Después de esto, iOS puede cerrar la app
// sin avisar, así que cualquier guardado que estuviera esperando se hace ya.
function guardarTodoLoPendiente() {
  for (const pantalla of Object.values(preparadas)) {
    if (pantalla && pantalla.guardarYa) pantalla.guardarYa();
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') guardarTodoLoPendiente();
});
window.addEventListener('pagehide', guardarTodoLoPendiente);
