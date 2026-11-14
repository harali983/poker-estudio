// ajustes.js: los ajustes de la app (lógica, sin pantalla).
// Se guardan en el almacén "ajustes" de la base de datos como pares clave → valor.

import { bd } from './db.js';
import { interpretarNumero } from './numeros.js';

export const AJUSTES_POR_DEFECTO = {
  ciegas: { sb: 1, bb: 2, ante: 0 },  // ciegas por defecto de una mesa nueva
};

/** Lee todos los ajustes; lo que no esté guardado toma el valor por defecto. */
export async function leerAjustes() {
  const ciegas = await bd.leerAjuste('ciegas', AJUSTES_POR_DEFECTO.ciegas);
  return { ciegas };
}

export function guardarAjuste(clave, valor) {
  return bd.guardarAjuste(clave, valor);
}

/**
 * Comprueba las ciegas escritas en los campos (textos a la española).
 * Devuelve { ciegas, aviso } si se pueden guardar (aviso puede ser null), o { error }.
 */
export function validarCiegas(sbTexto, bbTexto, anteTexto) {
  const sb = interpretarNumero(sbTexto);
  const bb = interpretarNumero(bbTexto);
  const ante = String(anteTexto).trim() === '' ? 0 : interpretarNumero(anteTexto);

  if (bb === null || bb === 0) return { error: 'La ciega grande tiene que ser un número mayor que 0.' };
  if (sb === null) return { error: 'La ciega pequeña tiene que ser un número (puede ser 0).' };
  if (ante === null) return { error: 'El ante tiene que ser un número, o dejarse vacío.' };

  // Raro, pero posible: se avisa y se guarda igualmente (la app avisa, no impide)
  const aviso = sb > bb ? 'La ciega pequeña es mayor que la grande. ¿Seguro que es así?' : null;
  return { ciegas: { sb, bb, ante }, aviso };
}

/** Número → texto para un campo, con coma decimal: 0.5 → "0,5". */
export function numeroATexto(n) {
  return String(n).replace('.', ',');
}
