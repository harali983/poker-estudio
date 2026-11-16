// pantalla-ver-mano.js: la ficha de una mano cerrada (#ver-mano/<id>), desde Mis manos.
// Enseña los datos, las acciones por calle, la mesa, el final y las cartas mostradas; deja
// escribir notas y borrar la mano.
// Todo lo que se ve lo calcula fichaDeMano (historial.js, con tests); aquí solo se lee la base
// de datos y se pinta.
//
// Notas: se guardan solas poco después de dejar de escribir, y también al salir de la pantalla,
// al cambiar de app y al cerrarse la página (guardarYa; ver la regla de guardado del plan).

import { bd, ErrorBD } from './db.js';
import { fichaDeMano, manoCerrada } from './historial.js';
import { guardarMano, borrarMano } from './manos.js';
import { nombresDeJugadores } from './partidas.js';
import { mostrarError } from './avisos.js';
import { VALORES_TEXTO, SIMBOLOS, NOMBRES_PALOS, valorDe, paloDe } from './cartas.js';
import { el, numero, conSigno, claseResultado } from './pantalla-manos.js';

const ESPERA_NOTAS = 600; // ms sin escribir antes de guardar las notas

export function iniciarVerMano() {
  const $ = (id) => document.getElementById(id);
  const campoNotas = $('ficha-notas');
  const textoGuardado = $('ficha-guardado');

  let mano = null;              // la mano que se está viendo (null: ninguna, o recién borrada)
  let carga = 0;                // para descartar una lectura antigua si se abre otra mano enseguida
  let ocupado = false;          // borrando
  let temporizadorNotas = null;
  let temporizadorGuardado = null;
  let desdeLaLista = false;     // ¿se abrió tocando una mano en Mis manos?

  // ---- Leer la mano y pintarla ----
  // "desde": la pantalla de la que se viene (la pasa app.js)
  async function alEntrar(id, { desde } = {}) {
    desdeLaLista = desde === 'manos';
    const estaCarga = ++carga;
    mano = null;
    clearTimeout(temporizadorNotas);
    temporizadorNotas = null;
    textoGuardado.textContent = '';
    $('ficha-titulo').textContent = 'Mano';
    $('ficha-contenido').hidden = true;
    $('ficha-no-esta').hidden = true;

    let leida = null, nombres = new Map();
    try {
      [leida, nombres] = await Promise.all([id ? bd.leer('manos', id) : null, nombresDeJugadores()]);
    } catch (error) {
      avisarFallo(error);
      return;
    }
    if (estaCarga !== carga) return; // ya se ha pedido otra mano

    if (!manoCerrada(leida)) {
      $('ficha-no-esta').hidden = false;
      return;
    }
    mano = leida;
    pintar(fichaDeMano(mano, nombres, numero));
  }

  function pintar(ficha) {
    const r = ficha.resumen;
    $('ficha-titulo').textContent = 'Mano #' + r.numero;
    pintarDatos(ficha);
    $('ficha-calles').replaceChildren(...ficha.calles.map(pintarCalle));
    pintarFinal(ficha.final);
    $('ficha-jugadores').replaceChildren(...ficha.jugadores.map(pintarJugador));
    campoNotas.value = ficha.notas;
    $('ficha-contenido').hidden = false;
  }

  // Tus cartas, posición y resultado; debajo, fecha, ciegas, jugadores, bote y la mesa
  function pintarDatos(ficha) {
    const r = ficha.resumen;
    const cabecera = el('div', 'ficha-cabecera');
    const mias = el('div', 'ficha-mias');
    if (!r.jugaba) {
      mias.append(el('span', 'texto-suave', 'No jugabas esta mano'));
    } else {
      mias.append(r.misCartas ? cartas(r.misCartas, 'ficha-cartas') : el('span', 'ficha-cartas texto-suave', '¿? ¿?'));
      if (r.posicion) mias.append(el('span', 'ficha-posicion', r.posicion));
    }
    cabecera.append(mias);
    if (r.jugaba) {
      const res = el('div', 'ficha-resultado');
      res.append(el('strong', claseResultado(r.resultado), conSigno(r.resultado)));
      if (r.resultadoBB !== null) res.append(el('small', 'texto-suave', conSigno(Math.round(r.resultadoBB * 100) / 100) + ' BB'));
      cabecera.append(res);
    }

    const { sb, bb, ante } = ficha.ciegas;
    const detalle = [
      fechaLarga(r.fecha),
      `Ciegas ${numero(sb)}/${numero(bb)}` + (ante ? ` · ante ${numero(ante)}` : ''),
      `${r.jugadores} jugadores`,
      `bote ${numero(r.bote)}`,
    ].filter(Boolean).join(' · ');

    const mesa = el('p', 'ficha-mesa');
    mesa.append(el('span', 'texto-suave', 'Mesa'));
    if (ficha.mesa.length) mesa.append(cartas(ficha.mesa));
    else mesa.append(el('span', 'texto-suave', ficha.calles.length > 1 ? 'sin anotar' : 'no se llegó al flop'));

    $('ficha-datos').replaceChildren(cabecera, el('p', 'texto-suave texto-pequeno ficha-detalle', detalle), mesa);
  }

  // Una calle: "Flop  K♦ 7♣ 2♠  · bote 12 · 3 jugadores" y, debajo, lo que hizo cada uno
  function pintarCalle(calle) {
    const bloque = el('div', 'ficha-calle');
    const titulo = el('h3', 'ficha-calle-titulo');
    titulo.append(el('span', '', calle.titulo));
    if (calle.cartas) {
      titulo.append(calle.cartas.length ? cartas(calle.cartas) : el('small', 'texto-suave', 'cartas sin anotar'));
      titulo.append(el('small', 'texto-suave', `bote ${numero(calle.bote)} · ${calle.jugadores} jugadores`));
    }
    bloque.append(titulo);

    if (calle.lineas.length) {
      const lista = el('ol', 'ficha-lineas');
      for (const l of calle.lineas) {
        const li = el('li', 'linea-' + l.tipo + (l.yo ? ' linea-yo' : ''));
        li.append(el('strong', '', l.nombre), ' ' + l.accion);
        lista.append(li);
      }
      bloque.append(lista);
    } else {
      bloque.append(el('p', 'texto-suave texto-pequeno ficha-sin-acciones', 'Sin apuestas (alguien estaba all-in).'));
    }
    return bloque;
  }

  // Quién gana y cuánto, lo que se devuelve, muck y las cartas que se enseñaron
  function pintarFinal(final) {
    const partes = final.lineas.map((t) => el('p', 'ficha-final-linea', t));
    if (final.mostradas.length) {
      const lista = el('ul', 'ficha-mostradas');
      for (const m of final.mostradas) {
        const li = el('li', m.yo ? 'linea-yo' : '');
        li.append(el('strong', '', m.nombre), cartas(m.cartas));
        if (m.jugada) li.append(el('span', 'texto-suave', m.jugada));
        lista.append(li);
      }
      partes.push(el('h3', 'ficha-subtitulo', 'Cartas mostradas'), lista);
    } else if (final.motivo === 'showdown') {
      partes.push(el('p', 'texto-suave texto-pequeno', 'No se anotaron las cartas mostradas.'));
    }
    $('ficha-final').replaceChildren(...partes);
  }

  // [BTN] Ana · empezó con 200 · puso 6            −6
  function pintarJugador(j) {
    const li = el('li', j.yo ? 'linea-yo' : '');
    const detalle = [
      j.fichasInicio !== null ? `empezó con ${numero(j.fichasInicio)}` : '',
      j.puesto ? `puso ${numero(j.puesto)}` : 'no puso nada',
      j.retirado ? 'se retiró' : '',
    ].filter(Boolean).join(' · ');
    const medio = el('span', 'jugador-nombre');
    medio.append(el('strong', '', j.nombre), el('small', 'texto-suave', detalle));
    li.append(
      el('span', 'jugador-posicion', j.posicion || ''),
      medio,
      el('span', 'jugador-neto ' + claseResultado(j.neto), conSigno(j.neto)),
    );
    return li;
  }

  // ---- Notas: se guardan solas ----
  campoNotas.addEventListener('input', () => {
    clearTimeout(temporizadorNotas);
    temporizadorNotas = setTimeout(guardarNotas, ESPERA_NOTAS);
  });
  campoNotas.addEventListener('blur', guardarYa); // al cerrar el teclado

  async function guardarNotas() {
    clearTimeout(temporizadorNotas);
    temporizadorNotas = null;
    if (!mano) return;
    const notas = campoNotas.value;
    const anteriores = mano.notas || '';
    if (notas === anteriores) return;
    const guardada = { ...mano, notas };
    mano = guardada; // lo siguiente que se escriba se compara ya con esto
    try {
      await guardarMano(guardada);
      if (mano !== guardada) return; // ya hay otra mano en pantalla, o un guardado más nuevo
      textoGuardado.textContent = 'Guardado ✓';
      clearTimeout(temporizadorGuardado);
      temporizadorGuardado = setTimeout(() => { textoGuardado.textContent = ''; }, 1500);
    } catch (error) {
      // No se guardó: se deja como estaba para que el próximo intento lo vuelva a guardar
      if (mano === guardada) mano = { ...mano, notas: anteriores };
      avisarFallo(error);
    }
  }

  // Guardar ya lo pendiente (al salir de la pantalla, cambiar de app o cerrarse la página)
  function guardarYa() {
    if (temporizadorNotas) guardarNotas();
  }

  // ---- Volver a Mis manos ----
  // Si se vino de la lista, se vuelve con "atrás" (así la ficha no se queda en el historial y
  // "atrás" desde la lista va a Inicio). Si se abrió directamente, se sustituye por la lista.
  document.querySelector('#pantalla-ver-mano .volver').addEventListener('click', (e) => {
    e.preventDefault();
    guardarYa();
    if (desdeLaLista) history.back(); else location.replace('#manos');
  });

  // ---- Borrar la mano (y sus participaciones) ----
  $('ficha-borrar').addEventListener('click', async () => {
    if (!mano || ocupado) return;
    const aviso = '¿Borrar esta mano?\n\nDesaparece de Mis manos y de las estadísticas, y no se puede recuperar. '
      + 'Las fichas de la partida no cambian.';
    if (!confirm(aviso)) return;
    ocupado = true;
    const id = mano.id;
    // Desde aquí no se guarda nada más de esta mano (una nota pendiente la volvería a crear)
    clearTimeout(temporizadorNotas);
    temporizadorNotas = null;
    mano = null;
    try {
      await borrarMano(id);
      location.replace('#manos'); // sin dejar la ficha borrada en el historial de "atrás"
    } catch (error) {
      avisarFallo(error);
      alEntrar(id); // no se borró: se vuelve a leer
    } finally {
      ocupado = false;
    }
  });

  function avisarFallo(error) {
    console.error(error);
    mostrarError(error instanceof ErrorBD ? error.message : 'Error inesperado en la ficha de la mano: ' + error.message);
  }

  return { alEntrar, alSalir: guardarYa, guardarYa };
}

// ---- Utilidades ----
// Cartas en línea, cada una con el color de su palo: A♠ K♦
function cartas(lista, claseExtra = '') {
  const span = el('span', 'cartas-linea' + (claseExtra ? ' ' + claseExtra : ''));
  for (const c of lista) {
    const carta = el('span', 'palo-' + paloDe(c), VALORES_TEXTO[valorDe(c)] + SIMBOLOS[paloDe(c)]);
    carta.setAttribute('aria-label', VALORES_TEXTO[valorDe(c)] + ' de ' + NOMBRES_PALOS[paloDe(c)]);
    span.append(carta);
  }
  return span;
}

// "vie, 20 nov 2026, 21:14"
function fechaLarga(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
