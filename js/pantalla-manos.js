// pantalla-manos.js: "Mis manos". Lista de las manos cerradas, agrupadas por partida.
// La lógica (resumen de cada mano, agrupar y sumar) está en historial.js, con tests.
// Aquí solo se lee la base de datos y se pinta.

import { bd } from './db.js';
import { agruparPorPartida } from './historial.js';
import { VALORES_TEXTO, SIMBOLOS, valorDe, paloDe } from './cartas.js';

export function iniciarManos() {
  const lista = document.getElementById('manos-lista');
  const vacio = document.getElementById('manos-vacio');

  async function actualizar() {
    let manos = [], partidas = [];
    try {
      [manos, partidas] = await Promise.all([bd.listar('manos'), bd.listar('partidas')]);
    } catch {
      return; // app.js ya muestra el aviso de la base de datos
    }
    const grupos = agruparPorPartida(manos, partidas);
    vacio.hidden = grupos.length > 0;
    lista.replaceChildren(...grupos.map(pintarGrupo));
  }

  return { alEntrar: actualizar };
}

// ---- Una partida: cabecera con su total y la lista de sus manos ----
function pintarGrupo(grupo) {
  const tarjeta = el('section', 'tarjeta grupo-partida');

  const cabecera = el('header', 'grupo-cabecera');
  const titulo = el('div', 'grupo-titulo');
  titulo.append(
    el('h2', '', tituloPartida(grupo)),
    el('p', 'texto-suave texto-pequeno', detallePartida(grupo)),
  );
  const total = el('div', 'grupo-total');
  if (grupo.total.jugadas) {
    total.append(
      el('strong', 'grupo-resultado ' + claseResultado(grupo.total.resultado), conSigno(grupo.total.resultado)),
      el('small', 'texto-suave', conSigno(grupo.total.resultadoBB) + ' BB'),
    );
  }
  cabecera.append(titulo, total);

  const ul = el('ul', 'lista-manos');
  for (const r of grupo.manos) ul.append(pintarFila(r));

  tarjeta.append(cabecera, ul);
  return tarjeta;
}

function tituloPartida(grupo) {
  const fecha = grupo.partida ? grupo.partida.creada : grupo.manos[grupo.manos.length - 1].fecha;
  return fechaCorta(fecha) || 'Partida';
}

function detallePartida(grupo) {
  const p = grupo.partida;
  const n = grupo.manos.length;
  const partes = [];
  if (p) {
    const { sb, bb, ante } = p.ciegas;
    partes.push(`Ciegas ${numero(sb)}/${numero(bb)}` + (ante ? ` · ante ${numero(ante)}` : ''));
  } else {
    partes.push('Partida borrada');
  }
  partes.push(n === 1 ? '1 mano' : `${n} manos`);
  if (p && p.estado === 'en-curso') partes.push('en curso');
  return partes.join(' · ');
}

// ---- Una mano: nº, hora, tus cartas, posición y resultado ----
function pintarFila(r) {
  const li = el('li', 'fila-mano' + (r.jugaba ? '' : ' no-jugaba'));
  li.append(
    el('span', 'mano-num', '#' + r.numero),
    el('span', 'mano-hora texto-suave', hora(r.fecha)),
    pintarCartas(r),
    el('span', 'mano-pos', r.posicion || ''),
    el('span', 'mano-res ' + (r.jugaba ? claseResultado(r.resultado) : 'texto-suave'),
      r.jugaba ? conSigno(r.resultado) : 'no jugabas'),
  );
  return li;
}

function pintarCartas(r) {
  const span = el('span', 'mano-cartas');
  if (!r.jugaba) return span;
  if (!r.misCartas) {
    span.append(el('span', 'texto-suave', '¿?'));
    span.setAttribute('aria-label', 'Cartas sin anotar');
    return span;
  }
  for (const c of r.misCartas) {
    span.append(el('span', 'palo-' + paloDe(c), VALORES_TEXTO[valorDe(c)] + SIMBOLOS[paloDe(c)]));
  }
  return span;
}

// ---- Utilidades ----
function el(etiqueta, clase = '', texto = null) {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== null) e.textContent = texto;
  return e;
}

function numero(n) {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

function conSigno(n) {
  if (!n) return '0';
  return (n > 0 ? '+' : '−') + numero(Math.abs(n));
}

function claseResultado(n) {
  return n > 0 ? 'positivo' : n < 0 ? 'negativo' : 'neutro';
}

function fechaCorta(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function hora(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
