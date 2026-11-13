// mesa.js: lógica de la mesa (sin pantalla, con tests).
//
// Mientras preparas o editas la mesa se trabaja con un "borrador":
//   {
//     numJugadores: 6,
//     ciegasTexto: { sb: '1', bb: '2', ante: '' },  // tal y como están escritas en los campos
//     conFichas: false,
//     miAsiento: 0,      // índice del asiento donde estás tú
//     boton: 3,          // índice del asiento con el botón (D)
//     asientos: [{ asiento: 0, jugadorId: null, nombre: '', fichas: null, juega: true }, …]
//   }
// Los asientos van numerados 0, 1, 2… en el sentido de las agujas del reloj, que es el
// orden en que se habla en el póker (el siguiente asiento es el de tu izquierda).
//
// Al empezar la partida, el borrador se convierte en una "partida" (ver plan 2.5) y los
// nombres nuevos se convierten en jugadores guardados, para que su perfil se acumule.
//
// Las funciones devuelven objetos NUEVOS en lugar de modificar el que reciben: así es más
// fácil de probar y no hay sorpresas.

import { validarCiegas } from './ajustes.js';
import { asientosQueJuegan, botonEfectivo } from './posiciones.js';

export const MIN_JUGADORES = 2;
export const MAX_JUGADORES = 9;

function asientoVacio(i) {
  return { asiento: i, jugadorId: null, nombre: '', fichas: null, juega: true };
}

/** Borrador de una mesa nueva. */
export function crearBorrador(numJugadores, ciegas) {
  const n = limitar(numJugadores);
  return {
    numJugadores: n,
    ciegasTexto: {
      sb: aTexto(ciegas.sb),
      bb: aTexto(ciegas.bb),
      ante: ciegas.ante ? aTexto(ciegas.ante) : '',
    },
    conFichas: false,
    miAsiento: 0,
    boton: 0,
    asientos: Array.from({ length: n }, (_, i) => asientoVacio(i)),
  };
}

/**
 * Cambia el número de jugadores. Los asientos nuevos se añaden al final; al quitar, se quita
 * el último asiento vacío (o, si no hay vacíos, el último que no sea el tuyo).
 */
export function cambiarNumJugadores(borrador, n) {
  n = limitar(n);
  const asientos = borrador.asientos.map((a) => ({ ...a }));
  let mi = borrador.miAsiento;
  let boton = borrador.boton;

  while (asientos.length < n) asientos.push(asientoVacio(asientos.length));

  while (asientos.length > n) {
    let quitar = -1;
    for (let i = asientos.length - 1; i >= 0; i--) {
      if (i !== mi && !asientos[i].nombre && !asientos[i].jugadorId) { quitar = i; break; }
    }
    if (quitar < 0) {
      for (let i = asientos.length - 1; i >= 0; i--) {
        if (i !== mi) { quitar = i; break; }
      }
    }
    asientos.splice(quitar, 1);
    if (mi > quitar) mi--;
    if (boton > quitar) boton--;
    else if (boton === quitar) boton = quitar % asientos.length; // el botón pasa al siguiente asiento
  }

  asientos.forEach((a, i) => { a.asiento = i; });
  return { ...borrador, numJugadores: n, asientos, miAsiento: mi, boton };
}

/** Te sientas en el asiento j. Quien estuviera ahí pasa a tu asiento anterior (se intercambian). */
export function sentarme(borrador, j) {
  const asientos = borrador.asientos.map((a) => ({ ...a }));
  const mi = borrador.miAsiento;
  if (j === mi) return borrador;
  const { asiento: _a, ...datosMios } = asientos[mi];
  const { asiento: _b, ...datosSuyos } = asientos[j];
  asientos[mi] = { ...datosSuyos, asiento: mi };
  asientos[j] = { ...datosMios, asiento: j };
  return { ...borrador, asientos, miAsiento: j };
}

