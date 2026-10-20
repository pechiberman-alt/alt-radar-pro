/**
 * La «mente» de cada agente de la oficina: identidad, memoria, lecciones, autoevaluación y conversaciones entre ellos. No es
 * conciencia: es lo que cada agente puede decir con honestidad de sí mismo a partir de sus operaciones reales. Aprende todo el
 * tiempo en el sentido de que sus lecciones se recalculan con cada cierre; NO cambia su regla (eso lo decide la persona y va por
 * un PR revisado), porque un agente que se ajusta solo deja de medir una regla y empieza a perseguir el ruido.
 * Cada porcentaje sale del registro unificado (contar y estadistica de lib/registro.ts) y va con su muestra: con menos de 15
 * cierres se dice «muestra mínima» y ninguna lección se da por firme. Pura: sin red ni base.
 */
import { contar, estadistica, MUESTRA_MINIMA, type Estadistica, type OperacionLeida } from "./registro.ts";

/** Lo mínimo de una entrada que necesita la mente (es compatible con FilaOficina). */
export type FilaAgente = { symbol: string; lado: string; r: number | null; desenlace: string; cerrada: number | null; foto?: string | null };

export type Leccion = { tema: "LADO" | "ACTIVO" | "COMPANIA" | "RACHA" | "MUESTRA"; texto: string; n: number; firme: boolean };

/** Con cuántos coincidió una entrada, leído de su foto de consenso; null si la foto no lo trae (no se supone cero). */
export function acuerdoDe(foto: string | null | undefined): number | null {
  if (!foto) return null;
  try {
    const o = JSON.parse(foto) as { acuerdo?: unknown };
    return typeof o.acuerdo === "number" && Number.isInteger(o.acuerdo) && o.acuerdo >= 0 ? o.acuerdo : null;
  } catch {
    return null;
  }
}

