/**
 * Los agentes del AI TRADING LAB (lib/estrategias.ts) leyendo acciones y CEDEARs de BYMA con ruedas diarias: cada uno
 * con su estrategia fija, medido con la escalera de la app (SL, TP1, TP2, TP3; si una rueda toca stop y objetivo, cuenta
 * el stop) y con su señal de hoy, si la hay, con el plan completo.
 *
 * Solo compras: en BYMA vender en corto no está al alcance del inversor común. Quedan afuera los agentes que necesitan
 * el volumen agresor de cada operación (BYMA no lo publica), los de marcos intradía y el de metales. Comisión supuesta:
 * 0,6 % por lado (comisión del agente más derechos de mercado; cada agente de bolsa cobra distinto). Un agente que no le
 * gana al de azar no tiene ventaja. Backtest histórico, no el registro unificado; no es asesoramiento financiero. Pura.
 */
import { escaleraHacia, escaleraValida, type Escalera } from "./escalera.ts";
import { ESTRATEGIAS, indicadores, medir, operarSenales, veredicto, type Estrategia, type EstrategiaId, type Medicion, type Operacion, type Senal, type Veredicto } from "./estrategias.ts";
import type { SwingCandle } from "./swing-entries.ts";

/** Los agentes que tienen sentido con ruedas diarias y sin volumen agresor (el último es el control al azar). */
export const AGENTES_AR: EstrategiaId[] = ["RUPTURA", "CRUCE_EMA", "RSI", "BOLLINGER", "RETROCESO", "MACD", "SUPERTREND", "ST_PERFIL", "SNR", "TENDENCIA_LINEA", "SMC_LIQUIDEZ", "SMC_TODO", "FIB_NIVELES", "AZAR"];

export const EXCLUIDOS_AR =
  "Afuera: los agentes de flujo (absorción, esfuerzo, barrida, delta) porque BYMA no publica el lado agresor de cada operación; los de marco superior y AMD porque están pensados para velas intradía; y el de metales.";

export const ESTUDIO_AR = { marcoMs: 86_400_000, horizonte: 20, feePct: 0.6 } as const;

export const agentesAr = (): Estrategia[] => AGENTES_AR.map((id) => ESTRATEGIAS.find((e) => e.id === id)).filter((e): e is Estrategia => Boolean(e));

/** Una señal solo si es de compra. */
export const soloCompras = (s: Senal | null): Senal | null => (s && s.lado === "LONG" ? s : null);

export type PlanAr = {
  /** Hora de la rueda cerrada que dio la señal; la entrada sería en la apertura de la siguiente. */
  rueda: number;
  referencia: number;
  escalera: Escalera;
  rr: number;
};

export type AgenteEnPapel = {
  id: EstrategiaId;
  agente: string;
  nombre: string;
  regla: string;
  ops: Operacion[];
  /** La señal de la última rueda cerrada, con su plan; null si hoy no dispara. */
  senalHoy: PlanAr | null;
};

/** El plan de una señal en la rueda `i`, con el cierre como referencia: SL, TP1, TP2 y TP3. */
export function planDe(v: SwingCandle[], i: number, s: Senal): PlanAr | null {
  const ref = v[i].close;
  let esc: Escalera | null;
  if (s.tp1 !== undefined && s.tp2 !== undefined) {
    const e = { stop: s.stop, tp1: s.tp1, tp2: s.tp2, tp3: s.objetivo };
    esc = escaleraValida(s.lado, ref, e) ? e : null;
  } else esc = escaleraHacia(s.lado, ref, s.stop, s.objetivo);
  if (!esc) return null;
  const riesgo = Math.abs(ref - esc.stop);
  return riesgo > 0 ? { rueda: v[i].openTime, referencia: ref, escalera: esc, rr: Math.abs(esc.tp3 - ref) / riesgo } : null;
}

/** Todos los agentes sobre un papel: sus operaciones pasadas (solo compras) y la señal de la última rueda cerrada. */
export function estudiarPapel(simbolo: string, velas: SwingCandle[]): AgenteEnPapel[] {
  if (velas.length < 60) return [];
  const ind = indicadores(velas);
  const ultima = velas.length - 1;
  return agentesAr().map((e) => {
    const senal = (i: number) => soloCompras(e.senal(velas, ind, i));
    // operarSenales no usa la última rueda (no hay apertura siguiente): la señal de hoy va aparte y no cuenta como resultado.
    const ops = operarSenales(e.id, simbolo, velas, senal, ESTUDIO_AR);
    const hoy = senal(ultima);
    return { id: e.id, agente: e.agente, nombre: e.nombre, regla: e.regla, ops, senalHoy: hoy ? planDe(velas, ultima, hoy) : null };
  });
}

export type AgenteUniverso = {
  id: EstrategiaId;
  agente: string;
  nombre: string;
  papeles: number;
  medicion: Medicion;
  veredicto: Veredicto;
};

/** Cada agente con las operaciones de todos los papeles juntas, contra el agente de azar. */
export function medirUniverso(porPapel: AgenteEnPapel[][]): AgenteUniverso[] {
  const porAgente = new Map<EstrategiaId, { a: AgenteEnPapel; ops: Operacion[]; papeles: number }>();
  for (const lista of porPapel)
    for (const a of lista) {
      const x = porAgente.get(a.id) ?? { a, ops: [], papeles: 0 };
      x.ops.push(...a.ops);
      x.papeles += 1;
      porAgente.set(a.id, x);
    }
  const control = porAgente.get("AZAR");
  const mControl = control ? medir(control.ops) : null;
  return [...porAgente.values()].map(({ a, ops, papeles }) => {
    const m = medir(ops);
    return { id: a.id, agente: a.agente, nombre: a.nombre, papeles, medicion: m, veredicto: a.id === "AZAR" ? "SIN CONCLUSIÓN" : veredicto(m, mControl) };
  });
}
