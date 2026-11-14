// recomendacion.js: la recomendación básica cuando te toca (lógica pura, con tests).
// Ver el plan, 2.4.
//
// La regla compara tu EQUIDAD (contra tantas manos al azar como rivales vivos, la calcula el
// worker de la calculadora) con las POT ODDS (la equidad mínima para que pagar sea rentable):
//   - equidad < pot odds                       → Fold (o Check, si es gratis)
//   - equidad ≥ pot odds                       → Call
//   - equidad claramente mayor (ver abajo)     → Subir / Apostar, con un tamaño orientativo de ⅔ del bote
// "Claramente mayor" = supera las pot odds en MARGEN_POT_ODDS puntos Y supera tu parte justa
// del bote (1 / jugadores en la mano) en MARGEN_PARTE puntos. Con 1 rival, subir pide ≥ 60 %;
// con 2, ≥ 43 %. Los umbrales se ajustarán al probarlo; el tamaño fino llega en la Fase 4.
//
// La equidad contra manos al azar es OPTIMISTA: quien apuesta o sube suele tener mejor mano
// que una al azar. Por eso el aviso se ve siempre y se destaca en el river y ante apuestas
// grandes (≥ ½ bote), que es cuando más se equivoca.

export const MARGEN_POT_ODDS = 0.15;
export const MARGEN_PARTE = 0.10;
export const AVISO_OPTIMISTA = 'La equidad contra manos al azar es optimista: quien apuesta o sube suele tener mejor mano que una al azar.';

const pct = (x) => Math.round(x * 100) + ' %';
const num = (n) => n.toLocaleString('es-ES', { maximumFractionDigits: 2 });

/** Pot odds: lo que pagas / (bote + lo que pagas). 0 si no hay nada que pagar. */
export function potOdds(aPagar, bote) {
  return aPagar > 0 ? aPagar / (bote + aPagar) : 0;
}

/** Tu parte justa del bote: 1 / jugadores en la mano (tú + rivales). */
export function parteJusta(rivales) {
  return 1 / (rivales + 1);
}

/**
 * SPR (stack-to-pot ratio): fichas efectivas / bote. Las efectivas son las tuyas o las del
 * rival vivo que más tiene, lo que sea menor (más no se puede ganar ni perder).
 * null si no se llevan fichas o el bote es 0.
 */
export function spr(estado, asiento) {
  const yo = estado.jugadores.find((j) => j.asiento === asiento);
  if (!yo || yo.fichas === null || !(estado.bote > 0)) return null;
  const rivales = estado.jugadores.filter((j) => j.vivo && j.asiento !== asiento);
  if (!rivales.length) return null;
  const efectivas = Math.min(yo.fichas, Math.max(...rivales.map((j) => j.fichas)));
  return efectivas / estado.bote;
}

/**
 * ¿Hay que destacar el aviso de equidad optimista? En el river y ante una apuesta grande
 * (pot odds ≥ 25 %, que es lo que da una apuesta de ½ bote). Antes del flop, pagar la ciega
 * grande no cuenta como apuesta grande.
 */
export function destacarAviso({ calle, aPagar, bote, apuestaMaxima, bb }) {
  if (calle === 'river') return true;
  if (!(aPagar > 0)) return false;
  if (calle === 'preflop' && apuestaMaxima <= bb) return false;
  return potOdds(aPagar, bote) >= 0.25;
}

/**
 * La recomendación.
 * datos: { equidad (0–1), aPagar, bote, rivales, calle, apuestaMaxima, bb,
 *          puedeSubir (hay fichas para subir o apostar), hasta (tamaño orientativo de ⅔ del bote) }
 * Devuelve { consejo: 'fold' | 'check' | 'call' | 'apostar' | 'subir', potOdds, parte, hasta, texto, destacar }.
 */
export function recomendar(datos) {
  const { equidad, aPagar, bote, rivales, apuestaMaxima, puedeSubir, hasta } = datos;
  const po = potOdds(aPagar, bote);
  const parte = parteJusta(rivales);
  const deRivales = `tu parte con ${rivales} ${rivales === 1 ? 'rival' : 'rivales'}`;
  const fuerte = equidad >= po + MARGEN_POT_ODDS && equidad >= parte + MARGEN_PARTE;
  const r = { potOdds: po, parte, hasta: null, destacar: destacarAviso(datos) };

  if (aPagar === 0) {
    if (fuerte && puedeSubir) {
      // Sin apuesta delante es "apostar"; la BB con opción antes del flop "sube"
      const consejo = apuestaMaxima > 0 ? 'subir' : 'apostar';
      const verbo = consejo === 'subir' ? `Subir hasta ${num(hasta)}` : `Apostar ${num(hasta)}`;
      return { ...r, consejo, hasta,
        texto: `${verbo} (⅔ del bote): tu equidad (${pct(equidad)}) supera bastante ${deRivales} (${pct(parte)}).` };
    }
    return { ...r, consejo: 'check',
      texto: fuerte
        ? `Check: tu equidad (${pct(equidad)}) es buena, pero no te quedan fichas para apostar.`
        : `Check: es gratis. Tu equidad (${pct(equidad)}) no supera bastante ${deRivales} (${pct(parte)}) para apostar.` };
  }

  if (equidad < po) {
    return { ...r, consejo: 'fold',
      texto: `Fold: tu equidad (${pct(equidad)}) no llega al ${pct(po)} que necesitas para pagar ${num(aPagar)}.` };
  }
  if (fuerte && puedeSubir) {
    return { ...r, consejo: 'subir', hasta,
      texto: `Subir hasta ${num(hasta)} (⅔ del bote): tu equidad (${pct(equidad)}) supera de sobra el ${pct(po)} que necesitas.` };
  }
  return { ...r, consejo: 'call',
    texto: `Call: tu equidad (${pct(equidad)}) supera el ${pct(po)} que necesitas`
      + (fuerte ? ' (no te quedan fichas para subir).' : '.') };
}

/** Nombre del consejo para el botón grande del panel. */
export const NOMBRE_CONSEJO = { fold: 'Fold', check: 'Check', call: 'Call', apostar: 'Apostar', subir: 'Subir' };