export function ponerBoton(borrador, j) {
  return { ...borrador, boton: j };
}

/**
 * Marca si el asiento j juega las próximas manos (alguien se ausenta un rato o vuelve).
 * Si el que tenía el botón deja de jugar, el botón pasa al siguiente que juega.
 */
export function cambiarJuega(borrador, j, juega) {
  const nuevo = cambiarAsiento(borrador, j, { juega });
  if (!juega && j === borrador.boton) {
    const siguiente = botonEfectivo(nuevo.asientos, j);
    if (siguiente !== null) nuevo.boton = siguiente;
  }
  return nuevo;
}

/** Cambia datos de un asiento (nombre, jugadorId, fichas…). */
export function cambiarAsiento(borrador, j, cambios) {
  const asientos = borrador.asientos.map((a, i) => (i === j ? { ...a, ...cambios } : a));
  return { ...borrador, asientos };
}

/** Pone las mismas fichas a todos los asientos. */
export function fichasParaTodos(borrador, fichas) {
  return { ...borrador, asientos: borrador.asientos.map((a) => ({ ...a, fichas })) };
}

/** Nombre que se muestra para un asiento. */
export function nombreDeAsiento(borrador, i) {
  if (i === borrador.miAsiento) return 'Tú';
  return borrador.asientos[i].nombre.trim() || 'Asiento ' + (i + 1);
}

/**
 * Posición del asiento en la mesa ovalada, en % del ancho y del alto.
 * Tu asiento siempre queda abajo en el centro; los siguientes van hacia tu izquierda
 * (sentido de las agujas del reloj visto desde arriba).
 */
export function posicionEnMesa(asiento, n, miAsiento) {
  const relativo = (asiento - miAsiento + n) % n;
  const angulo = ((90 + (relativo * 360) / n) * Math.PI) / 180; // 90° = abajo
  return {
    x: redondear(50 + 40 * Math.cos(angulo)),
    y: redondear(50 + 41 * Math.sin(angulo)),
  };
}

/**
 * Comprueba si la mesa se puede guardar.
 * errores: impiden empezar · avisos: se puede empezar igualmente.
 */
export function validarMesa(borrador) {
  const errores = [];
  const avisos = [];

  const ciegas = validarCiegas(borrador.ciegasTexto.sb, borrador.ciegasTexto.bb, borrador.ciegasTexto.ante);
  if (ciegas.error) errores.push(ciegas.error);
  else if (ciegas.aviso) avisos.push(ciegas.aviso);

  if (asientosQueJuegan(borrador.asientos).length < 2) {
    errores.push('Tienen que jugar al menos 2 jugadores.');
  }

  // El mismo nombre en dos asientos
  const vistos = new Map();
  borrador.asientos.forEach((a, i) => {
    if (i === borrador.miAsiento) return;
    const clave = normalizar(a.nombre);
    if (!clave) return;
    if (vistos.has(clave)) errores.push(`"${a.nombre.trim()}" está en dos asientos.`);
    else vistos.set(clave, i);
  });

  if (borrador.conFichas) {
    const sinFichas = borrador.asientos
      .filter((a) => !(a.fichas > 0))
      .map((a) => nombreDeAsiento(borrador, a.asiento));
    if (sinFichas.length) errores.push('Faltan las fichas de: ' + sinFichas.join(', ') + '.');
  }

  const sinNombre = borrador.asientos.filter((a, i) => i !== borrador.miAsiento && !a.nombre.trim()).length;
  if (sinNombre) {
    avisos.push(sinNombre === 1
      ? 'Hay 1 asiento sin nombre: de ese jugador no se guardará perfil.'
      : `Hay ${sinNombre} asientos sin nombre: de esos jugadores no se guardará perfil.`);
  }

  return { errores, avisos };
}

