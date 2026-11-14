// sw.js: Service Worker. Funciona "por detrás" de la página y permite usar la app sin internet.
//
// Cómo funciona:
//  1. "install": la primera vez, descarga y guarda en una caché todos los archivos de la app.
//  2. "activate": borra las cachés de versiones antiguas.
//  3. "fetch": cada vez que la app pide un archivo, se lo da desde la caché (rápido y sin red).
//
// IMPORTANTE: cada vez que cambies cualquier archivo de la app, sube el número de VERSION.
// Así el iPhone sabe que hay una versión nueva y la descarga.

const VERSION = 'v0.2.18';
const CACHE = 'poker-estudio-' + VERSION;

// Lista de archivos que se guardan para usar sin conexión.
// ¡Cada archivo .js nuevo tiene que estar aquí! Si no, la app falla en modo avión.
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.json',
  './css/estilos.css',
  './js/app.js',
  './js/pantalla-calculadora.js',
  './js/pantalla-ajustes.js',
  './js/ajustes.js',
  './js/db.js',
  './js/avisos.js',
  './js/mesa.js',
  './js/posiciones.js',
  './js/motor.js',
  './js/manos.js',
  './js/final.js',
  './js/estadisticas.js',
  './js/describir.js',
  './js/recomendacion.js',
  './js/rangos.js',
  './js/preflop.js',
  './js/teclado.js',
  './js/hoja-cartas.js',
  './js/pantalla-mano.js',
  './js/partidas.js',
  './js/pantalla-inicio.js',
  './js/pantalla-mesa.js',
  './js/cartas.js',
  './js/selector.js',
  './js/evaluador.js',
  './js/equidad.js',
  './js/equidad.worker.js',
  './js/numeros.js',
  './icons/icon-180.png',
  './icons/icon-192.png',   // también se usa como favicon
  './icons/icon-512.png',
];

// 1. Instalación: guardar los archivos
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' = descargar de internet sí o sí, sin usar la caché normal del navegador
      // (GitHub Pages la guarda 10 minutos y podríamos meter archivos viejos en la versión nueva)
      .then((cache) => cache.addAll(ARCHIVOS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())  // activar la versión nueva sin esperar
  );
});

// 2. Activación: borrar cachés viejas
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(
        nombres
          .filter((nombre) => nombre !== CACHE)
          .map((nombre) => caches.delete(nombre))
      ))
      .then(() => self.clients.claim())
  );
});

// 3. Peticiones: primero la caché; si no está, ir a internet
self.addEventListener('fetch', (evento) => {
  if (evento.request.method !== 'GET') return;
  evento.respondWith(
    caches.match(evento.request, { ignoreSearch: true })
      .then((respuesta) => respuesta || fetch(evento.request))
  );
});
