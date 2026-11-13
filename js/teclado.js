// teclado.js: teclado propio para las cantidades (Apostar, Subir, All-in).
//
// Es una hoja inferior, como el selector de cartas: más cómoda con el pulgar que el teclado
// del iPhone. Se teclean cifras y una coma decimal; en pantalla se ve "1.000" con el punto
// de miles. Se anota siempre "hasta X": el total que el jugador pone en esa calle.
//
// Las cuentas (tamaños rápidos, revisar la cantidad, teclear) son funciones puras con tests
// en tests/tests.html. crearTeclado() es la parte de la pantalla.

import { interpretarNumero } from './numeros.js';

export const MAX_DECIMALES = 2;

// ---------------------------------------------------------------- Cuentas (con tests)

/** Añade una tecla ('0'–'9', ',' o '⌫') al texto tecleado. */
export function teclear(texto, tecla) {
  if (tecla === '⌫') return texto.slice(0, -1);
  if (tecla === ',') {
    if (texto.includes(',')) return texto;
    return (texto || '0') + ',';
  }
  if (!/^\d$/.test(tecla)) return texto;
  const [, decimales] = texto.split(',');
  if (decimales !== undefined && decimales.length >= MAX_DECIMALES) return texto;
  if (texto === '0') return tecla;           // sin ceros a la izquierda
  if (texto.replace(',', '').length >= 9) return texto; // más que suficiente
  return texto + tecla;
}

/** Cómo se ve lo tecleado: "1000,5" → "1.000,5". */
export function formatearTecleado(texto) {
  if (!texto) return '0';
  const [entera, decimales] = texto.split(',');
  const conPuntos = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimales === undefined ? conPuntos : conPuntos + ',' + decimales;
}

/** Número → texto para teclear ("1000.5" → "1000,5"). */
export function numeroATecleado(n) {
  return String(Number(n.toFixed(MAX_DECIMALES))).replace('.', ',');
}

/** Lo tecleado → número (o null). */
export function leerTecleado(texto) {
  return texto ? interpretarNumero(texto.endsWith(',') ? texto.slice(0, -1) : texto) : null;
}

/** Redondeo de los tamaños rápidos: a la ficha más pequeña de las ciegas (1/2 → de 1 en 1; 0,5/1 → de 0,5 en 0,5). */
export function pasoDeCiegas(ciegas) {
  return ciegas.sb > 0 ? Math.min(ciegas.sb, ciegas.bb) : ciegas.bb;
}

function delTurno(estado) {
  return estado.jugadores.find((j) => j.asiento === estado.turno);
}

/** Lo máximo que puede poner el del turno en esta calle (su all-in), o null si no se llevan fichas. */
export function maximoAllin(estado) {
  const j = delTurno(estado);
  return j.fichas === null ? null : redondear(j.puesto + j.fichas);
}

/**
 * Tamaño rápido: apostar o subir una fracción del bote (½, ⅔, 1).
 * Al subir, primero se cuenta lo que hay que pagar: "subir el bote" = pagar y después
 * subir lo que habría en el bote tras pagar (la regla habitual del "pot raise").
 *   hasta = lo puesto + lo que paga + fracción × (bote + lo que paga)
 * Se redondea al paso de las ciegas, no baja de la subida mínima y no pasa del all-in.
 * Devuelve { hasta, allin, ajuste: null | 'minima' | 'allin' }.
 */
export function tamanoRapido(estado, fraccion, paso) {
  const j = delTurno(estado);
  const exacto = j.puesto + estado.aPagar + fraccion * (estado.bote + estado.aPagar);
  let hasta = redondear(Math.round(exacto / paso) * paso);
  let ajuste = null;
  if (hasta < estado.subidaMinima) {
    hasta = estado.subidaMinima;
    ajuste = 'minima';
  }
  const maximo = maximoAllin(estado);
  if (maximo !== null && hasta >= maximo) {
    return { hasta: maximo, allin: true, ajuste: hasta > maximo ? 'allin' : ajuste };
  }
  return { hasta, allin: false, ajuste };
}

/**
 * Revisa la cantidad tecleada antes de anotarla.
 *  - valor: número tecleado (o null) · allinElegido: se tocó "All-in" (sin fichas conocidas)
 * Devuelve { hasta, allin, puedeAnotar, aviso, error }:
 *  - error: no se puede anotar ("tiene que ser más de 6": para igualar está Call)
 *  - aviso: se puede anotar, pero no cuadra (menor que la mínima); el motor también lo apunta
 */
export function revisarCantidad(estado, valor, allinElegido = false) {
  const maximo = maximoAllin(estado);
  if (valor === null || valor <= 0) {
    return { hasta: null, allin: false, puedeAnotar: false, aviso: '', error: '' };
  }
  let hasta = valor;
  let aviso = '';
  if (maximo !== null && hasta >= maximo) {
    if (hasta > maximo) aviso = `Solo le quedan fichas hasta ${formatear(maximo)}: se anota all-in.`;
    hasta = maximo;
  }
  const allin = maximo !== null ? hasta === maximo : allinElegido;

  if (hasta <= estado.apuestaMaxima && !allin) {
    return { hasta, allin, puedeAnotar: false, aviso: '',
      error: `Tiene que ser más de ${formatear(estado.apuestaMaxima)}. Para igualar, usa Call.` };
  }
  if (hasta < estado.subidaMinima && !allin) {
    aviso = `Menor que la mínima (${formatear(estado.subidaMinima)}): se anotará con aviso.`;
  }
  return { hasta, allin, puedeAnotar: true, aviso, error: '' };
}

/** Qué acción del motor corresponde: 'allin', 'apuesta' (no había apuesta) o 'subida'. */
export function accionDeCantidad(estado, allin) {
  if (allin) return 'allin';
  return estado.apuestaMaxima === 0 ? 'apuesta' : 'subida';
}

