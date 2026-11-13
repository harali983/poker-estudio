// pantalla-mesa.js: preparar la mesa (partida nueva) o editarla (partida en curso).
//
// Todo lo que cambias se guarda al momento como "borrador", para no perderlo si iOS cierra
// la app. La partida de verdad solo se crea o se cambia al pulsar "Empezar partida" o
// "Guardar cambios".

import {
  crearBorrador, cambiarNumJugadores, sentarme, ponerBoton, cambiarAsiento, fichasParaTodos,
  nombreDeAsiento, posicionEnMesa, validarMesa, borradorDePartida, normalizar,
  MIN_JUGADORES, MAX_JUGADORES,
} from './mesa.js';
import {
  partidaEnCurso, rivalesConocidos, nombresDeJugadores, guardarMesa, terminarPartida,
  leerBorrador, guardarBorrador, borrarBorrador,
} from './partidas.js';
import { leerAjustes } from './ajustes.js';
import { interpretarNumero } from './numeros.js';
import { ErrorBD } from './db.js';
import { mostrarError } from './avisos.js';

const JUGADORES_POR_DEFECTO = 6;

export function iniciarMesa() {
  const $ = (id) => document.getElementById(id);
  const ovalo = $('mesa-ovalada');
  const editor = $('editor-asiento');
  const campoNombre = $('editor-nombre');
  const campoFichas = $('editor-fichas');
  const campoSb = $('mesa-sb');
  const campoBb = $('mesa-bb');
  const campoAnte = $('mesa-ante');
  const casillaFichas = $('mesa-con-fichas');
  const campoFichasTodos = $('mesa-fichas-todos');
  const btnPrincipal = $('btn-empezar');
  const btnTerminar = $('btn-terminar');
  const textoGuardado = $('mesa-guardado');

  let borrador = null;     // la mesa tal y como está en pantalla
  let partida = null;      // partida en curso (si la hay: modo "editar")
  let conocidos = [];      // rivales ya guardados (para elegirlos con un toque)
  let seleccionado = null; // asiento abierto en el editor
  let sinGuardar = false;  // en modo editar: hay cambios sin guardar
  let temporizadorBorrador = null;

  // ---- Cargar al entrar en la pantalla ----
  async function cargar() {
    try {
      partida = await partidaEnCurso();
      conocidos = await rivalesConocidos();
      const guardado = await leerBorrador(partida ? partida.id : null);
      if (partida) {
        borrador = guardado || borradorDePartida(partida, await nombresDeJugadores());
        sinGuardar = Boolean(guardado);
      } else {
        borrador = guardado || crearBorrador(JUGADORES_POR_DEFECTO, (await leerAjustes()).ciegas);
        sinGuardar = false;
      }
    } catch (error) {
      avisarFallo(error);
      return;
    }
    seleccionado = null;
    textoGuardado.textContent = '';
    campoSb.value = borrador.ciegasTexto.sb;
    campoBb.value = borrador.ciegasTexto.bb;
    campoAnte.value = borrador.ciegasTexto.ante;
    pintar();
  }

  // Cada cambio pasa por aquí: actualiza el borrador, lo guarda (sin prisa) y repinta
  function cambiar(nuevo) {
    borrador = nuevo;
    if (partida) sinGuardar = true;
    clearTimeout(temporizadorBorrador);
    temporizadorBorrador = setTimeout(guardarBorradorYa, 300);
    pintar();
  }

  function guardarBorradorYa() {
    temporizadorBorrador = null;
    guardarBorrador(borrador, partida ? partida.id : null).catch(avisarFallo);
  }

  // Anula un guardado del borrador pendiente (al empezar, guardar o terminar la partida,
  // el borrador se borra y no debe volver a guardarse al salir de la pantalla)
  function cancelarBorradorPendiente() {
    clearTimeout(temporizadorBorrador);
    temporizadorBorrador = null;
  }

  // ---- Mesa ovalada ----
  function pintarMesa() {
    ovalo.querySelectorAll('.asiento-mesa, .ficha-boton').forEach((el) => el.remove());
    const n = borrador.asientos.length;

    borrador.asientos.forEach((a, i) => {
      const p = posicionEnMesa(i, n, borrador.miAsiento);
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'asiento-mesa';
      boton.style.left = p.x + '%';
      boton.style.top = p.y + '%';
      const esYo = i === borrador.miAsiento;
      boton.classList.toggle('yo', esYo);
      boton.classList.toggle('sin-nombre', !esYo && !a.nombre.trim());
      boton.classList.toggle('seleccionado', i === seleccionado);

      // En la mesa, un asiento vacío muestra solo su número ("Asiento 3" no cabe)
      const nombre = document.createElement('span');
      nombre.className = 'asiento-nombre';
      nombre.textContent = esYo || a.nombre.trim() ? nombreDeAsiento(borrador, i) : String(i + 1);
      boton.appendChild(nombre);
      if (borrador.conFichas) {
        const fichas = document.createElement('span');
        fichas.className = 'asiento-fichas';
        fichas.textContent = a.fichas > 0 ? formatear(a.fichas) : 'sin fichas';
        boton.appendChild(fichas);
      }
      const descripcion = esYo ? 'Tú, asiento ' + (i + 1)
        : a.nombre.trim() ? a.nombre.trim() + ', asiento ' + (i + 1)
        : 'Asiento ' + (i + 1) + ', vacío';
      boton.setAttribute('aria-label', descripcion + (i === borrador.boton ? ', con el botón' : ''));
      boton.addEventListener('click', () => abrirEditor(i));
      ovalo.appendChild(boton);

      // Ficha del botón (D): entre el asiento y el centro de la mesa
      if (i === borrador.boton) {
        const ficha = document.createElement('span');
        ficha.className = 'ficha-boton';
        ficha.textContent = 'D';
        ficha.style.left = (50 + (p.x - 50) * 0.6) + '%';
        ficha.style.top = (50 + (p.y - 50) * 0.6) + '%';
        ficha.setAttribute('aria-hidden', 'true');
        ovalo.appendChild(ficha);
      }
    });
  }

  // ---- Editor del asiento (debajo de la mesa) ----
  function abrirEditor(i) {
    seleccionado = i;
    const a = borrador.asientos[i];
    campoNombre.value = a.nombre;
    campoFichas.value = a.fichas > 0 ? String(a.fichas).replace('.', ',') : '';
    pintar();
    editor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  $('btn-editor-cerrar').addEventListener('click', () => {
    seleccionado = null;
    pintar();
  });

  campoNombre.addEventListener('input', () => {
    cambiar(cambiarAsiento(borrador, seleccionado, { nombre: campoNombre.value, jugadorId: null }));
  });
  // Al pulsar "OK" en el teclado del iPhone, cerrar el teclado
  campoNombre.addEventListener('keydown', (e) => { if (e.key === 'Enter') campoNombre.blur(); });

  campoFichas.addEventListener('input', () => {
    cambiar(cambiarAsiento(borrador, seleccionado, { fichas: interpretarNumero(campoFichas.value) }));
  });

  $('btn-sentarme').addEventListener('click', () => {
    const j = seleccionado;
    cambiar(sentarme(borrador, j));
    abrirEditor(j); // el asiento sigue abierto: ahora es el tuyo
  });

  $('btn-boton-aqui').addEventListener('click', () => {
    cambiar(ponerBoton(borrador, seleccionado));
  });

  function pintarEditor() {
    editor.hidden = seleccionado === null;
    $('mesa-pista').hidden = seleccionado !== null;
    if (seleccionado === null) return;

    const i = seleccionado;
    const esYo = i === borrador.miAsiento;
    $('editor-titulo').textContent = esYo ? 'Tu asiento' : 'Asiento ' + (i + 1);
    $('editor-nombre-bloque').hidden = esYo;
    $('editor-fichas-bloque').hidden = !borrador.conFichas;
    $('btn-sentarme').hidden = esYo;
    const tieneBoton = i === borrador.boton;
    $('btn-boton-aqui').disabled = tieneBoton;
    $('btn-boton-aqui').textContent = tieneBoton ? 'Tiene el botón' : 'Dar el botón';
    if (!esYo) pintarConocidos(i);
  }

  // Rivales conocidos que no están ya sentados, filtrados por lo que vas escribiendo
  function pintarConocidos(i) {
    const contenedor = $('editor-conocidos');
    contenedor.innerHTML = '';
    const sentados = new Set(borrador.asientos
      .filter((a, k) => k !== i && k !== borrador.miAsiento)
      .map((a) => normalizar(a.nombre)));
    const escrito = normalizar(campoNombre.value);
    const lista = conocidos
      .filter((j) => !sentados.has(normalizar(j.nombre)))
      .filter((j) => !escrito || normalizar(j.nombre).includes(escrito))
      .filter((j) => normalizar(j.nombre) !== escrito) // si ya está escrito entero, no repetirlo
      .slice(0, 12);

    for (const j of lista) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = j.nombre;
      chip.addEventListener('click', () => {
        campoNombre.value = j.nombre;
        cambiar(cambiarAsiento(borrador, i, { nombre: j.nombre, jugadorId: j.id }));
      });
      contenedor.appendChild(chip);
    }
    $('editor-conocidos-titulo').hidden = lista.length === 0;
  }

  // ---- Ajustes de la mesa ----
  $('mesa-menos').addEventListener('click', () => cambiarNumero(-1));
  $('mesa-mas').addEventListener('click', () => cambiarNumero(+1));

  function cambiarNumero(diferencia) {
    const nuevo = cambiarNumJugadores(borrador, borrador.asientos.length + diferencia);
    if (seleccionado !== null && seleccionado >= nuevo.asientos.length) seleccionado = null;
    cambiar(nuevo);
  }

  for (const [campo, clave] of [[campoSb, 'sb'], [campoBb, 'bb'], [campoAnte, 'ante']]) {
    campo.addEventListener('input', () => {
      cambiar({ ...borrador, ciegasTexto: { ...borrador.ciegasTexto, [clave]: campo.value } });
    });
  }

  casillaFichas.addEventListener('change', () => {
    cambiar({ ...borrador, conFichas: casillaFichas.checked });
  });

  $('btn-fichas-todos').addEventListener('click', () => {
    const fichas = interpretarNumero(campoFichasTodos.value);
    if (!(fichas > 0)) {
      campoFichasTodos.focus();
      return;
    }
    cambiar(fichasParaTodos(borrador, fichas));
    if (seleccionado !== null) campoFichas.value = String(fichas).replace('.', ',');
  });

  // ---- Empezar / guardar / terminar ----
  btnPrincipal.addEventListener('click', async () => {
    if (validarMesa(borrador).errores.length) return;
    btnPrincipal.disabled = true;
    try {
      const eraNueva = !partida;
      cancelarBorradorPendiente();
      const guardada = await guardarMesa(borrador, partida);
      await borrarBorrador(eraNueva ? null : partida.id);
      if (eraNueva) {
        location.hash = '#inicio'; // allí aparece "Continuar partida"
        return;
      }
      partida = guardada;
      conocidos = await rivalesConocidos();
      sinGuardar = false;
      textoGuardado.textContent = 'Cambios guardados ✓';
      setTimeout(() => { textoGuardado.textContent = ''; }, 2000);
    } catch (error) {
      avisarFallo(error);
    }
    pintar();
  });

  btnTerminar.addEventListener('click', async () => {
    if (!confirm('¿Terminar la partida? Seguirá guardada, pero ya no se podrán añadir manos.')) return;
    try {
      cancelarBorradorPendiente();
      await terminarPartida(partida);
      await borrarBorrador(partida.id);
      location.hash = '#inicio';
    } catch (error) {
      avisarFallo(error);
    }
  });

  // ---- Pintar todo lo que depende del borrador ----
  function pintar() {
    if (!borrador) return;
    $('mesa-titulo').textContent = partida ? 'Mesa de la partida' : 'Preparar la mesa';
    pintarMesa();
    pintarEditor();

    const n = borrador.asientos.length;
    $('mesa-num').textContent = n;
    $('mesa-menos').disabled = n <= MIN_JUGADORES;
    $('mesa-mas').disabled = n >= MAX_JUGADORES;
    casillaFichas.checked = borrador.conFichas;
    $('bloque-fichas-todos').hidden = !borrador.conFichas;

    const { errores, avisos } = validarMesa(borrador);
    const lista = $('mesa-mensajes');
    lista.innerHTML = '';
    for (const [textos, clase] of [[errores, 'error'], [avisos, 'aviso']]) {
      for (const texto of textos) {
        const li = document.createElement('li');
        li.className = clase;
        li.textContent = (clase === 'error' ? '✋ ' : '⚠️ ') + texto;
        lista.appendChild(li);
      }
    }

    btnPrincipal.textContent = partida ? 'Guardar cambios' : 'Empezar partida';
    btnPrincipal.disabled = errores.length > 0 || (Boolean(partida) && !sinGuardar);
    btnTerminar.hidden = !partida;
  }

  function avisarFallo(error) {
    console.error(error);
    mostrarError(error instanceof ErrorBD ? error.message : 'Error inesperado en la mesa: ' + error.message);
  }

  // Guardar ya el borrador pendiente (si sales, cambias de app o se cierra justo después de escribir)
  function guardarYa() {
    if (temporizadorBorrador) {
      clearTimeout(temporizadorBorrador);
      guardarBorradorYa();
    }
  }

  return {
    alEntrar: cargar,
    alSalir: guardarYa,
    guardarYa,
  };
}

function formatear(n) {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}
