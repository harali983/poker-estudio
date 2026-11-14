// pantalla-mano.js: registrar la mano en curso.
//
// Tres situaciones:
//  - Entre manos: la mesa con las posiciones de la próxima mano y "Empezar mano N".
//    (Es el momento de editar la mesa: quién juega, fichas, quién se sienta…)
//  - Mano en curso: a quién le toca, el bote, las acciones (Fold, Check, Call, Apostar, Subir),
//    Deshacer y la fila de cartas (la mesa y las tuyas). Al cerrarse una calle,
//    "Poner el flop/turn/river" abre la hoja de cartas.
//  - Mano terminada: el resultado (quién gana cuánto) y "Siguiente mano", que la cierra:
//    guarda el final, las fichas, las participaciones y la partida a la vez, y el botón avanza.
//    En el showdown se elige antes quién gana (uno o varios) y, si se quiere, las cartas que
//    se mostraron. Lo elegido se guarda al momento en mano.cierre.
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
import { manoEnCurso, empezarMano, guardarMano, terminarMano, pedirMisCartas } from './manos.js';
import { calcularFinal, faltanGanadores, ganadoresPorBote } from './final.js';
import { describirMano } from './describir.js';
import { pintarJugada } from './pantalla-calculadora.js';
import { crearTeclado, pasoDeCiegas, accionDeCantidad, tamanoRapido } from './teclado.js';
import { recomendar, spr, potOdds, AVISO_RANGOS, AVISO_PREFLOP, NOMBRE_CONSEJO } from './recomendacion.js';
import { recomendarPreflop, rangosDeRivales, decidirAnteAllin } from './preflop.js';
import { combosDeRango } from './rangos.js';
import { ErrorBD } from './db.js';
import { mostrarError } from './avisos.js';

const NOMBRE_CALLE = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
const MESA_POR_CALLE = { preflop: 0, flop: 3, turn: 4, river: 5 };
const BOTON_DE_CONSEJO = { fold: 'btn-fold', check: 'btn-check', call: 'btn-call', apostar: 'btn-apostar', subir: 'btn-subir', allin: 'btn-subir' };
const BOTONES = ['btn-fold', 'btn-check', 'btn-call', 'btn-apostar', 'btn-subir',
  'btn-cartas', 'btn-siguiente', 'btn-empezar-mano'];

