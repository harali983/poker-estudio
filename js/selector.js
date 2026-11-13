// selector.js: selector táctil de cartas de la calculadora.
//
// - 7 huecos: tus 2 cartas (0–1), flop (2–4), turn (5) y river (6).
// - Al tocar un hueco se abre la hoja de cartas (hoja-cartas.js) desde abajo.
// - Cada carta son dos toques (valor y palo, en cualquier orden). Al completarla,
//   se coloca y se pasa sola al siguiente hueco vacío.
// - Las cartas que ya están en la mesa salen desactivadas: no se pueden repetir.

import { VALORES_TEXTO, SIMBOLOS, NOMBRES_PALOS, valorDe, paloDe } from './cartas.js';
import { crearHojaCartas } from './hoja-cartas.js';

const NOMBRES_HUECOS = [
  'Tu mano · 1ª carta', 'Tu mano · 2ª carta',
  'Flop · 1ª carta', 'Flop · 2ª carta', 'Flop · 3ª carta',
  'Turn', 'River',
];

/**
 * Crea el selector dentro de la página.
 * alCambiar({ mias, mesa }) se llama cada vez que cambia alguna carta.
 */
export function crearSelector({ alCambiar }) {
  // ---- Estado: todo lo que el selector "recuerda" ----
  const huecos = new Array(7).fill(null); // carta de cada hueco (null = vacío)
  let seleccionado = null;  // hueco que se está rellenando (null = hoja cerrada)

  // Tocar otro hueco con la hoja abierta lo selecciona (no cierra la hoja)
  const hoja = crearHojaCartas(document.getElementById('hoja'), { noCerrarEn: '.hueco' });

  // ---- Crear los botones de los huecos (una sola vez) ----
  const botonesHuecos = huecos.map((_, i) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'hueco';
    boton.addEventListener('click', () => abrir(i));
    document.getElementById(i < 2 ? 'huecos-mano' : 'huecos-mesa').appendChild(boton);
    return boton;
  });

  // ---- Acciones ----

  function opcionesHoja() {
    return {
      titulo: NOMBRES_HUECOS[seleccionado],
      usadas: cartasUsadas(),
      botones: [
        { texto: 'Quitar', desactivado: huecos[seleccionado] === null, alTocar: quitar },
        { texto: 'Listo', acento: true, alTocar: () => hoja.cerrar() },
      ],
      alElegir: colocar,
      alCerrar: () => { seleccionado = null; pintar(); },
    };
  }

  function abrir(i) {
    if (!huecoActivo(i)) return;
    seleccionado = i;
    if (hoja.estaAbierta()) hoja.actualizar(opcionesHoja());
    else hoja.abrir(opcionesHoja());
    pintar();
    asegurarVisible();
  }

  // Coloca la carta elegida y pasa al siguiente hueco vacío (o cierra si no queda ninguno)
  function colocar(c) {
    huecos[seleccionado] = c;
    avisarCambio();
    const siguiente = siguienteHuecoVacio(seleccionado);
    if (siguiente === null) {
      hoja.cerrar();
      return;
    }
    seleccionado = siguiente;
    hoja.actualizar(opcionesHoja());
    pintar();
    asegurarVisible();
  }

  function quitar() {
    if (seleccionado === null) return;
    huecos[seleccionado] = null;
    // Las calles van en orden: sin flop completo no hay turn, y sin turn no hay river
    if (seleccionado >= 2 && seleccionado <= 4) {
      huecos[5] = null; // quitar una carta del flop quita también turn…
      huecos[6] = null; // …y river
    } else if (seleccionado === 5) {
      huecos[6] = null; // quitar el turn quita también el river
    }
    avisarCambio();
    hoja.actualizar(opcionesHoja());
    pintar();
  }

  // ---- Reglas ----

  // El turn necesita el flop completo, y el river necesita el turn.
  // Un hueco que ya tiene carta siempre se puede tocar (para cambiarla o quitarla).
  function huecoActivo(i) {
    if (huecos[i] !== null) return true;
    if (i === 5) return huecos[2] !== null && huecos[3] !== null && huecos[4] !== null;
    if (i === 6) return huecos[5] !== null;
    return true;
  }

  // Busca el siguiente hueco vacío: primero los de después, luego los de antes
  function siguienteHuecoVacio(desde) {
    for (let paso = 1; paso < 7; paso++) {
      const i = (desde + paso) % 7;
      if (huecos[i] === null && huecoActivo(i)) return i;
    }
    return null;
  }

  // Cartas ocupadas por otros huecos (la del hueco seleccionado no cuenta: se va a cambiar)
  function cartasUsadas() {
    const usadas = new Set();
    huecos.forEach((c, i) => {
      if (c !== null && i !== seleccionado) usadas.add(c);
    });
    return usadas;
  }

  // ---- Dibujar los huecos ----

  function pintar() {
    botonesHuecos.forEach((boton, i) => {
      const c = huecos[i];
      boton.className = 'hueco';
      if (c === null) {
        boton.innerHTML = '';
        boton.classList.add('vacio');
        boton.setAttribute('aria-label', NOMBRES_HUECOS[i] + ': vacío');
      } else {
        boton.innerHTML =
          '<span class="carta-valor">' + VALORES_TEXTO[valorDe(c)] + '</span>' +
          '<span class="carta-palo">' + SIMBOLOS[paloDe(c)] + '</span>';
        boton.classList.add('palo-' + paloDe(c));
        boton.setAttribute('aria-label',
          NOMBRES_HUECOS[i] + ': ' + VALORES_TEXTO[valorDe(c)] + ' de ' + NOMBRES_PALOS[paloDe(c)]);
      }
      boton.classList.toggle('seleccionado', i === seleccionado);
      boton.disabled = !huecoActivo(i);
    });
  }

  // En pantallas bajas, la hoja podría tapar el hueco que se está rellenando: desplazar la página
  function asegurarVisible() {
    const boton = botonesHuecos[seleccionado];
    const limite = window.innerHeight - hoja.alto() - 12;
    const abajo = boton.getBoundingClientRect().bottom;
    if (abajo > limite) {
      window.scrollBy({ top: abajo - limite, behavior: 'smooth' });
    }
  }

  // ---- Comunicación con la pantalla de la calculadora ----

  function obtenerCartas() {
    return {
      mias: huecos.slice(0, 2).filter((c) => c !== null),
      mesa: huecos.slice(2).filter((c) => c !== null),
    };
  }

  function avisarCambio() {
    alCambiar(obtenerCartas());
  }

  pintar();

  return {
    cartas: obtenerCartas,
    cerrar: () => hoja.cerrar(),
    vaciar() {
      huecos.fill(null);
      hoja.cerrar();
      pintar();
      avisarCambio();
    },
  };
}
