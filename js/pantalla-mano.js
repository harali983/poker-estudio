// pantalla-mano.js: registrar la mano en curso.
//
// Tres situaciones:
//  - Entre manos: la mesa con las posiciones de la próxima mano y "Empezar mano N".
//    (Es el momento de editar la mesa: quién juega, fichas, quién se sienta…)
//  - Mano en curso: a quién le toca, el bote, las acciones (Fold, Check, Call, Apostar, Subir),
//    Deshacer y la fila de cartas (la mesa y las tuyas). Al cerrarse una calle,
//    "Poner el flop/turn/river" abre la hoja de cartas.
//  - Mano terminada: el resultado y "Siguiente mano" (el botón avanza).
//
// Regla de guardado: cada toque → se guarda la mano en la base de datos → se pinta.
// Sin temporizadores: si iOS cierra la app, lo que se ve en pantalla ya está guardado.

import {
  calcularEstado, opciones, eventoDeAccion, eventoDeMesa, deshacer, puedeDeshacer,
  cartasPorCalle, mesaPorCalle, cambiarCartasDeMesa, cartasConocidas,
} from './motor.js';
import { crearHojaCartas } from './hoja-cartas.js';
import { VALORES_TEXTO, SIMBOLOS, NOMBRES_PALOS, valorDe, paloDe } from './cartas.js';
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
      bb: mano.ciegas.bb,
      alAnotar(hasta, allin) {
        if (!mano || mano.eventos.length !== eventosAntes) return; // la mano cambió mientras tanto
        cambiarEventos([...mano.eventos, eventoDeAccion(estado, accionDeCantidad(estado, allin), hasta)]);
      },
    });
  }
  $('btn-apostar').addEventListener('click', pedirCantidad);
  $('btn-subir').addEventListener('click', pedirCantidad);

  // ---- Cartas: las tuyas y las de la mesa, con la hoja de cartas (la misma que la calculadora) ----
  // Al cerrarse una calle, "Poner el flop/turn/river" abre la hoja. Las cartas ya puestas se
  // tocan para cambiarlas. Tus cartas se pueden poner o cambiar en cualquier momento.
  const hojaCartas = crearHojaCartas($('hoja-cartas-mano'), { noCerrarEn: '.carta-mini' });
  let eligiendo = null; // { tipo: 'mias' | 'mesa', calle, nueva, cartas: [...], indice, soloUna }

  $('btn-cartas').addEventListener('click', () => {
    if (!mano) return;
    const estado = calcularEstado(mano);
    if (estado.fase === 'cartas') abrirCalle(estado.faltan, 0);
  });

  function abrirMias(i) {
    const actuales = [...(mano.misCartas || [])];
    // Una carta ya puesta se cambia ella sola; si falta alguna, se rellenan en orden
    const soloUna = i < actuales.length && actuales.length === 2;
    eligiendo = { tipo: 'mias', cartas: actuales, indice: soloUna ? i : actuales.length, soloUna };
    abrirHoja();
  }

  function abrirCalle(calle, i) {
    const anotadas = mesaPorCalle(mano.eventos)[calle];
    const total = cartasPorCalle(calle);
    if (anotadas === null) {
      // La calle que toca poner: se elige entera y se anota de una vez
      eligiendo = { tipo: 'mesa', calle, nueva: true, cartas: [], indice: 0, soloUna: false };
    } else {
      const completa = anotadas.length === total;
      eligiendo = { tipo: 'mesa', calle, nueva: false, cartas: completa ? [...anotadas] : [],
        indice: completa ? i : 0, soloUna: completa };
    }
    abrirHoja();
  }

  // Título de la hoja. Como la hoja tapa la fila de cartas, lleva las ya elegidas en esta
  // tanda: "Flop: A♠ K♦ · 3ª carta"
  function tituloEligiendo() {
    const e = eligiendo;
    const antes = e.soloUna ? [] : e.cartas.slice(0, e.indice);
    const elegidas = antes.length ? ': ' + antes.map(textoCarta).join(' ') : '';
    if (e.tipo === 'mias') return `Tus cartas${elegidas} · ${e.indice + 1}ª`;
    if (e.calle === 'flop') return `Flop${elegidas} · ${e.indice + 1}ª carta`;
    return NOMBRE_CALLE[e.calle];
  }

  function textoCarta(c) {
    return VALORES_TEXTO[valorDe(c)] + SIMBOLOS[paloDe(c)];
  }

  // Cartas que no se pueden elegir: todas las conocidas, menos las que se están eligiendo
  // (que se recogen aparte), más las ya elegidas en esta tanda (menos la que se cambia)
  function usadasEligiendo() {
    const propias = eligiendo.tipo === 'mias'
      ? (mano.misCartas || [])
      : (mesaPorCalle(mano.eventos)[eligiendo.calle] || []);
    const usadas = new Set(cartasConocidas(mano));
    for (const c of propias) usadas.delete(c);
    eligiendo.cartas.forEach((c, k) => { if (k !== eligiendo.indice && c !== undefined) usadas.add(c); });
    return usadas;
  }

  function opcionesHoja() {
    const botones = [];
    if (eligiendo.tipo === 'mias') {
      botones.push({ texto: 'Quitar', desactivado: !(mano.misCartas || []).length, alTocar: quitarMias });
      botones.push({ texto: 'Listo', acento: true, alTocar: () => hojaCartas.cerrar() });
    } else {
      if (eligiendo.nueva) botones.push({ texto: 'Sin cartas', alTocar: calleSinCartas });
      botones.push({ texto: 'Cancelar', alTocar: () => hojaCartas.cerrar() });
    }
    return {
      titulo: tituloEligiendo(),
      usadas: usadasEligiendo(),
      botones,
      alElegir: cartaElegida,
      alCerrar: () => { eligiendo = null; pintarCartas(); },
    };
  }

  function abrirHoja() {
    teclado.cerrar();
    if (hojaCartas.estaAbierta()) hojaCartas.actualizar(opcionesHoja());
    else hojaCartas.abrir(opcionesHoja());
    pintarCartas();
  }

  function cartaElegida(c) {
    const e = eligiendo;
    e.cartas[e.indice] = c;
    if (e.tipo === 'mias') {
      // Tus cartas se guardan una a una (no son una acción: Deshacer no las quita)
      guardarCartas({ ...mano, misCartas: e.cartas.filter((x) => x !== undefined) });
      if (e.soloUna || e.cartas.length >= 2) { hojaCartas.cerrar(); return; }
      e.indice++;
      hojaCartas.actualizar(opcionesHoja());
      return;
    }
    const total = cartasPorCalle(e.calle);
    if (!e.soloUna && e.cartas.length < total) {
      e.indice++;
      hojaCartas.actualizar(opcionesHoja());
      pintarCartas();
      return;
    }
    // Calle completa: se anota (nueva) o se corrige (ya anotada)
    const eventos = e.nueva
      ? [...mano.eventos, eventoDeMesa(calcularEstado(mano), e.cartas)]
      : cambiarCartasDeMesa(mano.eventos, e.calle, e.cartas);
    hojaCartas.cerrar();
    if (e.nueva) cambiarEventos(eventos);
    else guardarCartas({ ...mano, eventos });
  }

  function calleSinCartas() {
    const estado = calcularEstado(mano);
    hojaCartas.cerrar();
    if (estado.fase === 'cartas') cambiarEventos([...mano.eventos, eventoDeMesa(estado, [])]);
  }

  function quitarMias() {
    hojaCartas.cerrar();
    guardarCartas({ ...mano, misCartas: [] });
  }

  // Guarda un cambio de cartas (no es una acción nueva) y lo pinta al terminar.
  // Las escrituras de IndexedDB se hacen en orden, así que dos cartas seguidas no se pisan.
  function guardarCartas(nueva) {
    guardarMano(nueva).then(() => {
      if (mano && mano.id === nueva.id) mano = nueva;
      pintar();
    }, avisarFallo);
  }

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
    hojaCartas.cerrar();
    pintarCartas();
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
      $('btn-cartas').textContent = 'Poner el ' + estado.faltan;
    } else {
      mostrarBotones(['btn-siguiente']);
    }
    for (const id of BOTONES) $(id).disabled = false;
    $('btn-deshacer').hidden = false;
    $('btn-deshacer').disabled = !puedeDeshacer(mano.eventos);
    pintarCartas();
  }

  // Fila de cartas: Mesa [flop][flop][flop] [turn] [river] · Tú [][]
  function pintarCartas() {
    const fila = $('fila-cartas');
    fila.hidden = !mano;
    if (!mano) return;
    const estado = calcularEstado(mano);
    const mesa = mesaPorCalle(mano.eventos);

    const contMesa = $('cartas-mesa');
    contMesa.innerHTML = '';
    const huecos = [['flop', 0], ['flop', 1], ['flop', 2], ['turn', 0], ['river', 0]];
    for (const [calle, i] of huecos) {
      const anotadas = mesa[calle];
      const pendiente = anotadas === null && estado.fase === 'cartas' && estado.faltan === calle;
      const eligiendoAqui = eligiendo && eligiendo.tipo === 'mesa' && eligiendo.calle === calle;
      // Mientras se elige, se ven las cartas de esta tanda
      const c = eligiendoAqui ? eligiendo.cartas[i] : (anotadas ? anotadas[i] : undefined);
      const nombre = calle === 'flop' ? `Flop, ${i + 1}ª carta` : NOMBRE_CALLE[calle];
      const b = cartaMini(c, nombre, () => abrirCalle(calle, i));
      if (calle === 'flop' && i === 2) b.classList.add('flop-ultima');
      if (calle === 'turn') b.classList.add('turn');
      b.classList.toggle('pendiente', pendiente || (eligiendoAqui && eligiendo.indice === i));
      if (anotadas && anotadas.length === 0 && !eligiendoAqui) b.classList.add('sin-anotar');
      // Una calle que aún no ha llegado (y no es la que toca) no se puede tocar
      b.disabled = anotadas === null && !pendiente;
      contMesa.appendChild(b);
    }

    const contMias = $('cartas-mias');
    contMias.innerHTML = '';
    const juego = mano.jugadores.some((j) => j.jugadorId === 'yo');
    $('etiqueta-mias').hidden = !juego;
    contMias.hidden = !juego;
    if (!juego) return;
    const mias = eligiendo && eligiendo.tipo === 'mias' ? eligiendo.cartas : (mano.misCartas || []);
    for (let i = 0; i < 2; i++) {
      const b = cartaMini(mias[i], `Tu ${i + 1}ª carta`, () => abrirMias(i));
      b.classList.toggle('pendiente', Boolean(eligiendo && eligiendo.tipo === 'mias' && eligiendo.indice === i));
      contMias.appendChild(b);
    }
  }

  function cartaMini(c, nombre, alTocar) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'carta-mini';
    if (c === undefined || c === null) {
      b.classList.add('vacia');
      b.setAttribute('aria-label', nombre + ': sin poner');
    } else {
      b.innerHTML = '<span class="carta-valor">' + VALORES_TEXTO[valorDe(c)] + '</span>' +
        '<span class="carta-palo">' + SIMBOLOS[paloDe(c)] + '</span>';
      b.classList.add('palo-' + paloDe(c));
      b.setAttribute('aria-label', nombre + ': ' + VALORES_TEXTO[valorDe(c)] + ' de ' + NOMBRES_PALOS[paloDe(c)]);
    }
    b.addEventListener('click', alTocar);
    return b;
  }

  // Texto de lo último que se anotó ("Ana paga 2"), para comprobar de un vistazo
  function describirUltimo() {
    const ev = mano.eventos[mano.eventos.length - 1];
    if (!ev || ev.tipo === 'ciega' || ev.tipo === 'ante') return 'Ciegas puestas.';
    if (ev.tipo === 'mesa') {
      return NOMBRE_CALLE[ev.calle] + (ev.cartas && ev.cartas.length
        ? ': ' + ev.cartas.map(textoCarta).join(' ') + '.'
        : ' (sin anotar las cartas).');
    }
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
  return {
    alEntrar: cargar,
    alSalir: () => { teclado.cerrar(); hojaCartas.cerrar(); },
  };
}

function formatear(n) {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}