export function iniciarMano() {
  const $ = (id) => document.getElementById(id);
  const ovalo = $('mano-ovalo');

  let partida = null;
  let mano = null;          // mano en curso (null = entre manos)
  let nombres = new Map();  // jugadorId → nombre
  let ocupado = false;      // guardando: se ignoran más toques hasta terminar
  let ultimoResultado = null; // { partidaId, texto }: resultado de la mano anterior (se ve entre manos)

  async function cargar() {
    try {
      partida = await partidaEnCurso();
      if (!partida || !ultimoResultado || ultimoResultado.partidaId !== partida.id) ultimoResultado = null;
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
  // "extra": otros campos de la mano que se guardan a la vez (p. ej. las decisiones)
  async function cambiarEventos(eventos, extra = {}) {
    if (ocupado) return;
    ocupado = true;
    const nueva = { ...mano, eventos, ...extra };
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
    cambiarEventos([...mano.eventos, eventoDeAccion(estado, nombre)], conDecision(estado));
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
        cambiarEventos([...mano.eventos, eventoDeAccion(estado, accionDeCantidad(estado, allin), hasta)], conDecision(estado));
      },
    });
  }
  $('btn-apostar').addEventListener('click', pedirCantidad);
  $('btn-subir').addEventListener('click', pedirCantidad);

  // ---- Cartas: las tuyas y las de la mesa, con la hoja de cartas (la misma que la calculadora) ----
  // Al cerrarse una calle, "Poner el flop/turn/river" abre la hoja. Las cartas ya puestas se
  // tocan para cambiarlas. Tus cartas se pueden poner o cambiar en cualquier momento.
  const hojaCartas = crearHojaCartas($('hoja-cartas-mano'), { noCerrarEn: '.carta-mini' });
  let eligiendo = null; // { tipo: 'mias' | 'mesa' | 'mostradas', calle, asiento, nueva, cartas: [...], indice, soloUna }

  $('btn-cartas').addEventListener('click', () => {
    if (!mano) return;
    const estado = calcularEstado(mano);
    if (estado.fase === 'cartas') abrirCalle(estado.faltan, 0);
  });

  function abrirMias(i, { alEmpezar = false } = {}) {
    const actuales = [...(mano.misCartas || [])];
    // Una carta ya puesta se cambia ella sola; si falta alguna, se rellenan en orden
    const soloUna = i < actuales.length && actuales.length === 2;
    eligiendo = { tipo: 'mias', cartas: actuales, indice: soloUna ? i : actuales.length, soloUna, alEmpezar };
    abrirHoja();
  }

  // Cartas que mostró un rival en el showdown (opcionales)
  function abrirMostradas(asiento, i) {
    const actuales = [...mostradasDe(asiento)];
    const soloUna = i < actuales.length && actuales.length === 2;
    eligiendo = { tipo: 'mostradas', asiento, cartas: actuales, indice: soloUna ? i : actuales.length, soloUna };
    abrirHoja();
  }

  // Lo elegido en el showdown (ganadores y cartas mostradas), guardado en la mano hasta cerrarla
  function cierreActual() {
    return { ganadores: [], mostradas: [], ...(mano.cierre || {}) };
  }
  function mostradasDe(asiento) {
    const m = cierreActual().mostradas.find((x) => x.asiento === asiento);
    return m ? m.cartas : [];
  }
  function guardarCierre(cambios) {
    guardarCartas({ ...mano, cierre: { ...cierreActual(), ...cambios } });
  }
  function ponerMostradas(asiento, cartas) {
    const otras = cierreActual().mostradas.filter((x) => x.asiento !== asiento);
    guardarCierre({ mostradas: cartas.length ? [...otras, { asiento, cartas }] : otras });
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
    if (e.tipo === 'mostradas') return `${nombreEnMano(e.asiento)} mostró${elegidas} · ${e.indice + 1}ª`;
    if (e.calle === 'flop') return `Flop${elegidas} · ${e.indice + 1}ª carta`;
    return NOMBRE_CALLE[e.calle];
  }

  function textoCarta(c) {
    return VALORES_TEXTO[valorDe(c)] + SIMBOLOS[paloDe(c)];
  }

  // Cartas que no se pueden elegir: todas las conocidas, menos las que se están eligiendo
  // (que se recogen aparte), más las ya elegidas en esta tanda (menos la que se cambia)
  function usadasEligiendo() {
    const propias = eligiendo.tipo === 'mias' ? (mano.misCartas || [])
      : eligiendo.tipo === 'mostradas' ? mostradasDe(eligiendo.asiento)
        : (mesaPorCalle(mano.eventos)[eligiendo.calle] || []);
    // También las que mostraron los demás en el showdown
    const usadas = new Set([...cartasConocidas(mano), ...cierreActual().mostradas.flatMap((m) => m.cartas)]);
    for (const c of propias) usadas.delete(c);
    eligiendo.cartas.forEach((c, k) => { if (k !== eligiendo.indice && c !== undefined) usadas.add(c); });
    return usadas;
  }

  function opcionesHoja() {
    const botones = [];
    if (eligiendo.tipo === 'mias') {
      botones.push({ texto: 'Quitar', desactivado: !(mano.misCartas || []).length, alTocar: quitarMias });
      // Al empezar la mano, "Saltar" para no ponerlas ahora (luego se tocan sus huecos)
      if (eligiendo.alEmpezar) botones.push({ texto: 'Saltar', alTocar: () => hojaCartas.cerrar() });
      else botones.push({ texto: 'Listo', acento: true, alTocar: () => hojaCartas.cerrar() });
    } else if (eligiendo.tipo === 'mostradas') {
      const asiento = eligiendo.asiento;
      botones.push({ texto: 'Quitar', desactivado: !mostradasDe(asiento).length,
        alTocar: () => { hojaCartas.cerrar(); ponerMostradas(asiento, []); } });
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
    if (e.tipo === 'mostradas') {
      ponerMostradas(e.asiento, e.cartas.filter((x) => x !== undefined));
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
    if (!mano || !puedeDeshacer(mano.eventos)) return;
    const eventos = deshacer(mano.eventos);
    // La decisión de una acción deshecha se quita con ella
    cambiarEventos(eventos, { decisiones: (mano.decisiones || []).filter((d) => d.evento < eventos.length) });
  });

  $('btn-siguiente').addEventListener('click', async () => {
    if (!mano || ocupado) return;
    const estado = calcularEstado(mano);
    if (estado.fase !== 'fin') return;
    const cierre = cierreActual();
    if (estado.motivoFin === 'showdown' && faltanGanadores(calcularFinal(mano, estado, cierre))) return;
    ocupado = true;
    hojaCartas.cerrar();
    try {
      const resultado = textoResultado(estado);
      const numero = mano.numero;
      partida = (await terminarMano(mano, partida, estado, cierre)).partida;
      ultimoResultado = { partidaId: partida.id, texto: `Mano ${numero}: ${resultado}` };
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
    // Como al poner el flop: se abre la hoja para tus cartas (si juegas esta mano)
    if (mano && pedirMisCartas(mano)) abrirMias(0, { alEmpezar: true });
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
    $('mano-tu-jugada').textContent = '';
    $('mano-estado').textContent = pos
      ? 'Antes de empezar puedes cambiar la mesa (quién juega, fichas…).'
      : 'Tienen que jugar al menos 2 jugadores: cambia la mesa.';
    $('mano-ultima').textContent = ultimoResultado ? ultimoResultado.texto + ' Guardada ✓'
      : (numero > 1 ? 'Mano ' + (numero - 1) + ' guardada ✓' : '');
    $('mano-avisos').innerHTML = '';

    mostrarBotones(['btn-empezar-mano']);
    $('btn-empezar-mano').textContent = 'Empezar mano ' + numero;
    $('btn-empezar-mano').disabled = !pos;
    $('btn-deshacer').hidden = true;
    hojaCartas.cerrar();
    pintarCartas();
    pintarTeToca(null);
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
    pintarTuJugada(estado);
    pintarTeToca(estado);

    // Qué pasa ahora
    let texto = '';
    if (estado.fase === 'accion') {
      const j = porAsiento.get(estado.turno);
      const quien = esYo(estado.turno) ? 'Te toca' : 'Le toca a ' + nombreEnMano(estado.turno);
      texto = `${quien} (${j.posicion})` +
        (estado.aPagar > 0 ? ` · paga ${formatear(estado.aPagar)}` : ' · puede pasar');
    } else if (estado.fase === 'cartas') {
      texto = `Se cierra el ${estado.calle}. Toca el ${estado.faltan}.`;
    } else {
      texto = textoResultado(estado);
    }
    $('mano-estado').textContent = texto;
    $('mano-ultima').textContent = describirUltimo();

    // Avisos del último evento (la app anota lo que pasó, aunque no cuadre)
    const lista = $('mano-avisos');
    lista.innerHTML = '';
    const avisos = estado.avisos.filter((a) => a.evento === mano.eventos.length - 1).map((a) => a.texto);
    for (const aviso of avisos) {
      const li = document.createElement('li');
      li.className = 'aviso';
      li.textContent = '⚠️ ' + aviso;
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
    // En el showdown, "Siguiente mano" espera a que se elija quién gana
    $('btn-siguiente').disabled = estado.fase === 'fin' && estado.motivoFin === 'showdown'
      && faltanGanadores(calcularFinal(mano, estado, cierreActual()));
    $('btn-deshacer').hidden = false;
    $('btn-deshacer').disabled = !puedeDeshacer(mano.eventos);
    pintarCartas();
  }

  // ---- Te toca: el consejo, la equidad, pot odds y SPR ----
  // Antes del flop, el consejo sale de las tablas por posición (preflop.js); la equidad es solo un
  // dato, contra el rango de los que ya han entrado. Ante un all-in, en cambio, decide la equidad
  // contra su rango frente a las pot odds (decidirAnteAllin). Después del flop, la regla de recomendacion.js
  // con la equidad contra el rango que se supone a cada rival vivo según lo que hizo antes del flop.
  // La equidad la calcula el worker de la calculadora. El resultado se guarda por situación (tus
  // cartas, la mesa y los rangos): si vuelve a tocarte sin que cambie nada, no se recalcula.
  let calculo = null; // { clave, worker, resultado }

  function situacion(estado) {
    if (!mano || estado.fase !== 'accion' || !esYo(estado.turno)) return null;
    const mias = mano.misCartas || [];
    if (mias.length !== 2) return { falta: 'Pon tus cartas (abajo, "Tú") para ver la recomendación.' };
    if (estado.mesa.length !== MESA_POR_CALLE[estado.calle]) return { falta: 'Faltan cartas de la mesa por anotar: sin recomendación.' };
    const preflop = estado.calle === 'preflop';
    // Antes del flop, la equidad solo contra los que ya han entrado; después, contra todos los vivos
    const rangos = rangosDeRivales(mano, estado.turno).filter((x) => !preflop || x.rango);
    const vistas = [...mias, ...estado.mesa];
    return {
      preflop,
      tabla: preflop ? recomendarPreflop(mano, mias) : null,
      clave: rangos.length ? JSON.stringify([mias, estado.mesa, rangos.map((x) => [x.asiento, x.motivo])]) : null,
      mias,
      mesa: estado.mesa,
      rivales: rangos.length,
      rangos: rangos.map((x) => (x.rango ? combosDeRango(x.rango, vistas) : null)),
    };
  }

  function asegurarCalculo(sit) {
    if (!sit.clave) { pararCalculo(); return; }
    if (calculo && calculo.clave === sit.clave) return;
    pararCalculo();
    const worker = new Worker(new URL('./equidad.worker.js', import.meta.url), { type: 'module' });
    const este = { clave: sit.clave, worker, resultado: null };
    calculo = este;
    worker.onmessage = (e) => {
      if (calculo !== este) return;
      este.resultado = e.data;
      if (e.data.terminado) { worker.terminate(); este.worker = null; }
      if (mano) pintarTeToca(calcularEstado(mano)); // solo el panel: no cierra el teclado ni la hoja
    };
    worker.onerror = (error) => {
      console.error('Error en el cálculo de la equidad:', error);
      if (calculo === este) { este.worker = null; este.error = true; if (mano) pintarTeToca(calcularEstado(mano)); }
    };
    worker.postMessage({ mias: sit.mias, mesa: sit.mesa, rivales: sit.rivales, rangos: sit.rangos });
  }

  function pararCalculo() {
    if (calculo && calculo.worker) calculo.worker.terminate();
    calculo = null;
  }

  // La recomendación para la situación actual, o null si todavía no hay equidad (después del flop)
  function recomendacionActual(estado) {
    const sit = situacion(estado);
    if (!sit || sit.falta) return null;
    const res = sit.clave && calculo && calculo.clave === sit.clave ? calculo.resultado : null;
    if (sit.preflop) {
      if (!sit.tabla) return null;
      if (sit.tabla.porEquidad) {
        // Ante un all-in: tu equidad contra su rango frente a las pot odds (hace falta el cálculo)
        if (!res) return null;
        const d = decidirAnteAllin(sit.tabla, res.equidad, estado.aPagar, estado.bote);
        return { ...d, potOdds: potOdds(estado.aPagar, estado.bote), destacar: false,
          equidad: res.equidad, manos: res.manos, terminado: res.terminado, rivales: sit.rivales };
      }
      return { ...sit.tabla, potOdds: potOdds(estado.aPagar, estado.bote), destacar: false,
        equidad: res ? res.equidad : null, manos: res ? res.manos : 0, terminado: res ? res.terminado : true, rivales: sit.rivales };
    }
    if (!res) return null;
    const o = opciones(estado);
    const r = recomendar({
      equidad: res.equidad,
      aPagar: estado.aPagar,
      bote: estado.bote,
      rivales: sit.rivales,
      calle: estado.calle,
      apuestaMaxima: estado.apuestaMaxima,
      bb: mano.ciegas.bb,
      puedeSubir: o.apostar || o.subir,
      hasta: tamanoRapido(estado, 2 / 3, pasoDeCiegas(mano.ciegas)).hasta,
    });
    return { ...r, equidad: res.equidad, margen: res.margen, manos: res.manos, terminado: res.terminado, rivales: sit.rivales };
  }

  // Lo que se te recomendó, para guardarlo con tu acción (mano.decisiones; se repasa en la Fase 3)
  function conDecision(estado) {
    const r = recomendacionActual(estado);
    if (!r) return {};
    const evento = mano.eventos.length;
    const decision = { evento, equidad: r.equidad, potOdds: r.potOdds, consejo: r.consejo, texto: r.texto, manos: r.manos };
    if (r.hasta !== null && r.hasta !== undefined) decision.hasta = r.hasta;
    if (r.fuente) { decision.fuente = r.fuente; decision.clase = r.clase; }
    return { decisiones: [...(mano.decisiones || []).filter((d) => d.evento < evento), decision] };
  }

  function pintarTeToca(estado) {
    const panel = $('te-toca');
    for (const id of Object.values(BOTON_DE_CONSEJO)) $(id).classList.remove('recomendado');
    const sit = estado ? situacion(estado) : null;
    panel.hidden = !sit;
    if (!sit) return;

    const consejo = $('te-toca-consejo');
    const datos = $('te-toca-datos');
    const texto = $('te-toca-texto');
    const aviso = $('te-toca-aviso');
    const yo = estado.jugadores.find((j) => esYo(j.asiento));
    const s = spr(estado, yo.asiento);
    const textoSpr = s === null ? '' : 'SPR ' + s.toLocaleString('es-ES', { maximumFractionDigits: 1 });
    consejo.className = 'consejo';
    aviso.textContent = sit.preflop ? AVISO_PREFLOP : AVISO_RANGOS;
    aviso.classList.remove('destacado');

    if (sit.falta) {
      consejo.textContent = 'Te toca';
      datos.textContent = textoSpr;
      texto.textContent = sit.falta;
      return;
    }
    asegurarCalculo(sit);
    const r = recomendacionActual(estado);
    if (!r) {
      consejo.textContent = 'Te toca';
      datos.textContent = textoSpr;
      texto.textContent = calculo && calculo.error ? 'No se ha podido calcular la equidad.' : 'Calculando tu equidad…';
      return;
    }
    consejo.textContent = NOMBRE_CONSEJO[r.consejo];
    consejo.classList.add('consejo-' + r.consejo);
    const pct = (x) => Math.round(x * 100) + ' %';
    const rivales = `${r.rivales} ${r.rivales === 1 ? 'rival' : 'rivales'}`;
    datos.textContent = [
      r.equidad === null ? '' : `Equidad ${pct(r.equidad)}${sit.preflop ? ' contra su rango' : ''}`,
      r.potOdds > 0 && r.equidad !== null ? `necesitas ${pct(r.potOdds)}` : '',
      sit.preflop ? '' : rivales,
      textoSpr,
      r.terminado ? '' : 'calculando…',
    ].filter(Boolean).join(' · ');
    texto.textContent = r.texto;
    aviso.classList.toggle('destacado', r.destacar);
    // All-in se anota con el teclado de Subir (o con Call, si no se puede subir: p. ej. si una
    // subida all-in incompleta no te reabre la acción)
    let boton = BOTON_DE_CONSEJO[r.consejo];
    if ($(boton).hidden && ['allin', 'subir', 'apostar'].includes(r.consejo)) boton = 'btn-call';
    $(boton).classList.add('recomendado');
  }

  // Qué mano tienes, debajo de la fila de cartas (si estás en la mano, vivo y con tus 2 cartas).
  // Si alguna calle se anotó sin cartas, se describe lo que se sabe, sin proyectos ni outs.
  function pintarTuJugada(estado) {
    const el = $('mano-tu-jugada');
    const yo = estado.jugadores.find((j) => esYo(j.asiento));
    if (!yo || !yo.vivo || (mano.misCartas || []).length !== 2) { el.textContent = ''; return; }
    const completa = estado.mesa.length === { preflop: 0, flop: 3, turn: 4, river: 5 }[estado.calle];
    const desc = describirMano(mano.misCartas, estado.mesa);
    if (!completa && desc) {
      Object.assign(desc, { textoProyectos: 'Faltan cartas de la mesa por anotar' });
    }
    pintarJugada(el, desc);
  }

  // Fila de cartas: Mesa [flop][flop][flop] [turn] [river] · Tú [][]
  function pintarCartas() {
    const fila = $('fila-cartas');
    fila.hidden = !mano;
    pintarShowdown(mano ? calcularEstado(mano) : null);
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

  // Showdown: una fila por jugador que llega. Se toca el nombre para marcar quién gana
  // (uno o varios: el bote se reparte) y los huecos para anotar las cartas que mostró.
  function pintarShowdown(estado) {
    const cont = $('showdown');
    cont.innerHTML = '';
    const visible = Boolean(estado) && estado.fase === 'fin' && estado.motivoFin === 'showdown';
    cont.hidden = !visible;
    if (!visible) return;
    const cierre = cierreActual();
    const ganan = new Set(cierre.ganadores);
    const final = calcularFinal(mano, estado, cierre);
    const cobra = new Map(final.ganadores.map((g) => [g.asiento, g.cantidad]));
    for (const asiento of estado.vivos) {
      const filaJ = document.createElement('div');
      filaJ.className = 'fila-showdown';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'boton boton-ganador';
      const gana = ganan.has(asiento);
      b.setAttribute('aria-pressed', String(gana));
      const pos = mano.jugadores.find((j) => j.asiento === asiento).posicion;
      b.textContent = (gana ? '🏆 ' : '') + nombreEnMano(asiento) + ' (' + pos + ')'
        + (cobra.has(asiento) ? ' · ' + formatear(cobra.get(asiento)) : '');
      b.addEventListener('click', () => {
        const nuevos = gana ? cierre.ganadores.filter((a) => a !== asiento) : [...cierre.ganadores, asiento];
        guardarCierre({ ganadores: nuevos });
      });
      filaJ.appendChild(b);

      const cartas = document.createElement('div');
      cartas.className = 'cartas-mini';
      const yo = esYo(asiento);
      const eligiendoAqui = eligiendo && eligiendo.tipo === (yo ? 'mias' : 'mostradas') && (yo || eligiendo.asiento === asiento);
      const mostradas = eligiendoAqui ? eligiendo.cartas : (yo ? (mano.misCartas || []) : mostradasDe(asiento));
      for (let i = 0; i < 2; i++) {
        const nombre = (yo ? 'Tu ' : 'Carta mostrada de ' + nombreEnMano(asiento) + ', ') + (i + 1) + 'ª';
        const c = cartaMini(mostradas[i], nombre, () => (yo ? abrirMias(i) : abrirMostradas(asiento, i)));
        c.classList.toggle('pendiente', Boolean(eligiendoAqui && eligiendo.indice === i));
        cartas.appendChild(c);
      }
      filaJ.appendChild(cartas);
      cont.appendChild(filaJ);
    }
    if (final.botes) pintarBotes(cont, estado, final, cierre);
  }

  // Botes secundarios: cada bote con lo que tiene y quién lo juega. El principal lo gana la mejor
  // mano (lo marcado arriba); un secundario lo ganan los mismos si lo juegan. Si no (p. ej. ganó
  // el all-in corto), se toca aquí quién gana ese bote.
  function pintarBotes(cont, estado, final, cierre) {
    const porBote = ganadoresPorBote(estado, cierre);
    final.botes.forEach((b, k) => {
      const caja = document.createElement('div');
      caja.className = 'bote-showdown';
      const p = document.createElement('p');
      const nombreBote = k === 0 ? 'Bote principal' : final.botes.length === 2 ? 'Bote secundario' : 'Bote secundario ' + k;
      const juegan = b.aptos.map(nombreEnMano).join(', ');
      const gana = b.ganadores.length ? ' → ' + b.ganadores.map((g) => nombreEnMano(g.asiento) + ' ' + formatear(g.cantidad)).join(' · ') : '';
      p.textContent = `${nombreBote} · ${formatear(b.cantidad)} · lo juegan ${juegan}${gana}`;
      caja.appendChild(p);
      const elegir = k > 0 && !porBote[k].heredado && b.aptos.length > 1;
      if (elegir) {
        const actuales = new Set(porBote[k].elegidos);
        if (!actuales.size) {
          const pide = document.createElement('p');
          pide.className = 'bote-pide';
          pide.textContent = '¿Quién gana este bote? (si empatan, varios)';
          caja.appendChild(pide);
        }
        for (const asiento of b.aptos) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'boton boton-ganador';
          const marcado = actuales.has(asiento);
          btn.setAttribute('aria-pressed', String(marcado));
          btn.textContent = (marcado ? '🏆 ' : '') + nombreEnMano(asiento);
          btn.addEventListener('click', () => {
            const nuevos = marcado ? [...actuales].filter((a) => a !== asiento) : [...actuales, asiento];
            guardarCierre({ botes: { ...(cierre.botes || {}), [k]: nuevos } });
          });
          caja.appendChild(btn);
        }
      }
      cont.appendChild(caja);
    });
  }

  // Quién gana cuánto (antes de cerrar la mano ya se ve cómo quedará)
  function textoResultado(estado) {
    const final = calcularFinal(mano, estado, cierreActual());
    if (!(cierreActual().ganadores || []).length && estado.motivoFin === 'showdown') {
      return `Showdown · bote ${formatear(estado.bote)}. Toca quién ` + (final.botes ? 'tiene la mejor mano' : 'gana') + ' (si empatan, varios).';
    }
    if (faltanGanadores(final)) {
      return `Showdown · bote ${formatear(estado.bote)}. Falta elegir quién gana un bote secundario.`;
    }
    let t;
    if (final.ganadores.length === 1) {
      const g = final.ganadores[0];
      t = esYo(g.asiento) ? `Ganas tú: te llevas ${formatear(g.cantidad)}.`
        : `Gana ${nombreEnMano(g.asiento)}: se lleva ${formatear(g.cantidad)}.`;
      if (final.motivo === 'retirada') t = 'Los demás se retiran. ' + t;
    } else {
      t = (final.botes ? 'Botes: ' : 'Bote repartido: ') + final.ganadores.map((g) => nombreEnMano(g.asiento) + ' ' + formatear(g.cantidad)).join(' · ') + '.';
    }
    if (final.devuelto) {
      const d = final.devuelto;
      t += esYo(d.asiento) ? ` Recuperas ${formatear(d.cantidad)} que nadie pagó.`
        : ` ${nombreEnMano(d.asiento)} recupera ${formatear(d.cantidad)} que nadie pagó.`;
    }
    return t;
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
    alSalir: () => { teclado.cerrar(); hojaCartas.cerrar(); pararCalculo(); },
  };
}

function formatear(n) {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}
