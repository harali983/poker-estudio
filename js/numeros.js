// numeros.js: leer números escritos a la española.
//
// En España la coma es el decimal y el punto separa los miles:
//   "12,5" → 12.5      "1.000" → 1000      "1.000,5" → 1000.5
// Está en un archivo aparte (sin tocar la pantalla) para poder probarlo en tests.html.

/**
 * Convierte un texto en número. Devuelve null si está vacío, no es un número o es negativo.
 */
export function interpretarNumero(texto) {
  let t = String(texto).trim();
  if (t === '') return null;

  if (t.includes('.') && t.includes(',')) {
    // Punto y coma a la vez ("1.000,5"): los puntos son miles y la coma es el decimal
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    // Formato de miles con punto: 1 a 3 cifras y luego grupos de ".ddd" ("1.000", "12.500", "1.000.000")
    t = t.replace(/\./g, '');
  } else {
    // Solo coma ("12,5") o un punto que no es de miles ("1.5"): es el decimal
    t = t.replace(',', '.');
  }

  const numero = Number(t);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}