function redondear(x) {
  return Number(x.toFixed(MAX_DECIMALES));
}

function formatear(n) {
  return n.toLocaleString('es-ES', { maximumFractionDigits: MAX_DECIMALES });
}

// ---------------------------------------------------------------- Pantalla

const TAMANOS = [
  { id: 'medio', fraccion: 1 / 2, texto: '½ bote' },
  { id: 'dostercios', fraccion: 2 / 3, texto: '⅔ bote' },
  { id: 'bote', fraccion: 1, texto: 'Bote' },
];

/**
 * Prepara la hoja del teclado (está en index.html, dentro de la pantalla de la mano).
 * abrir({ titulo, estado, paso, alAnotar(hasta, allin) })
 */
export function crearTeclado() {
  const $ = (id) => document.getElementById(id);
  const hoja = $('hoja-cantidad');
  const btnAnotar = $('cantidad-anotar');

  let abierta = null; // { titulo, estado, paso, alAnotar } mientras está abierta
  let texto = '';
  let allinElegido = false;

  // Teclas de cifras
  for (const tecla of hoja.querySelectorAll('[data-tecla]')) {
    tecla.addEventListener('click', () => pulsar(tecla.dataset.tecla));
  }
  // Tamaños rápidos y all-in
  for (const t of TAMANOS) {
    $('tamano-' + t.id).addEventListener('click', () => {
      if (!abierta) return;
      const r = tamanoRapido(abierta.estado, t.fraccion, abierta.paso);
      texto = numeroATecleado(r.hasta);
      allinElegido = false;
      pintar();
    });
  }
  $('tamano-allin').addEventListener('click', () => {
    if (!abierta) return;
    const maximo = maximoAllin(abierta.estado);
    allinElegido = true;
    if (maximo !== null) texto = numeroATecleado(maximo);
    pintar();
  });

  $('cantidad-cancelar').addEventListener('click', cerrar);
  btnAnotar.addEventListener('click', () => {
    if (!abierta) return;
    const r = revisarCantidad(abierta.estado, leerTecleado(texto), allinElegido);
    if (!r.puedeAnotar) return;
    const alAnotar = abierta.alAnotar;
    cerrar();
    alAnotar(r.hasta, r.allin);
  });

  // Tocar fuera de la hoja la cierra (pointerdown: Safari no lanza "click" en zonas no pulsables)
  document.addEventListener('pointerdown', (evento) => {
    if (!abierta || hoja.contains(evento.target)) return;
    cerrar();
  });
  // En el ordenador también se puede teclear
  document.addEventListener('keydown', (evento) => {
    if (!abierta) return;
    if (/^\d$/.test(evento.key)) pulsar(evento.key);
    else if (evento.key === ',' || evento.key === '.') pulsar(',');
    else if (evento.key === 'Backspace') pulsar('⌫');
    else if (evento.key === 'Enter') btnAnotar.click();
    else if (evento.key === 'Escape') cerrar();
    else return;
    evento.preventDefault();
  });

  function pulsar(tecla) {
    if (!abierta) return;
    texto = teclear(texto, tecla);
    // Si se teclea a mano, el "All-in" elegido solo se mantiene si no se llevan fichas
    if (maximoAllin(abierta.estado) !== null) allinElegido = false;
    pintar();
  }

  function abrir(opciones) {
    abierta = opciones;
    texto = '';
    allinElegido = false;
    for (const t of TAMANOS) {
      const r = tamanoRapido(opciones.estado, t.fraccion, opciones.paso);
      $('tamano-' + t.id).querySelector('small').textContent = r.allin ? 'all-in' : formatear(r.hasta);
    }
    const maximo = maximoAllin(opciones.estado);
    $('tamano-allin').querySelector('small').textContent = maximo === null ? '¿cuánto?' : formatear(maximo);
    hoja.classList.add('abierta');
    hoja.setAttribute('aria-hidden', 'false');
    pintar();
  }

  function cerrar() {
    abierta = null;
    hoja.classList.remove('abierta');
    hoja.setAttribute('aria-hidden', 'true');
  }

  function pintar() {
    const { estado } = abierta;
    const r = revisarCantidad(estado, leerTecleado(texto), allinElegido);
    $('cantidad-titulo').textContent = abierta.titulo;
    $('cantidad-valor').textContent = formatearTecleado(texto);
    const j = delTurno(estado);
    $('cantidad-info').textContent = `Bote ${formatear(estado.bote)} · mínimo ${formatear(estado.subidaMinima)}` +
      (j.fichas !== null ? ` · le quedan ${formatear(j.fichas)}` : '') +
      (j.puesto > 0 ? ` · ya ha puesto ${formatear(j.puesto)}` : '');
    const aviso = $('cantidad-aviso');
    aviso.textContent = r.error || r.aviso || (allinElegido && maximoAllin(estado) === null ? 'All-in: teclea hasta cuánto.' : '');
    aviso.classList.toggle('aviso-campo-error', Boolean(r.error));
    $('tamano-allin').classList.toggle('elegido', r.allin);

    btnAnotar.disabled = !r.puedeAnotar;
    if (!r.puedeAnotar) btnAnotar.textContent = estado.apuestaMaxima === 0 ? 'Apostar' : 'Subir';
    else if (r.allin) btnAnotar.textContent = `All-in (hasta ${formatear(r.hasta)})`;
    else if (estado.apuestaMaxima === 0) btnAnotar.textContent = `Apostar ${formatear(r.hasta)}`;
    else btnAnotar.textContent = `Subir hasta ${formatear(r.hasta)}`;
  }

  return { abrir, cerrar, estaAbierto: () => Boolean(abierta) };
}
