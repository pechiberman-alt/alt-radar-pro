/**
 * Picks the best Spanish voice the browser has. Quality varies a lot by
 * device: Edge ships Microsoft "Online (Natural)" neural voices (Tomás and
 * Elena for Argentina), Chrome has Google's network voices, phones have the
 * system engine. A natural/neural voice from the closest region beats a
 * robotic one from the exact region.
 */

export type VoiceLike = { name: string; lang: string; localService?: boolean };

const REGION_SCORE: [RegExp, number][] = [
  [/^es[-_]AR/i, 40],
  [/^es[-_](UY|PY|CL)/i, 34],
  [/^es[-_](419|US|MX|CO|PE|VE)/i, 30],
  [/^es[-_]ES/i, 18],
  [/^es/i, 12],
];
const QUALITY = /natural|neural|online|premium|enhanced|wavenet|google/i;
const MALE = /tom[aá]s|jorge|diego|pablo|juan|ra[uú]l|alvaro|álvaro|carlos|enrique|gonzalo|jos[eé]|andr[eé]s|lorenzo|federico|male|hombre/i;
const FEMALE = /elena|helena|paulina|m[oó]nica|laura|sabina|dalia|elvira|female|mujer|luc[ií]a|camila|valentina/i;

export function scoreVoice(v: VoiceLike, prefer: "male" | "female" = "male"): number {
  let s = -1;
  for (const [re, pts] of REGION_SCORE) {
    if (re.test(v.lang)) {
      s = pts;
      break;
    }
  }
  if (s < 0) return -1;
  if (QUALITY.test(v.name)) s += 25;
  if (prefer === "male" ? MALE.test(v.name) : FEMALE.test(v.name)) s += 8;
  if (prefer === "male" ? FEMALE.test(v.name) : MALE.test(v.name)) s -= 4;
  return s;
}

/** The best Spanish voice, or null when the browser has none. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], prefer: "male" | "female" = "male"): V | null {
  let best: V | null = null;
  let bestScore = -1;
  for (const v of voices) {
    const s = scoreVoice(v, prefer);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}
