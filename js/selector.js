// selector.js: selector táctil de cartas.
//
// - 7 huecos: tus 2 cartas (0–1), flop (2–4), turn (5) y river (6).
// - Al tocar un hueco se abre una "hoja" desde abajo con los valores y los palos.
// - Cada carta son dos toques (valor y palo, en cualquier orden). Al completarla,
//   se coloca y se pasa sola al siguiente hueco vacío.
// - Las cartas que ya están en la mesa salen desactivadas: no se pueden repetir.

import { VALORES_TEXTO, SIMBOLOS, NOMBRES_PALOS, carta, valorDe, paloDe } from './cartas.js';

const NOMBRES_HUECOS = [
  'Tu mano · 1ª carta', 'Tu mano · 2ª carta',
  'Flop · 1ª carta', 'Flop · 2ª carta', 'Flop · 3ª carta',
  'Turn', 'River',
];

// Orden de los botones de valores en la hoja: de la A al 2
const ORDEN_VALORES = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

/**
 * Crea el selector dentro de la página.
 * alCambiar({ mias, mesa }) se llama cada vez que cambia alguna carta.
 */
export function crearSelector({ alCambiar }) {
  // ---- Estado: todo lo que el selector "recuerda" ----
  const huecos = new Array(7).fill(null); // carta de cada hueco (null = vacío)
  let seleccionado = null;  // hueco que se está rellenando (null = hoja cerrada)
  let valorElegido = null;  // primer toque pendiente de completar…
  let paloElegido = null;   // …con el segundo

  // ---- Elementos de la página ----
  const hoja = document.getElementById('hoja');
  const titulo = document.getElementById('hoja-titulo');
  const btnQuitar = document.getElementById('btn-quitar');
  const btnListo = document.getElementById('btn-listo');

  // ---- Crear los botones (una sola vez) ----
  const botonesHuecos = huecos.map((_, i) => {
    const boton = crearBoton('hueco', () => abrir(i));
    const contenedor = i < 2 ? 'huecos-mano' : 'huecos-mesa';
    document.getElementById(contenedor).appendChild(boton);
    return boton;
  });

  const botonesValores = [];
  for (const v of ORDEN_VALORES) {
    const boton = crearBoton('boton tecla', () => elegirValor(v));
    boton.textContent = VALORES_TEXTO[v];
    document.getElementById('rejilla-valores').appendChild(boton);
    botonesValores[v] = boton;
  }

  const botonesPalos = [0, 1, 2, 3].map((p) => {
    const boton = crearBoton('boton tecla tecla-palo palo-' + p, () => elegirPalo(p));
    boton.textContent = SIMBOLOS[p];
    boton.setAttribute('aria-label', NOMBRES_PALOS[p]);
    document.getElementById('fila-palos').appendChild(boton);
    return boton;
  });

  btnQuitar.addEventListener('click', () => {
    if (seleccionado === null) return;
    huecos[seleccionado] = null;
    // Las calles van en orden: sin flop completo no hay turn, y sin turn no hay river
    if (seleccionado >= 2 && seleccionado <= 4) {
      huecos[5] = null; // quitar una carta del flop quita también turn…
      huecos[6] = null; // …y river
    } else if (seleccionado === 5) {
      huecos[6] = null; // quitar el turn quita también el river
    }
    valorElegido = paloElegido = null;
    avisarCambio();
    pintar();
  });

  btnListo.addEventListener('click', cerrar);

  // Tocar fuera de la hoja (y fuera de los huecos) la cierra.
  // Se usa "pointerdown" porque Safari en iPhone no lanza "click" en zonas no pulsables.
  document.addEventListener('pointerdown', (evento) => {
    if (seleccionado === null) return;
    if (hoja.contains(evento.target) || evento.target.closest('.hueco')) return;
    cerrar();
  });

  // ---- Acciones ----

  function abrir(i) {
    if (!huecoActivo(i)) return;
    seleccionado = i;
    valorElegido = paloElegido = null;
    pintar();
    asegurarVisible();
  }

  function cerrar() {
    seleccionado = null;
    valorElegido = paloElegido = null;
    pintar();
  }

  function elegirValor(v) {
    valorElegido = valorElegido === v ? null : v; // tocarlo otra vez lo desmarca
    intentarColocar();
  }

  function elegirPalo(p) {
    paloElegido = paloElegido === p ? null : p;
    intentarColocar();
  }

  // Si ya hay valor y palo, coloca la carta y pasa al siguiente hueco vacío
  function intentarColocar() {
    if (valorElegido !== null && paloElegido !== null) {
      huecos[seleccionado] = carta(valorElegido, paloElegido);
      valorElegido = paloElegido = null;
      avisarCambio();
      const siguiente = siguienteHuecoVacio(seleccionado);
      if (siguiente === null) {
        cerrar();
        return;
      }
      seleccionado = siguiente;
      pintar();
      asegurarVisible();
      return;
    }
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

  // ---- Dibujar: pone la página de acuerdo con el estado ----

  function pintar() {
    const abierta = seleccionado !== null;

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

    hoja.classList.toggle('abierta', abierta);
    hoja.setAttribute('aria-hidden', String(!abierta));
    document.body.classList.toggle('hoja-abierta', abierta);
    if (!abierta) return;

    // Título con lo elegido hasta ahora, p. ej. "Flop · 2ª carta — A?"
    let texto = NOMBRES_HUECOS[seleccionado];
    if (valorElegido !== null || paloElegido !== null) {
      texto += ' — ' + (valorElegido !== null ? VALORES_TEXTO[valorElegido] : '?') +
                       (paloElegido !== null ? SIMBOLOS[paloElegido] : '?');
    }
    titulo.textContent = texto;
    btnQuitar.disabled = huecos[seleccionado] === null;

    const usadas = cartasUsadas();
    for (let v = 0; v < 13; v++) {
      const ocupada = paloElegido !== null
        ? usadas.has(carta(v, paloElegido))
        : [0, 1, 2, 3].every((p) => usadas.has(carta(v, p)));
      botonesValores[v].disabled = ocupada;
      botonesValores[v].classList.toggle('elegido', v === valorElegido);
    }
    for (let p = 0; p < 4; p++) {
      const ocupada = valorElegido !== null
        ? usadas.has(carta(valorElegido, p))
        : VALORES_TEXTO.every((_, v) => usadas.has(carta(v, p)));
      botonesPalos[p].disabled = ocupada;
      botonesPalos[p].classList.toggle('elegido', p === paloElegido);
    }
  }

  // En pantallas bajas, la hoja podría tapar el hueco que se está rellenando: desplazar la página
  function asegurarVisible() {
    const boton = botonesHuecos[seleccionado];
    const limite = window.innerHeight - hoja.offsetHeight - 12;
    const abajo = boton.getBoundingClientRect().bottom;
    if (abajo > limite) {
      window.scrollBy({ top: abajo - limite, behavior: 'smooth' });
    }
  }

  // ---- Comunicación con app.js ----

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

  // Lo que app.js puede usar del selector
  return {
    cartas: obtenerCartas,
    cerrar,
    vaciar() {
      huecos.fill(null);
      cerrar();
      avisarCambio();
    },
  };
}

function crearBoton(clase, alTocar) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = clase;
  boton.addEventListener('click', alTocar);
  return boton;
}