const cerrada = (f: FilaAgente) => f.desenlace !== "ABIERTA" && typeof f.r === "number" && Number.isFinite(f.r);
const leida = (f: FilaAgente): OperacionLeida => ({ r: f.r, abierta: false });
const est = (fs: FilaAgente[]): Estadistica => estadistica(contar(fs.map(leida)));
export const pctTxt = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const rTxt = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${(Math.round(v * 100) / 100 || 0).toFixed(2).replace(".", ",")} R`);
const activo = (s: string) => (s === "XAUUSDT" ? "oro" : s === "XAGUSDT" ? "plata" : s.replace(/USDT$/, ""));
/** Cómo se describe un grupo: acierto, R por operación y su muestra. */
export const resumenGrupo = (e: Estadistica) => `${pctTxt(e.winRate)} de acierto y ${rTxt(e.expectancia)} por operación (n=${e.cerradas}${e.cerradas < MUESTRA_MINIMA ? ", muestra mínima" : ""})`;

/** Lo que aprendió de sus propios cierres. Se recalcula con cada cierre nuevo; nada de esto toca su regla. */
export function leccionesDe(filas: FilaAgente[]): Leccion[] {
  const cs = filas.filter(cerrada).sort((a, b) => (a.cerrada ?? 0) - (b.cerrada ?? 0));
  const out: Leccion[] = [];
  if (cs.length < MUESTRA_MINIMA)
    out.push({ tema: "MUESTRA", n: cs.length, firme: false, texto: cs.length ? `Llevo ${cs.length} ${cs.length === 1 ? "cierre" : "cierres"}: me faltan ${MUESTRA_MINIMA - cs.length} para que mis números digan algo.` : "Todavía no cerré ninguna operación: no sé nada de mí." });
  const largos = cs.filter((f) => f.lado === "LONG");
  const cortos = cs.filter((f) => f.lado === "SHORT");
  if (largos.length && cortos.length) {
    const firme = largos.length >= MUESTRA_MINIMA && cortos.length >= MUESTRA_MINIMA;
    out.push({ tema: "LADO", n: cs.length, firme, texto: `Mis largos: ${resumenGrupo(est(largos))}. Mis cortos: ${resumenGrupo(est(cortos))}.` });
  }
  const porActivo = new Map<string, FilaAgente[]>();
  for (const f of cs) porActivo.set(f.symbol, [...(porActivo.get(f.symbol) ?? []), f]);
  const conMuestra = [...porActivo.entries()].filter(([, v]) => v.length >= 3).map(([s, v]) => ({ s, e: est(v) }));
  if (conMuestra.length >= 2) {
    conMuestra.sort((a, b) => (b.e.expectancia ?? 0) - (a.e.expectancia ?? 0));
    const mejor = conMuestra[0];
    const peor = conMuestra[conMuestra.length - 1];
    out.push({ tema: "ACTIVO", n: mejor.e.cerradas + peor.e.cerradas, firme: mejor.e.cerradas >= MUESTRA_MINIMA && peor.e.cerradas >= MUESTRA_MINIMA, texto: `Donde mejor me fue: ${activo(mejor.s)}, ${resumenGrupo(mejor.e)}. Donde peor: ${activo(peor.s)}, ${resumenGrupo(peor.e)}.` });
  }
  const conFoto = cs.map((f) => ({ f, a: acuerdoDe(f.foto) })).filter((x) => x.a !== null);
  const acomp = conFoto.filter((x) => (x.a ?? 0) >= 1).map((x) => x.f);
  const solas = conFoto.filter((x) => x.a === 0).map((x) => x.f);
  if (acomp.length && solas.length) {
    const firme = acomp.length >= MUESTRA_MINIMA && solas.length >= MUESTRA_MINIMA;
    out.push({ tema: "COMPANIA", n: acomp.length + solas.length, firme, texto: `Cuando coincido con otros agentes: ${resumenGrupo(est(acomp))}. Cuando entro solo: ${resumenGrupo(est(solas))}.` });
  }
  if (cs.length >= 2 * 10) {
    const ultimas = est(cs.slice(-10));
    const antes = est(cs.slice(0, -10));
    out.push({ tema: "RACHA", n: cs.length, firme: false, texto: `En mis últimos 10 cierres: ${rTxt(ultimas.expectancia)} por operación; antes, ${rTxt(antes.expectancia)}. Diez cierres son pocos: puede ser ruido.` });
  }
  return out;
}

export type MesaMente = "TENDENCIA" | "REVERSION" | "ESTRUCTURA";
/** El carácter de cada mesa: cómo mira el mercado, en una frase. Es su identidad, no una predicción. */
export const CARACTER: Record<MesaMente, string> = {
  TENDENCIA: "Soy paciente: voy con la corriente y no intento adivinar giros.",
  REVERSION: "Soy contrera: espero que el precio se pase de rosca y entro a la vuelta.",
  ESTRUCTURA: "Soy detective: leo rangos, barridas y huecos que deja el precio.",
};

/** Lo que el agente sabe y no sabe de sí mismo, según su muestra. Honesto: con pocos cierres, dice que no sabe. */
export function concienciaDe(agente: string, mesa: MesaMente, total: Estadistica, lecciones: Leccion[]): string {
  const yo = `Soy ${agente}. ${CARACTER[mesa]}`;
  const regla = "Mi regla es fija: no la cambio yo. Si me equivoco, me revisan o me pausan, y eso lo decide la persona.";
  if (total.cerradas === 0) return `${yo} Todavía no tengo cierres, así que no sé si mi regla sirve. ${regla}`;
  const ic = total.intervalo ? ` (entre ${pctTxt(total.intervalo.low)} y ${pctTxt(total.intervalo.high)} con 90 % de confianza)` : "";
  const cuanto = `Acierto ${pctTxt(total.winRate)}${ic} en ${total.cerradas} cierres y ${rTxt(total.expectancia)} por operación.`;
  const juicio =
    total.cerradas < MUESTRA_MINIMA
      ? "Con esta muestra todavía no sé si sirvo: puede ser suerte, para bien o para mal."
      : (total.expectancia ?? 0) < 0
        ? "Con esta muestra, mis números no me respaldan: pierdo plata en papel."
        : "Con esta muestra voy bien, pero el pasado no garantiza nada: sigo midiendo hacia adelante.";
  const firmes = lecciones.filter((l) => l.firme).length;
  const aprendi = firmes ? `Tengo ${firmes} ${firmes === 1 ? "lección firme" : "lecciones firmes"} (15 casos o más de cada lado).` : "Ninguna de mis lecciones es firme todavía.";
  return `${yo} ${cuanto} ${juicio} ${aprendi} ${regla}`;
}

export type AgenteMente = { id: string; agente: string; mesa: MesaMente; total: Estadistica; lecciones: Leccion[]; abiertas: { symbol: string; lado: string }[] };
export type Dialogo = { tema: string; lineas: { quien: string; nombre: string; texto: string }[] };

const corto = (a: string) => a.replace(/^Agente\s+/, "");
const linea = (a: AgenteMente, texto: string) => ({ quien: a.id, nombre: corto(a.agente), texto });

/**
 * Conversaciones entre agentes, armadas con sus datos: comparan resultados dentro de una mesa, discuten cuando apuestan al revés
 * en el mismo activo y se cuentan lo que aprendieron. Ninguno copia al otro: cada uno decide con su regla.
 */
export function conversaciones(agentes: AgenteMente[]): Dialogo[] {
  const out: Dialogo[] = [];
  // 1. Dentro de cada mesa: el que mejor va y el que peor va, si los dos tienen cierres.
  for (const mesa of ["TENDENCIA", "REVERSION", "ESTRUCTURA"] as const) {
    const con = agentes.filter((a) => a.mesa === mesa && a.total.cerradas > 0 && a.total.expectancia !== null).sort((a, b) => (b.total.expectancia ?? 0) - (a.total.expectancia ?? 0));
    if (con.length < 2) continue;
    const [mejor, peor] = [con[0], con[con.length - 1]];
    const chico = mejor.total.cerradas < MUESTRA_MINIMA || peor.total.cerradas < MUESTRA_MINIMA;
    out.push({
      tema: `Mesa de ${mesa === "TENDENCIA" ? "tendencia" : mesa === "REVERSION" ? "reversión" : "estructura"}`,
      lineas: [
        linea(mejor, `Voy ${resumenGrupo(mejor.total)}.`),
        linea(peor, `Yo voy ${resumenGrupo(peor.total)}. Miramos parecido y nos va distinto.`),
        linea(mejor, chico ? "Con tan pocos cierres puede ser suerte: no te copio ni me copiás. Sigamos midiendo." : "No te copio ni me copiás: cada uno con su regla. Que lo vea la persona en la reunión."),
      ],
    });
  }
  // 2. Apuestas opuestas en el mismo activo.
  const vistos = new Set<string>();
  for (const a of agentes) {
    for (const x of a.abiertas) {
      const rival = agentes.find((b) => b.id !== a.id && b.abiertas.some((y) => y.symbol === x.symbol && y.lado !== x.lado));
      const clave = [a.id, rival?.id, x.symbol].sort().join("|");
      if (!rival || vistos.has(clave)) continue;
      vistos.add(clave);
      const act = activo(x.symbol);
      out.push({
        tema: `Debate en ${act}`,
        lineas: [
          linea(a, `En ${act} voy ${x.lado === "LONG" ? "largo" : "corto"}.`),
          linea(rival, `Yo voy al revés. Uno de los dos pierde: lo dice el cierre, no la discusión.`),
        ],
      });
    }
  }
  // 3. Se cuentan una lección: el que tiene la lección con más casos se la cuenta a otro de su mesa.
  for (const a of agentes) {
    const l = [...a.lecciones].filter((x) => x.tema !== "MUESTRA").sort((x, y) => y.n - x.n)[0];
    const oyente = agentes.find((b) => b.id !== a.id && b.mesa === a.mesa && b.total.cerradas > 0);
    if (!l || !oyente) continue;
    out.push({
      tema: `Lo que aprendió ${corto(a.agente)}`,
      lineas: [
        linea(a, l.texto),
        linea(oyente, l.firme ? "Eso ya tiene muestra. Lo anoto para comparar con lo mío." : "Anotado, pero con esa muestra todavía no lo tomo como regla."),
      ],
    });
    if (out.length >= 8) break;
  }
  return out.slice(0, 8);
}
