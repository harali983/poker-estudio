// hoja-cartas.js: la hoja inferior para elegir UNA carta con dos toques (valor y palo, en
// cualquier orden). La usan la calculadora (selector.js) y la pantalla de la mano.
//
// La hoja no sabe nada de huecos ni de calles: quien la usa decide qué se está eligiendo
// (el título), qué cartas no se pueden repetir (usadas) y qué hacer con cada carta elegida
// (alElegir). Así cada pantalla pone sus propias reglas.
//
// Uso:
//   const hoja = crearHojaCartas(elemento, { noCerrarEn: '.hueco' });
//   hoja.abrir({
//     titulo: 'Flop · 1ª carta',
//     usadas: new Set([48, 45]),
//     botones: [{ texto: 'Listo', acento: true, alTocar: () => hoja.cerrar() }],
//     alElegir(carta) { … },   // puede llamar a hoja.actualizar({...}) para seguir, o a hoja.cerrar()
//     alCerrar() { … },        // opcional: se ha cerrado (Listo, tocar fuera, cerrar())
//   });

import { VALORES_TEXTO, SIMBOLOS, NOMBRES_PALOS, carta } from './cartas.js';

// Orden de los botones de valores: de la A al 2
const ORDEN_VALORES = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

/**
 * Crea la hoja dentro del elemento dado (vacío en index.html).
 * noCerrarEn: selector CSS de lo que se puede tocar fuera de la hoja sin que se cierre
 * (p. ej. los huecos de cartas, que la cambian de hueco en vez de cerrarla).
 */
export function crearHojaCartas(raiz, { noCerrarEn = null } = {}) {
  raiz.classList.add('hoja');
  raiz.setAttribute('aria-hidden', 'true');

  const cabecera = elemento('div', 'hoja-cabecera', raiz);
  const titulo = elemento('span', 'hoja-titulo', cabecera);
  const zonaBotones = elemento('div', 'hoja-botones', cabecera);
  const rejilla = elemento('div', 'rejilla-valores', raiz);
  const filaPalos = elemento('div', 'fila-palos', raiz);

  let actual = null;        // opciones de lo que se está eligiendo (null = cerrada)
  let valorElegido = null;  // primer toque pendiente de completar…
  let paloElegido = null;   // …con el segundo

  const botonesValores = [];
  for (const v of ORDEN_VALORES) {
    const b = boton('boton tecla', VALORES_TEXTO[v], () => elegirValor(v), rejilla);
    botonesValores[v] = b;
  }
  const botonesPalos = [0, 1, 2, 3].map((p) => {
    const b = boton('boton tecla tecla-palo palo-' + p, SIMBOLOS[p], () => elegirPalo(p), filaPalos);
    b.setAttribute('aria-label', NOMBRES_PALOS[p]);
    return b;
  });

  // Tocar fuera de la hoja la cierra ("pointerdown": Safari no lanza "click" en zonas no pulsables)
  document.addEventListener('pointerdown', (evento) => {
    if (!actual || raiz.contains(evento.target)) return;
    if (noCerrarEn && evento.target.closest(noCerrarEn)) return;
    cerrar();
  });

  function elegirValor(v) {
    valorElegido = valorElegido === v ? null : v; // tocarlo otra vez lo desmarca
    intentarColocar();
  }

  function elegirPalo(p) {
    paloElegido = paloElegido === p ? null : p;
    intentarColocar();
  }

  function intentarColocar() {
    if (actual && valorElegido !== null && paloElegido !== null) {
      const c = carta(valorElegido, paloElegido);
      valorElegido = paloElegido = null;
      actual.alElegir(c); // quien usa la hoja decide: seguir (actualizar) o cerrar
    }
    pintar();
  }

  function abrir(opciones) {
    actual = { usadas: new Set(), botones: [], ...opciones };
    valorElegido = paloElegido = null;
    pintarBotones();
    pintar();
  }

  /** Cambia lo que se está eligiendo sin cerrar la hoja (p. ej. pasar a la siguiente carta). */
  function actualizar(cambios) {
    if (!actual) return;
    Object.assign(actual, cambios);
    valorElegido = paloElegido = null;
    pintarBotones();
    pintar();
  }

  function cerrar() {
    if (!actual) return;
    const anterior = actual;
    actual = null;
    valorElegido = paloElegido = null;
    pintar();
    if (anterior.alCerrar) anterior.alCerrar();
  }

  function pintarBotones() {
    zonaBotones.innerHTML = '';
    for (const b of actual.botones) {
      const el = boton('boton boton-pequeno' + (b.acento ? ' boton-acento' : ''), b.texto, b.alTocar, zonaBotones);
      el.disabled = Boolean(b.desactivado);
    }
  }

  function pintar() {
    const abierta = Boolean(actual);
    raiz.classList.toggle('abierta', abierta);
    raiz.setAttribute('aria-hidden', String(!abierta));
    document.body.classList.toggle('hoja-abierta', abierta);
    if (!abierta) return;

    // Título con lo elegido hasta ahora, p. ej. "Flop · 2ª carta — A?"
    let texto = actual.titulo;
    if (valorElegido !== null || paloElegido !== null) {
      texto += ' — ' + (valorElegido !== null ? VALORES_TEXTO[valorElegido] : '?') +
                       (paloElegido !== null ? SIMBOLOS[paloElegido] : '?');
    }
    titulo.textContent = texto;

    // Las cartas usadas salen desactivadas: no se pueden repetir
    const usadas = actual.usadas;
    for (let v = 0; v < 13; v++) {
      botonesValores[v].disabled = paloElegido !== null
        ? usadas.has(carta(v, paloElegido))
        : [0, 1, 2, 3].every((p) => usadas.has(carta(v, p)));
      botonesValores[v].classList.toggle('elegido', v === valorElegido);
    }
    for (let p = 0; p < 4; p++) {
      botonesPalos[p].disabled = valorElegido !== null
        ? usadas.has(carta(valorElegido, p))
        : VALORES_TEXTO.every((_, v) => usadas.has(carta(v, p)));
      botonesPalos[p].classList.toggle('elegido', p === paloElegido);
    }
  }

  return {
    abrir,
    actualizar,
    cerrar,
    estaAbierta: () => Boolean(actual),
    alto: () => raiz.offsetHeight,
  };
}

function elemento(etiqueta, clase, padre) {
  const el = document.createElement(etiqueta);
  el.className = clase;
  padre.appendChild(el);
  return el;
}

function boton(clase, texto, alTocar, padre) {
  const b = elemento('button', clase, padre);
  b.type = 'button';
  b.textContent = texto;
  b.addEventListener('click', alTocar);
  return b;
}