/**
 * Asigna a cada asiento su jugador guardado. Los nombres que ya existen (sin distinguir
 * mayúsculas ni espacios) reutilizan su jugador; los nuevos se crean.
 *  - conocidos: lista de jugadores guardados [{ id, nombre }]
 *  - nuevoId: función que genera un id (en la app, crypto.randomUUID)
 * Devuelve { asientos: [{ asiento, jugadorId, fichas, juega }], nuevos: [jugadores a guardar] }.
 */
export function resolverJugadores(borrador, conocidos, nuevoId, ahora) {
  // Tu propio jugador ("yo") nunca se busca por nombre: un rival que se llame "Yo"
  // (o como tú) es otra persona y no debe mezclarse contigo
  const porNombre = new Map(conocidos
    .filter((j) => j.id !== 'yo')
    .map((j) => [normalizar(j.nombre), j]));
  const nuevos = [];

  const asientos = borrador.asientos.map((a, i) => {
    let jugadorId = null;
    if (i === borrador.miAsiento) {
      jugadorId = 'yo';
    } else if (a.nombre.trim()) {
      const conocido = porNombre.get(normalizar(a.nombre));
      if (conocido) {
        jugadorId = conocido.id;
      } else {
        const nuevo = { id: nuevoId(), nombre: a.nombre.trim().replace(/\s+/g, ' '), creado: ahora, notas: '' };
        nuevos.push(nuevo);
        porNombre.set(normalizar(nuevo.nombre), nuevo);
        jugadorId = nuevo.id;
      }
    }
    return {
      asiento: i,
      jugadorId,
      fichas: borrador.conFichas ? a.fichas : null,
      juega: a.juega !== false,
    };
  });

  return { asientos, nuevos };
}

/** Crea la partida (lo que se guarda en la base de datos) a partir del borrador ya validado. */
export function crearPartida(borrador, asientos, id, ahora) {
  return {
    id,
    formato: 1,
    creada: ahora,
    terminada: null,
    estado: 'en-curso',
    ciegas: leerCiegas(borrador),
    conFichas: borrador.conFichas,
    asientos,
    miAsiento: borrador.miAsiento,
    boton: borrador.boton,
    manosJugadas: 0,
  };
}

/** Aplica a una partida ya empezada los cambios hechos en el borrador (editar la mesa). */
export function actualizarPartida(partida, borrador, asientos) {
  return {
    ...partida,
    ciegas: leerCiegas(borrador),
    conFichas: borrador.conFichas,
    asientos,
    miAsiento: borrador.miAsiento,
    boton: borrador.boton,
  };
}

/** Borrador para editar una partida guardada. nombres: Map jugadorId → nombre. */
export function borradorDePartida(partida, nombres) {
  return {
    numJugadores: partida.asientos.length,
    ciegasTexto: {
      sb: aTexto(partida.ciegas.sb),
      bb: aTexto(partida.ciegas.bb),
      ante: partida.ciegas.ante ? aTexto(partida.ciegas.ante) : '',
    },
    conFichas: partida.conFichas,
    miAsiento: partida.miAsiento,
    boton: partida.boton,
    asientos: partida.asientos.map((a) => ({
      asiento: a.asiento,
      jugadorId: a.jugadorId === 'yo' ? null : a.jugadorId,
      nombre: a.jugadorId && a.jugadorId !== 'yo' ? (nombres.get(a.jugadorId) || '') : '',
      fichas: a.fichas,
      juega: a.juega !== false,
    })),
  };
}

/** "Ana  López " → "ana lópez" (para comparar nombres). */
export function normalizar(nombre) {
  return String(nombre || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

function leerCiegas(borrador) {
  return validarCiegas(borrador.ciegasTexto.sb, borrador.ciegasTexto.bb, borrador.ciegasTexto.ante).ciegas;
}

function limitar(n) {
  return Math.min(MAX_JUGADORES, Math.max(MIN_JUGADORES, n));
}

function aTexto(n) {
  return String(n).replace('.', ',');
}

function redondear(x) {
  return Math.round(x * 10) / 10;
}
