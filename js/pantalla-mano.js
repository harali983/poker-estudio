// pantalla-mano.js: registrar la mano en curso.
//
// Tres situaciones:
//  - Entre manos: la mesa con las posiciones de la próxima mano y "Empezar mano N".
//    (Es el momento de editar la mesa: quién juega, fichas, quién se sienta…)
//  - Mano en curso: a quién le toca, el bote y los botones Fold / Check / Call, Deshacer.
//    Al cerrarse una calle, "Pasar al flop/turn/river" (las cartas llegan en el paso 8).
//  - Mano terminada: el resultado y "Siguiente mano" (el botón avanza).
//
// Regla de guardado: cada toque → se guarda la mano en la base de datos → se pinta.
// Sin temporizadores: si iOS cierra la app, lo que se ve en pantalla ya está guardado.

import {
  calcularEstado, opciones, eventoDeAccion, eventoDeMesa, deshacer, puedeDeshacer,
} from './motor.js';
import { calcularPosiciones } from './posiciones.js';
import { posicionEnMesa } from './mesa.js';
import { partidaEnCurso, nombresDeJugadores } from './partidas.js';
import { manoEnCurso, empezarMano, guardarMano, terminarMano } from './manos.js';
import { crearTeclado, pasoDeCiegas, accionDeCantidad } from './teclado.js';
import { ErrorBD } from './db.js';
import { mostrarError } from './avisos.js';

const NOMBRE_CALLE = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
const BOTONES = ['btn-fold', 'btn-check', 'btn-call', 'btn-apostar', 'btn-subir',
  'btn-cartas', 'btn-siguiente', 'btn-empezar-mano'];

