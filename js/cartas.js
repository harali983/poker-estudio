// cartas.js: cómo representamos las cartas y utilidades para mostrarlas.
//
// Cada carta es un número del 0 al 51 (así los cálculos son muy rápidos):
//   valor = carta >> 2   (división entera entre 4)  → 0 = "2", 1 = "3", …, 12 = "A"
//   palo  = carta & 3    (resto de dividir entre 4) → 0 = ♠, 1 = ♥, 2 = ♦, 3 = ♣
// Ejemplo: A♠ = 12 × 4 + 0 = 48.

// Valores en notación corta de póker (la que se usa en los tests: "As" = as de picas)
export const VALORES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

// Valores tal y como se muestran en pantalla ("10" se entiende mejor que "T")
export const VALORES_TEXTO = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Letras de los palos en inglés (spades, hearts, diamonds, clubs), estándar en póker
export const PALOS = ['s', 'h', 'd', 'c'];

// Símbolos de los palos. "︎" pide al iPhone que los dibuje como texto y no como emoji.
export const SIMBOLOS = ['♠︎', '♥︎', '♦︎', '♣︎'];

export const NOMBRES_PALOS = ['picas', 'corazones', 'diamantes', 'tréboles'];

/** Construye el número de una carta a partir de su valor (0–12) y su palo (0–3). */
export function carta(valor, palo) {
  return valor * 4 + palo;
}

export function valorDe(c) { return c >> 2; }
export function paloDe(c) { return c & 3; }

/** Texto para mostrar una carta, p. ej. 48 → "A♠". */
export function nombreCarta(c) {
  return VALORES_TEXTO[valorDe(c)] + SIMBOLOS[paloDe(c)];
}

/** Convierte "As", "Td", "7c"… en el número de la carta (útil en los tests). */
export function textoACarta(texto) {
  const valor = VALORES.indexOf(texto[0].toUpperCase());
  const palo = PALOS.indexOf(texto[1].toLowerCase());
  if (valor < 0 || palo < 0 || texto.length !== 2) {
    throw new Error('Carta no válida: ' + texto);
  }
  return carta(valor, palo);
}

/** Convierte "As Kd 7c" en una lista de cartas. */
export function textoACartas(texto) {
  return texto.trim().split(/\s+/).filter(Boolean).map(textoACarta);
}
