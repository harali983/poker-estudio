// pantalla-ajustes.js: ciegas por defecto, unidad de las cantidades y estado del almacenamiento.
// Los cambios se guardan solos (no hay botón "Guardar").

import { estadoPersistencia, espacioUsado, ErrorBD } from './db.js';
import { leerAjustes, guardarAjuste, validarCiegas, numeroATexto } from './ajustes.js';
import { mostrarError } from './avisos.js';

export function iniciarAjustes() {
  const campoSb = document.getElementById('ajuste-sb');
  const campoBb = document.getElementById('ajuste-bb');
  const campoAnte = document.getElementById('ajuste-ante');
  const avisoCiegas = document.getElementById('ajuste-ciegas-aviso');
  const textoGuardado = document.getElementById('ajustes-guardado');
  const botonesUnidad = [...document.querySelectorAll('#pantalla-ajustes [data-unidad]')];

  let temporizadorCiegas = null;   // espera corta mientras escribes antes de guardar
  let temporizadorGuardado = null;

  // ---- Cargar lo guardado ----
  leerAjustes()
    .then((ajustes) => {
      campoSb.value = numeroATexto(ajustes.ciegas.sb);
      campoBb.value = numeroATexto(ajustes.ciegas.bb);
      campoAnte.value = ajustes.ciegas.ante ? numeroATexto(ajustes.ciegas.ante) : '';
      pintarUnidad(ajustes.unidad);
    })
    .catch(avisarFallo);

  // ---- Ciegas: se guardan 0,4 s después de dejar de escribir ----
  for (const campo of [campoSb, campoBb, campoAnte]) {
    campo.addEventListener('input', () => {
      clearTimeout(temporizadorCiegas);
      temporizadorCiegas = setTimeout(guardarCiegas, 400);
    });
  }

  function guardarCiegas() {
    temporizadorCiegas = null;
    const r = validarCiegas(campoSb.value, campoBb.value, campoAnte.value);
    if (r.error) {
      mostrarAvisoCiegas(r.error, true); // no se guarda hasta que sea válido
      return;
    }
    mostrarAvisoCiegas(r.aviso, false);
    guardar('ciegas', r.ciegas);
  }

  function mostrarAvisoCiegas(texto, esError) {
    avisoCiegas.hidden = !texto;
    avisoCiegas.textContent = texto || '';
    avisoCiegas.classList.toggle('aviso-campo-error', Boolean(esError));
  }

  // ---- Unidad: fichas o ciegas grandes ----
  for (const boton of botonesUnidad) {
    boton.addEventListener('click', () => {
      pintarUnidad(boton.dataset.unidad);
      guardar('unidad', boton.dataset.unidad);
    });
  }

  function pintarUnidad(unidad) {
    for (const boton of botonesUnidad) {
      const elegido = boton.dataset.unidad === unidad;
      boton.classList.toggle('elegido', elegido);
      boton.setAttribute('aria-checked', String(elegido));
    }
  }

  // ---- Guardar y avisar ----
  async function guardar(clave, valor) {
    try {
      await guardarAjuste(clave, valor);
      textoGuardado.textContent = 'Guardado ✓';
      clearTimeout(temporizadorGuardado);
      temporizadorGuardado = setTimeout(() => { textoGuardado.textContent = ''; }, 1500);
    } catch (error) {
      avisarFallo(error);
    }
  }

  function avisarFallo(error) {
    console.error(error);
    mostrarError(error instanceof ErrorBD ? error.message : 'Error inesperado al guardar los ajustes: ' + error.message);
  }

  // ---- Almacenamiento: ¿persistente? ¿cuánto ocupa? ----
  async function actualizarAlmacenamiento() {
    const estado = await estadoPersistencia();
    const textos = {
      'concedido': ['✅ Sí', 'Safari no borrará tus datos por su cuenta. Solo se borran si eliminas la app del iPhone.'],
      'denegado': ['⚠️ No concedido', 'Safari podría borrar los datos si el iPhone se queda sin espacio. Con la app instalada en la pantalla de inicio el riesgo es menor. Haz copias de seguridad cuando estén disponibles (Fase 3).'],
      'no-disponible': ['No disponible', 'Este navegador no permite pedirlo.'],
    };
    document.getElementById('estado-persistencia').textContent = textos[estado][0];
    document.getElementById('explicacion-persistencia').textContent = textos[estado][1];

    const espacio = await espacioUsado();
    document.getElementById('espacio-usado').textContent = espacio
      ? `${tamano(espacio.usado)} de ${tamano(espacio.total)} disponibles`
      : 'el navegador no lo indica';
  }

  // Guardar ya lo pendiente (si sales, cambias de app o se cierra justo después de escribir)
  function guardarYa() {
    if (temporizadorCiegas) {
      clearTimeout(temporizadorCiegas);
      guardarCiegas();
    }
  }

  return {
    alEntrar: actualizarAlmacenamiento,
    alSalir: guardarYa,
    guardarYa,
  };
}

// 123456 → "121 KB"
function tamano(bytes) {
  const unidades = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < unidades.length - 1) { n /= 1024; i++; }
  return n.toLocaleString('es-ES', { maximumFractionDigits: i >= 2 ? 1 : 0 }) + ' ' + unidades[i];
}