export function iniciarMano() {
  const $ = (id) => document.getElementById(id);
  const ovalo = $('mano-ovalo');

  let partida = null;
  let mano = null;          // mano en curso (null = entre manos)
  let nombres = new Map();  // jugadorId → nombre
  let ocupado = false;      // guardando: se ignoran más toques hasta terminar

  async function cargar() {
    try {
      partida = await partidaEnCurso();
      mano = partida ? await manoEnCurso(partida.id) : null;
      nombres = await nombresDeJugadores();
    } catch (error) {
      avisarFallo(error);
      return;
    }
    pintar();
  }

  // ---- Nombres ----
  function nombreDe(jugadorId, asiento) {
    if (jugadorId === 'yo') return 'Tú';
    return (jugadorId && nombres.get(jugadorId)) || 'Asiento ' + (asiento + 1);
  }
  function esYo(asiento) {
    const j = mano.jugadores.find((x) => x.asiento === asiento);
    return Boolean(j) && j.jugadorId === 'yo';
  }
  function nombreEnMano(asiento) {
    const j = mano.jugadores.find((x) => x.asiento === asiento);
    return nombreDe(j ? j.jugadorId : null, asiento);
  }

  // ---- Guardar y pintar ----
  // Guarda la mano con los eventos nuevos y solo entonces la da por buena y la pinta.
  // Si no se puede guardar, la mano se queda como estaba y se avisa.
  async function cambiarEventos(eventos) {
    if (ocupado) return;
    ocupado = true;
    const nueva = { ...mano, eventos };
    try {
      await guardarMano(nueva);
      mano = nueva;
    } catch (error) {
      avisarFallo(error);
    }
    ocupado = false;
    pintar();
  }

  function accion(nombre) {
    if (!mano) return;
    const estado = calcularEstado(mano);
    if (estado.fase !== 'accion') return;
    cambiarEventos([...mano.eventos, eventoDeAccion(estado, nombre)]);
  }
  $('btn-fold').addEventListener('click', () => accion('fold'));
  $('btn-check').addEventListener('click', () => accion('check'));
  $('btn-call').addEventListener('click', () => accion('call'));

  // Apostar / Subir: se abre el teclado y se anota "hasta X" (o all-in)
  const teclado = crearTeclado();
  function pedirCantidad() {
    if (!mano || ocupado) return;
    const estado = calcularEstado(mano);
    if (estado.fase !== 'accion') return;
    const j = estado.jugadores.find((x) => x.asiento === estado.turno);
    const apuesta = estado.apuestaMaxima === 0;
    const quien = esYo(estado.turno) ? 'Tú' : nombreEnMano(estado.turno);
    const eventosAntes = mano.eventos.length;
    teclado.abrir({
      titulo: `${quien} (${j.posicion}) · ${apuesta ? 'apostar' : 'subir hasta'}…`,
      estado,
      paso: pasoDeCiegas(mano.ciegas),
      alAnotar(hasta, allin) {
        if (!mano || mano.eventos.length !== eventosAntes) return; // la mano cambió mientras tanto
        cambiarEventos([...mano.eventos, eventoDeAccion(estado, accionDeCantidad(estado, allin), hasta)]);
      },
    });
  }
  $('btn-apostar').addEventListener('click', pedirCantidad);
  $('btn-subir').addEventListener('click', pedirCantidad);

  $('btn-cartas').addEventListener('click', () => {
    if (!mano) return;
    const estado = calcularEstado(mano);
    if (estado.fase !== 'cartas') return;
    cambiarEventos([...mano.eventos, eventoDeMesa(estado)]);
  });

  $('btn-deshacer').addEventListener('click', () => {
    if (mano && puedeDeshacer(mano.eventos)) cambiarEventos(deshacer(mano.eventos));
  });

  $('btn-siguiente').addEventListener('click', async () => {
    if (!mano || ocupado) return;
    const estado = calcularEstado(mano);
    if (estado.fase !== 'fin') return;
    ocupado = true;
    try {
      partida = await terminarMano(mano, partida, estado);
      mano = null;
    } catch (error) {
      avisarFallo(error);
    }
    ocupado = false;
    pintar();
  });

  $('btn-empezar-mano').addEventListener('click', async () => {
    if (mano || ocupado || !partida) return;
    ocupado = true;
    try {
      mano = await empezarMano(partida);
    } catch (error) {
      avisarFallo(error);
    }
    ocupado = false;
    pintar();
  });

  // ---- Pintar ----
  function pintar() {
    teclado.cerrar();
    $('mano-sin-partida').hidden = Boolean(partida);
    $('mano-contenido').hidden = !partida;
    $('mano-ir-mesa').hidden = !partida;
    if (!partida) {
      $('mano-titulo').textContent = 'Mano';
      return;
    }
    if (mano) pintarMano();
    else pintarEntreManos();
  }

  function mostrarBotones(visibles) {
    for (const id of BOTONES) $(id).hidden = !visibles.includes(id);
  }

  function pintarEntreManos() {
    const numero = (partida.manosJugadas || 0) + 1;
    $('mano-titulo').textContent = 'Mano ' + numero;
    const pos = calcularPosiciones(partida.asientos, partida.boton);

    pintarOvalo(partida.asientos.map((a, i) => ({
      nombre: nombreDe(a.jugadorId, i),
      posicion: a.juega === false ? 'fuera' : (pos ? pos.porAsiento[i].posicion : ''),
      fichas: partida.conFichas ? a.fichas : null,
      fuera: a.juega === false,
    })), partida.miAsiento, pos ? pos.boton : partida.boton);

    $('mano-calle').textContent = 'Entre manos';
    $('mano-bote').textContent = '';
    $('mano-estado').textContent = pos
      ? 'Antes de empezar puedes cambiar la mesa (quién juega, fichas…).'
      : 'Tienen que jugar al menos 2 jugadores: cambia la mesa.';
    $('mano-ultima').textContent = numero > 1 ? 'Mano ' + (numero - 1) + ' guardada ✓' : '';
    $('mano-avisos').innerHTML = '';

    mostrarBotones(['btn-empezar-mano']);
    $('btn-empezar-mano').textContent = 'Empezar mano ' + numero;
    $('btn-empezar-mano').disabled = !pos;
    $('btn-deshacer').hidden = true;
  }

  function pintarMano() {
    const estado = calcularEstado(mano);
    $('mano-titulo').textContent = 'Mano ' + mano.numero;

    // Todos los asientos de la mesa; los que no juegan esta mano, atenuados
    const porAsiento = new Map(estado.jugadores.map((j) => [j.asiento, j]));
    const n = Math.max(partida.asientos.length, ...mano.jugadores.map((j) => j.asiento + 1));
    const asientos = Array.from({ length: n }, (_, i) => {
      const j = porAsiento.get(i);
      if (!j) {
        const a = partida.asientos[i];
        return { nombre: nombreDe(a ? a.jugadorId : null, i), posicion: 'fuera', fichas: null, fuera: true };
      }
      return {
        nombre: nombreEnMano(i),
        posicion: j.posicion,
        fichas: j.fichas,
        allin: j.allin,
        retirado: !j.vivo,
        turno: estado.turno === i,
        puesto: j.puesto,
      };
    });
    const yo = mano.jugadores.find((j) => j.jugadorId === 'yo');
    pintarOvalo(asientos, yo ? yo.asiento : partida.miAsiento, mano.boton);

    $('mano-calle').textContent = NOMBRE_CALLE[estado.calle];
    $('mano-bote').textContent = 'Bote ' + formatear(estado.bote);

    // Qué pasa ahora
    let texto = '';
    if (estado.fase === 'accion') {
      const j = porAsiento.get(estado.turno);
      const quien = esYo(estado.turno) ? 'Te toca' : 'Le toca a ' + nombreEnMano(estado.turno);
      texto = `${quien} (${j.posicion})` +
        (estado.aPagar > 0 ? ` · paga ${formatear(estado.aPagar)}` : ' · puede pasar');
    } else if (estado.fase === 'cartas') {
      texto = `Se cierra el ${estado.calle}. Toca el ${estado.faltan}.`;
    } else if (estado.motivoFin === 'retirada') {
      texto = esYo(estado.ganador)
        ? `Ganas tú: los demás se retiran. Te llevas ${formatear(estado.bote)}.`
        : `Gana ${nombreEnMano(estado.ganador)}: los demás se retiran. Se lleva ${formatear(estado.bote)}.`;
    } else {
      texto = `Showdown con un bote de ${formatear(estado.bote)}. (Elegir el ganador y repartir el bote llega pronto.)`;
    }
    $('mano-estado').textContent = texto;
    $('mano-ultima').textContent = describirUltimo();

    // Avisos del último evento (la app anota lo que pasó, aunque no cuadre)
    const lista = $('mano-avisos');
    lista.innerHTML = '';
    for (const aviso of estado.avisos.filter((a) => a.evento === mano.eventos.length - 1)) {
      const li = document.createElement('li');
      li.className = 'aviso';
      li.textContent = '⚠️ ' + aviso.texto;
      lista.appendChild(li);
    }

    // Botones
    if (estado.fase === 'accion') {
      const o = opciones(estado);
      mostrarBotones([o.fold && 'btn-fold', o.check && 'btn-check', o.call && 'btn-call',
        o.apostar && 'btn-apostar', o.subir && 'btn-subir'].filter(Boolean));
      $('btn-call').textContent = 'Call ' + formatear(o.aPagar);
    } else if (estado.fase === 'cartas') {
      mostrarBotones(['btn-cartas']);
      $('btn-cartas').textContent = 'Pasar al ' + estado.faltan;
    } else {
      mostrarBotones(['btn-siguiente']);
    }
    for (const id of BOTONES) $(id).disabled = false;
    $('btn-deshacer').hidden = false;
    $('btn-deshacer').disabled = !puedeDeshacer(mano.eventos);
  }

  // Texto de lo último que se anotó ("Ana paga 2"), para comprobar de un vistazo
  function describirUltimo() {
    const ev = mano.eventos[mano.eventos.length - 1];
    if (!ev || ev.tipo === 'ciega' || ev.tipo === 'ante') return 'Ciegas puestas.';
    if (ev.tipo === 'mesa') return NOMBRE_CALLE[ev.calle] + '.';
    const yo = esYo(ev.asiento);
    const cantidad = ev.hasta !== undefined ? ' (hasta ' + formatear(ev.hasta) + ')' : '';
    const n = ev.hasta !== undefined ? formatear(ev.hasta) : '';
    const textos = yo
      ? { fold: 'te retiras', check: 'pasas', call: 'pagas' + cantidad,
        apuesta: 'apuestas ' + n, subida: 'subes hasta ' + n, allin: 'vas all-in' + cantidad }
      : { fold: 'se retira', check: 'pasa', call: 'paga' + cantidad,
        apuesta: 'apuesta ' + n, subida: 'sube hasta ' + n, allin: 'va all-in' + cantidad };
    return 'Último: ' + nombreEnMano(ev.asiento) + ' ' + (textos[ev.accion] || ev.accion) + '.';
  }

  // Mesa ovalada: asientos, ficha del botón (D) y lo puesto en esta calle
  function pintarOvalo(asientos, miAsiento, boton) {
    ovalo.querySelectorAll('.asiento-mesa, .ficha-boton, .apuesta-mesa').forEach((el) => el.remove());
    const n = asientos.length;
    asientos.forEach((a, i) => {
      const p = posicionEnMesa(i, n, miAsiento);
      const div = document.createElement('div');
      div.className = 'asiento-mesa asiento-mano';
      div.style.left = p.x + '%';
      div.style.top = p.y + '%';
      div.classList.toggle('yo', i === miAsiento);
      div.classList.toggle('turno', Boolean(a.turno));
      div.classList.toggle('retirado', Boolean(a.retirado));
      div.classList.toggle('no-juega', Boolean(a.fuera));

      const etiqueta = document.createElement('span');
      etiqueta.className = 'asiento-posicion';
      etiqueta.textContent = a.posicion || '';
      etiqueta.hidden = !a.posicion;
      div.appendChild(etiqueta);

      const nombre = document.createElement('span');
      nombre.className = 'asiento-nombre';
      nombre.textContent = a.nombre;
      div.appendChild(nombre);

      if (a.allin || (a.fichas !== null && a.fichas !== undefined)) {
        const fichas = document.createElement('span');
        fichas.className = 'asiento-fichas';
        fichas.textContent = a.allin ? 'all-in' : formatear(a.fichas);
        div.appendChild(fichas);
      }
      ovalo.appendChild(div);

      if (a.puesto > 0) {
        const chip = document.createElement('span');
        chip.className = 'apuesta-mesa';
        chip.textContent = formatear(a.puesto);
        chip.style.left = (50 + (p.x - 50) * 0.5) + '%';
        chip.style.top = (50 + (p.y - 50) * 0.5) + '%';
        ovalo.appendChild(chip);
      }
      if (i === boton) {
        const ficha = document.createElement('span');
        ficha.className = 'ficha-boton';
        ficha.textContent = 'D';
        ficha.style.left = (50 + (p.x - 50) * 0.66) + '%';
        ficha.style.top = (50 + (p.y - 50) * 0.66) + '%';
        ficha.setAttribute('aria-hidden', 'true');
        ovalo.appendChild(ficha);
      }
    });
  }

  function avisarFallo(error) {
    console.error(error);
    mostrarError(error instanceof ErrorBD ? error.message : 'Error inesperado en la mano: ' + error.message);
  }

  // Nada queda pendiente (cada acción se guarda al momento), así que no hace falta guardarYa.
  // Una cantidad a medio teclear no es una acción: si sales, se descarta.
  return { alEntrar: cargar, alSalir: () => teclado.cerrar() };
}

function formatear(n) {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}
