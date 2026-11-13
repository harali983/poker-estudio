// partidas.js: guardar y leer partidas, jugadores y el borrador de la mesa en la base de datos.
// La lógica pura está en mesa.js; aquí solo se lee y se escribe.

import { bd } from './db.js';
import { resolverJugadores, crearPartida, actualizarPartida } from './mesa.js';
const CLAVE_BORRADOR = 'borradorMesa'; // mesa a medio preparar (se guarda en "ajustes")

/** La partida en curso (o null si no hay). Si hubiera varias, la más reciente. */
export async function partidaEnCurso() {
  const enCurso = await bd.listar('partidas', 'estado', 'en-curso');
  enCurso.sort((a, b) => (a.creada < b.creada ? 1 : -1));
  return enCurso[0] || null;
}

/** Todos los jugadores guardados (sin contarte a ti), ordenados por el último uso. */
export async function rivalesConocidos() {
  const todos = await bd.listar('jugadores');
  return todos
    .filter((j) => j.id !== 'yo')
    .sort((a, b) => ((a.ultimaVez || a.creado) < (b.ultimaVez || b.creado) ? 1 : -1));
}

/** Map jugadorId → nombre (para mostrar una partida guardada). */
export async function nombresDeJugadores() {
  const todos = await bd.listar('jugadores');
  return new Map(todos.map((j) => [j.id, j.nombre]));
}

/**
 * Guarda la mesa: crea la partida (o actualiza la existente) y los jugadores nuevos,
 * todo en una sola operación (si algo falla, no se guarda nada a medias).
 * Devuelve la partida guardada.
 */
export async function guardarMesa(borrador, partidaExistente) {
  const ahora = new Date().toISOString();
  const conocidos = await bd.listar('jugadores');
  const { asientos, nuevos } = resolverJugadores(borrador, conocidos, () => crypto.randomUUID(), ahora);

  const partida = partidaExistente
    ? actualizarPartida(partidaExistente, borrador, asientos)
    : crearPartida(borrador, asientos, crypto.randomUUID(), ahora);

  // Jugadores a guardar: los nuevos, tú (la primera vez) y la fecha de último uso de todos los de la mesa
  const porId = new Map(conocidos.map((j) => [j.id, j]));
  for (const n of nuevos) porId.set(n.id, n);
  if (!porId.has('yo')) porId.set('yo', { id: 'yo', nombre: 'Yo', creado: ahora, notas: '' });
  const jugadores = asientos
    .filter((a) => a.jugadorId)
    .map((a) => ({ ...porId.get(a.jugadorId), ultimaVez: ahora }));

  await bd.guardarJuntos({ jugadores, partidas: [partida] });
  return partida;
}

/** Termina la partida en curso (sigue guardada, pero ya no aparece "Continuar partida"). */
export async function terminarPartida(partida) {
  const terminada = { ...partida, estado: 'terminada', terminada: new Date().toISOString() };
  await bd.guardar('partidas', terminada);
  return terminada;
}

// ---- Borrador de la mesa: para no perder lo escrito si iOS cierra la app ----
// Hay uno para la mesa nueva y otro por cada partida que se esté editando.
function claveBorrador(partidaId) {
  return partidaId ? CLAVE_BORRADOR + ':' + partidaId : CLAVE_BORRADOR;
}
export function leerBorrador(partidaId = null) {
  return bd.leerAjuste(claveBorrador(partidaId), null);
}
export function guardarBorrador(borrador, partidaId = null) {
  return bd.guardarAjuste(claveBorrador(partidaId), borrador);
}
export function borrarBorrador(partidaId = null) {
  return bd.borrar('ajustes', claveBorrador(partidaId));
}
