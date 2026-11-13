// avisos.js: barra roja arriba de la pantalla para avisar de errores importantes
// (p. ej. "no queda espacio para guardar"). Así la app nunca falla en silencio.

const barra = document.getElementById('aviso-error');
const texto = document.getElementById('aviso-error-texto');

document.getElementById('btn-cerrar-error').addEventListener('click', () => {
  barra.hidden = true;
});

/** Muestra un mensaje de error hasta que se cierre con la ✕. */
export function mostrarError(mensaje) {
  texto.textContent = mensaje;
  barra.hidden = false;
}
