// pantalla-inicio.js: el menú. Si hay una partida en curso, muestra "Continuar partida".

import { partidaEnCurso } from './partidas.js';

export function iniciarInicio() {
  const tarjeta = document.getElementById('continuar-partida');
  const detalle = document.getElementById('continuar-detalle');
  const subtituloJugar = document.getElementById('jugar-subtitulo');

  async function actualizar() {
    let partida = null;
    try {
      partida = await partidaEnCurso();
    } catch {
      // Si la base de datos falla, app.js ya muestra el aviso; el menú sigue funcionando
    }
    tarjeta.hidden = !partida;
    subtituloJugar.textContent = partida ? 'Ver o editar la mesa' : 'Registrar una partida real';
    if (!partida) return;

    const { sb, bb, ante } = partida.ciegas;
    const desde = new Date(partida.creada).toLocaleString('es-ES', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    detalle.textContent =
      `${partida.asientos.length} jugadores · ciegas ${numero(sb)}/${numero(bb)}` +
      (ante ? ` · ante ${numero(ante)}` : '') + ` · desde el ${desde}`;
  }

  return { alEntrar: actualizar };
}

function numero(n) {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}
