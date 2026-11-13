// pantalla-calculadora.js: la calculadora de la Fase 1 (equidad y pot odds).
//
// iniciarCalculadora() prepara la pantalla la primera vez que se abre y devuelve
// { alSalir }, que app.js llama al cambiar de pantalla (para cerrar la hoja de cartas).

import { crearSelector } from './selector.js';
import { interpretarNumero } from './numeros.js';

export function iniciarCalculadora() {
  // ---- 1. Selector de cartas ----
  const selector = crearSelector({
    alCambiar: recalcular, // cada vez que cambia una carta, se vuelve a calcular la equidad
  });

  // ---- 2. Número de jugadores (2 a 9: tú + rivales) ----
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

  // ---- 3. Nueva mano: vaciar cartas y bote (el número de jugadores se mantiene) ----
  document.getElementById('btn-nueva-mano').addEventListener('click', () => {
    selector.vaciar();
    campoBote.value = '';
    campoPagar.value = '';
    actualizarPotOdds();
  });

  // ---- 4. Cálculo de la equidad (en un Web Worker) ----
  let worker = null;         // el worker que está calculando ahora (si hay)
  let temporizador = null;   // espera corta antes de empezar
  let ultimaEquidad = null;  // última equidad calculada (null = todavía no hay); la usan las pot odds

  // Esperamos 150 ms antes de calcular: si tocas varias cosas seguidas, solo se calcula una vez
  function recalcular() {
    // La equidad anterior deja de valer en cuanto cambia algo (no esperamos a recalcular)
    ultimaEquidad = null;
    actualizarPotOdds();
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
    ultimaEquidad = r.equidad;
    actualizarPotOdds();
  }

  // ---- 5. Pot odds: ¿compensa pagar? ----
  // Pot odds = a pagar / (bote + a pagar): la parte del bote final que pones tú.
  // Es la equidad MÍNIMA que necesitas para que pagar sea rentable a la larga.
  // Ejemplo: bote 100, pagar 50 → 50 / 150 = 33,3 %.
  const campoBote = document.getElementById('bote');
  const campoPagar = document.getElementById('pagar');
  const textoPotOdds = document.getElementById('pot-odds');
  campoBote.addEventListener('input', actualizarPotOdds);
  campoPagar.addEventListener('input', actualizarPotOdds);

  function actualizarPotOdds() {
    // Números a la española ("1.000" = mil, "12,5" = doce y medio; ver numeros.js)
    const bote = interpretarNumero(campoBote.value);
    const pagar = interpretarNumero(campoPagar.value);

    // Sin bote o sin nada que pagar, no hay pot odds que mostrar
    if (bote === null || pagar === null || pagar === 0) {
      textoPotOdds.hidden = true;
      return;
    }

    const necesaria = pagar / (bote + pagar);
    textoPotOdds.hidden = false;
    textoPotOdds.classList.remove('rentable', 'no-rentable');

    if (ultimaEquidad === null) {
      textoPotOdds.textContent = `Pot odds ${porcentaje(necesaria)}: necesitas al menos esa equidad para pagar.`;
    } else if (ultimaEquidad > necesaria) {
      textoPotOdds.classList.add('rentable');
      textoPotOdds.textContent =
        `✅ Pagar es rentable: tu equidad (${porcentaje(ultimaEquidad)}) supera el ${porcentaje(necesaria)} necesario.`;
    } else {
      textoPotOdds.classList.add('no-rentable');
      textoPotOdds.textContent =
        `❌ Pagar no es rentable: necesitas ${porcentaje(necesaria)} y tu equidad es ${porcentaje(ultimaEquidad)}.`;
    }
  }

  // Lo que app.js puede usar de esta pantalla
  return {
    alSalir() {
      selector.cerrar(); // que la hoja de cartas no se quede abierta encima de otra pantalla
    },
  };
}

// 0.634 → "63,4 %" (con coma decimal, como se escribe en español)
function porcentaje(x, conSimbolo = true) {
  const texto = (x * 100).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return conSimbolo ? texto + ' %' : texto;
}
