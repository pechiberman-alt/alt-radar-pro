import { arNumber } from "./ai-numbers.ts";
import { AGENT_WEIGHTS, type AgentId, type AgentReport } from "./jarvis-desk-agents.ts";
import { AGAINST_EDGE, CONSENSUS_EDGE, MAX_OPEN_RISK_PCT, MIN_RR, type DeskDecision, type DeskSettings, type Side } from "./jarvis-desk.ts";
import { MIN_SAMPLE, openR, paperStats, type PaperState, type PaperStats, type PaperTrade } from "./jarvis-paper.ts";

/**
 * El tablero de mando de JARVIS TRADING: la misma decisión de la mesa, vista
 * por dentro. Cada especialista con su voto (de −1 bajista a +1 alcista), su
 * peso y lo que aporta al consenso; las compuertas que separan el consenso de
 * la decisión; el capital que tienen en riesgo las operaciones de papel; y la
 * cinta de esas operaciones.
 *
 * No calcula nada nuevo sobre el mercado ni inventa probabilidades: reordena y
 * explica los números que la mesa ya tiene. El consenso mide cuánto coinciden
 * los especialistas, no la probabilidad de acertar; lo que sí está medido es el
 * registro del papel, siempre con su tamaño de muestra.
 */

/** Desde acá un voto cuenta como empuje a favor o en contra (el mismo umbral con que la mesa cuenta quién coincide). */
export const SESGO_MINIMO = 0.05;

const dec = (v: number, d = 2) => arNumber(Number(v.toFixed(d)));
/** Con signo y coma decimal: «+0,38», «−0,12», «0». */
export const signed = (v: number, d = 2) => {
  const r = Number(v.toFixed(d));
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${arNumber(Math.abs(r))}`;
};
/** Dos decimales fijos con coma: los umbrales de la mesa se escriben «0,30», no «0,3». */
export const fix2 = (v: number) => v.toFixed(2).replace(".", ",");
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const round3 = (v: number) => Number(v.toFixed(3));
const pctOf = (share: number) => `${Math.round(share * 100)}%`;
const rr = (v: number) => `1:${dec(v)}`;

// ── El consejo: quién vota qué, con qué peso ──

export type Voto = {
  id: AgentId;
  nombre: string;
  /** VOTA: tuvo datos y opina de dirección. SIN DATOS: no tuvo datos y no cuenta. CONTEXTO: tuvo datos pero no vota (por ejemplo, mide la volatilidad). */
  estado: "VOTA" | "SIN DATOS" | "CONTEXTO";
  /** De −1 bajista a +1 alcista; null si no tuvo datos. */
  sesgo: number | null;
  /** Peso base del especialista (los diez suman 1). */
  pesoBase: number;
  /** Su parte del consenso entre los que votan (suman 1). 0 si no vota. */
  parte: number;
  /** sesgo × parte: lo que suma o resta al consenso. Los aportes de todos suman el consenso. */
  aporte: number;
  postura: "ALCISTA" | "BAJISTA" | "NEUTRAL" | null;
  /** Respecto de hacia dónde se inclina el consenso; null si el consenso no se inclina. */
  frente: "A FAVOR" | "EN CONTRA" | "NEUTRAL" | null;
  /** Lo primero que encontró, con sus números. */
  hallazgo: string | null;
  falta: string[];
};

export type Pivotal = { id: AgentId; nombre: string; aporte: number; /** El consenso si este especialista quedara neutral. */ sinSuVoto: number };

export type Consejo = {
  votos: Voto[];
  consenso: number;
  /** Consenso mínimo (±) para que la mesa tome un lado. */
  minimo: number;
  /** Desde acá el consenso ya va en contra de un plan y el gestor de riesgo lo veta. */
  vetoContra: number;
  /** Qué parte del peso total tuvo datos (0 a 1). */
  cobertura: number;
  /** Parte del peso de los que votan que empuja al alza, a la baja o no empuja (suman 1; 0 si nadie vota). */
  alcista: number;
  bajista: number;
  neutral: number;
  inclinacion: "ALCISTA" | "BAJISTA" | "SIN INCLINACIÓN";
  /** El lado que el consenso alcanza para tomar, o null. Después el gestor de riesgo decide. */
  lado: Side | null;
  /** Cuánto sobra (positivo) o falta (negativo) del consenso para llegar al mínimo. */
  margen: number;
  disidentes: Voto[];
  /** Los que, si quedaran neutrales, harían que la mesa deje de tomar el lado. */
  pivotales: Pivotal[];
  votan: number;
  sinDatos: number;
  resumen: string;
  fragilidad: string | null;
};

const postureOf = (s: number): NonNullable<Voto["postura"]> => (s >= SESGO_MINIMO ? "ALCISTA" : s <= -SESGO_MINIMO ? "BAJISTA" : "NEUTRAL");

export function council(d: Pick<DeskDecision, "agentes" | "consenso" | "cobertura">): Consejo {
  const reports: AgentReport[] = d.agentes;
  const voters = reports.filter((a) => a.peso > 0);
  const total = voters.reduce((p, a) => p + a.peso, 0);
  const consenso = d.consenso;
  const inclinacion: Consejo["inclinacion"] = consenso >= SESGO_MINIMO ? "ALCISTA" : consenso <= -SESGO_MINIMO ? "BAJISTA" : "SIN INCLINACIÓN";
  const lean = inclinacion === "ALCISTA" ? 1 : inclinacion === "BAJISTA" ? -1 : 0;

  const votos: Voto[] = reports.map((a) => {
    const vota = a.peso > 0 && total > 0;
    const parte = vota ? a.peso / total : 0;
    const estado: Voto["estado"] = vota ? "VOTA" : a.disponible ? "CONTEXTO" : "SIN DATOS";
    const sesgo = a.disponible ? a.sesgo : null;
    const postura = vota ? postureOf(a.sesgo) : null;
    const frente: Voto["frente"] = !vota || lean === 0 ? null : Math.sign(a.sesgo) === lean && Math.abs(a.sesgo) >= SESGO_MINIMO ? "A FAVOR" : Math.sign(a.sesgo) === -lean && Math.abs(a.sesgo) >= SESGO_MINIMO ? "EN CONTRA" : "NEUTRAL";
    return {
      id: a.id,
      nombre: a.nombre,
      estado,
      sesgo,
      pesoBase: AGENT_WEIGHTS[a.id],
      parte,
      aporte: vota ? a.sesgo * parte : 0,
      postura,
      frente,
      hallazgo: a.disponible ? (a.hallazgos[0] ?? null) : null,
      falta: a.faltantes,
    };
  });
  // Los que votan primero, el de más peso arriba; después los que dan contexto; al final los que no tuvieron datos.
  const rank = (v: Voto) => (v.estado === "VOTA" ? 0 : v.estado === "CONTEXTO" ? 1 : 2);
  votos.sort((a, b) => rank(a) - rank(b) || b.parte - a.parte || Math.abs(b.aporte) - Math.abs(a.aporte));

  const share = (f: (v: Voto) => boolean) => votos.filter((v) => v.estado === "VOTA" && f(v)).reduce((p, v) => p + v.parte, 0);
  const alcista = share((v) => (v.sesgo ?? 0) >= SESGO_MINIMO);
  const bajista = share((v) => (v.sesgo ?? 0) <= -SESGO_MINIMO);
  const neutral = total > 0 ? Math.max(0, 1 - alcista - bajista) : 0;

  const lado: Side | null = consenso >= CONSENSUS_EDGE ? "LONG" : consenso <= -CONSENSUS_EDGE ? "SHORT" : null;
  const margen = round3(Math.abs(consenso) - CONSENSUS_EDGE);
  const disidentes = votos.filter((v) => v.frente === "EN CONTRA").sort((a, b) => Math.abs(b.aporte) - Math.abs(a.aporte));
  const pivotales: Pivotal[] = lado
    ? votos
        .filter((v) => v.frente === "A FAVOR" && Math.abs(consenso - v.aporte) < CONSENSUS_EDGE)
        .sort((a, b) => Math.abs(b.aporte) - Math.abs(a.aporte))
        .map((v) => ({ id: v.id, nombre: v.nombre, aporte: v.aporte, sinSuVoto: round3(consenso - v.aporte) }))
    : [];

  const votan = votos.filter((v) => v.estado === "VOTA").length;
  const sinDatos = votos.filter((v) => v.estado === "SIN DATOS").length;
  const nAlza = votos.filter((v) => v.estado === "VOTA" && (v.sesgo ?? 0) >= SESGO_MINIMO).length;
  const nBaja = votos.filter((v) => v.estado === "VOTA" && (v.sesgo ?? 0) <= -SESGO_MINIMO).length;
  const nNeutral = votan - nAlza - nBaja;

  let resumen: string;
  if (!votan) {
    resumen = "Ningún especialista tuvo datos para votar: la mesa no tiene consenso. Este dato no está disponible actualmente.";
  } else {
    const reparto = `${plural(nAlza, "especialista empuja", "especialistas empujan")} al alza (${pctOf(alcista)} del peso), ${plural(nBaja, "a la baja", "a la baja")} (${pctOf(bajista)}) y ${plural(nNeutral, "queda neutral", "quedan neutrales")}.`;
    const regla = lado
      ? `El consenso es ${signed(consenso)}: supera por ${fix2(margen)} el mínimo de ${fix2(CONSENSUS_EDGE)}, así que la mesa toma ${lado} si el riesgo cierra.`
      : `El consenso es ${signed(consenso)} y la mesa pide al menos ${fix2(CONSENSUS_EDGE)} (en cualquier sentido) para tomar un lado: faltan ${fix2(-margen)}. Por eso espera.`;
    resumen = `${reparto} ${regla}`;
  }

  const fragilidad = pivotales.length
    ? `Decisión ajustada: si ${pivotales.length === 1 ? "este especialista quedara neutral" : "cualquiera de estos especialistas quedara neutral"}, el consenso pasaría de ${signed(consenso)} a ${pivotales.map((p) => `${signed(p.sinSuVoto)} (${p.nombre.toLowerCase()})`).join(" o ")}, por debajo del mínimo, y la mesa dejaría de tomar el lado.`
    : null;

  return { votos, consenso, minimo: CONSENSUS_EDGE, vetoContra: AGAINST_EDGE, cobertura: d.cobertura, alcista, bajista, neutral, inclinacion, lado, margen, disidentes, pivotales, votan, sinDatos, resumen, fragilidad };
}

// ── Del consenso a la decisión: las compuertas ──

export type Compuerta = {
  id: "consenso" | "plan" | "riesgo" | "momento";
  titulo: string;
  estado: "OK" | "FALLA" | "NO EVALUADA";
  detalle: string;
};

/**
 * Los cuatro pasos entre el consenso y la decisión, en el orden en que la mesa
 * los resuelve. El primero que falla frena la decisión; los que siguen quedan
 * sin evaluar. El gestor de riesgo veta (NO TRADE) o pide esperar (ESPERAR) y
 * gana a cualquier confianza.
 */
export function gates(d: DeskDecision): Compuerta[] {
  const c = d.consenso;
  const takes = Math.abs(c) >= CONSENSUS_EDGE;
  const out: Compuerta[] = [];
  out.push({
    id: "consenso",
    titulo: "Consenso",
    estado: takes ? "OK" : "FALLA",
    detalle: takes
      ? `${signed(c)}: supera el mínimo de ±${fix2(CONSENSUS_EDGE)} y la mesa se inclina a ${c > 0 ? "LONG" : "SHORT"}.`
      : `${signed(c)}: no llega al mínimo de ±${fix2(CONSENSUS_EDGE)} (faltan ${fix2(CONSENSUS_EDGE - Math.abs(c))}). Sin lado no hay plan.`,
  });
  const hasPlan = d.plan !== null && d.riesgo !== null;
  out.push({
    id: "plan",
    titulo: "Plan",
    estado: !takes ? "NO EVALUADA" : hasPlan ? "OK" : "FALLA",
    detalle: !takes ? "Todavía no hay lado elegido." : hasPlan ? `${d.plan!.lado}: entrada ${arNumber(d.plan!.entrada)}, stop ${arNumber(d.plan!.stop)} y tres objetivos.` : "No se pudo armar un plan con stop y objetivos válidos.",
  });
  const vetos = d.riesgo?.vetos ?? [];
  const reviewed = takes && hasPlan;
  out.push({
    id: "riesgo",
    titulo: "Gestor de riesgo",
    estado: !reviewed ? "NO EVALUADA" : vetos.length ? "FALLA" : "OK",
    detalle: !reviewed ? "Sin plan no hay nada que revisar." : vetos.length ? `Veto: ${vetos.join(" ")}` : `R:R ${rr(d.riesgo!.rrPonderado)} (mínimo ${rr(MIN_RR)}) · riesgo ${d.riesgo!.nivel}.`,
  });
  const waits = d.riesgo?.esperas ?? [];
  const passed = reviewed && vetos.length === 0;
  out.push({
    id: "momento",
    titulo: "Momento",
    estado: !passed ? "NO EVALUADA" : waits.length ? "FALLA" : "OK",
    detalle: !passed ? "Antes tiene que pasar el riesgo." : waits.length ? `Esperar: ${waits.join(" ")}` : "Nada pide esperar: ni un evento cerca ni el precio lejos de la entrada.",
  });
  return out;
}

// ── Capital en riesgo (papel) ──

export type CapitalEnRiesgo = {
  capital: number | null;
  riesgoPorOperacionPct: number;
  /** Operaciones de papel abiertas o pendientes de llenar. */
  abiertas: number;
  largos: number;
  cortos: number;
  /** Lo que se pierde si se tocan todos los stops, de las que tienen el riesgo calculado. */
  riesgoAbiertoUsd: number;
  /** Abiertas sin riesgo calculado (se abrieron sin capital cargado): no se cuentan como cero, se dicen. */
  sinRiesgoCalculado: number;
  riesgoAbiertoPct: number | null;
  /** Límite del riesgo abierto, en % del capital. */
  limitePct: number;
  /** Con la operación de la tarjeta, si tiene riesgo calculado. */
  conEsta: { riesgoUsd: number; totalUsd: number; totalPct: number | null; superaLimite: boolean | null } | null;
  /** Resultado de las abiertas con precio conocido, en R. */
  resultadoAbiertoR: number | null;
  sinPrecio: number;
  notas: string[];
};

const isLive = (t: PaperTrade) => t.estado === "ABIERTA" || t.estado === "PENDIENTE";

export function capitalAtRisk(trades: PaperTrade[], settings: DeskSettings, d: DeskDecision | null, priceOf: (symbol: string) => number | null): CapitalEnRiesgo {
  const live = trades.filter(isLive);
  const known = live.filter((t) => typeof t.decision.riesgoUsd === "number" && t.decision.riesgoUsd > 0);
  const riesgoAbiertoUsd = known.reduce((p, t) => p + t.decision.riesgoUsd!, 0);
  const capital = settings.capital && settings.capital > 0 ? settings.capital : null;
  const riesgoAbiertoPct = capital ? round3((riesgoAbiertoUsd / capital) * 100) : null;
  const largos = live.filter((t) => t.lado === "LONG").length;
  const cortos = live.length - largos;

  const filled = live.filter((t) => t.estado === "ABIERTA");
  const rs = filled.map((t) => {
    const price = priceOf(t.symbol);
    return price !== null && price > 0 ? openR(t, price) : null;
  });
  const sinPrecio = rs.filter((r) => r === null).length;
  const resultadoAbiertoR = filled.length && sinPrecio < filled.length ? rs.reduce<number>((p, r) => p + (r ?? 0), 0) : null;

  // Solo una operación aprobada (LONG o SHORT) se puede seguir en papel: una vetada o en espera no suma riesgo.
  const approved = d?.direccion === "LONG" || d?.direccion === "SHORT";
  const own = approved ? (d?.riesgo?.riesgoUsd ?? null) : null;
  const conEsta =
    own !== null && own > 0 && d?.plan
      ? (() => {
          const totalUsd = riesgoAbiertoUsd + own;
          const crudo = capital ? (totalUsd / capital) * 100 : null;
          // El veredicto usa el valor sin redondear (igual que el gestor de riesgo); el redondeo es solo para mostrar.
          return { riesgoUsd: own, totalUsd, totalPct: crudo === null ? null : round3(crudo), superaLimite: crudo === null ? null : crudo > MAX_OPEN_RISK_PCT };
        })()
      : null;

  const notas: string[] = [];
  if (!capital) notas.push("Cargá tu capital en «Mi riesgo» para ver cuánto de tu plata está en juego.");
  if (sinRiesgoCalculado(live)) notas.push(`${plural(sinRiesgoCalculado(live), "operación abierta no tiene", "operaciones abiertas no tienen")} el riesgo calculado (se abrieron sin capital cargado): su riesgo no está en la suma, no es cero.`);
  if (sinPrecio && filled.length) notas.push(`Sin precio reciente de ${plural(sinPrecio, "operación abierta", "operaciones abiertas")}: su resultado no está en la suma.`);
  if (live.length >= 2 && (largos === live.length || cortos === live.length)) {
    const lado = largos === live.length ? "LONG" : "SHORT";
    notas.push(`Las ${live.length} abiertas son ${lado}: si el mercado se da vuelta contra ese lado, pierden juntas.`);
  }
  if (conEsta && live.some((t) => t.lado === d!.plan!.lado)) notas.push(`Esta operación sumaría otra ${d!.plan!.lado} a las que ya tenés abiertas.`);
  if (conEsta?.superaLimite) notas.push(`Con esta operación el riesgo abierto pasaría del ${dec(MAX_OPEN_RISK_PCT)}% del capital: el gestor de riesgo lo avisa.`);

  return { capital, riesgoPorOperacionPct: settings.riesgoPct, abiertas: live.length, largos, cortos, riesgoAbiertoUsd, sinRiesgoCalculado: sinRiesgoCalculado(live), riesgoAbiertoPct, limitePct: MAX_OPEN_RISK_PCT, conEsta, resultadoAbiertoR, sinPrecio, notas };
}

function sinRiesgoCalculado(live: PaperTrade[]) {
  return live.filter((t) => !(typeof t.decision.riesgoUsd === "number" && t.decision.riesgoUsd > 0)).length;
}

// ── La cinta de papel ──

export type FilaCinta = {
  id: string;
  moneda: string;
  lado: Side;
  estado: PaperState;
  /** Cuándo se abrió. */
  cuando: number;
  /** Resultado en R: el final si cerró, el que va si sigue abierta con precio conocido, null si no se sabe. */
  r: number | null;
  texto: string;
  tono: "up" | "down" | "flat" | "pend";
};

const toneOf = (r: number | null): FilaCinta["tono"] => (r === null || Math.abs(r) < 0.05 ? "flat" : r > 0 ? "up" : "down");

/** Las últimas operaciones de papel, de la más nueva a la más vieja. */
export function tape(trades: PaperTrade[], priceOf: (symbol: string) => number | null, limit = 8): FilaCinta[] {
  return [...trades]
    .sort((a, b) => b.abiertaA - a.abiertaA)
    .slice(0, limit)
    .map((t) => {
      const moneda = t.symbol.replace(/USDT$/, "");
      const kinds = t.salidas.map((e) => e.kind).join(" → ");
      if (t.estado === "PENDIENTE") return { id: t.id, moneda, lado: t.lado, estado: t.estado, cuando: t.abiertaA, r: null, texto: t.tipoEntrada === "LÍMITE" ? "Orden límite sin llenar" : "Entrando…", tono: "pend" as const };
      if (t.estado === "CANCELADA") return { id: t.id, moneda, lado: t.lado, estado: t.estado, cuando: t.abiertaA, r: null, texto: "Cancelada", tono: "flat" as const };
      if (t.estado === "CERRADA") {
        const r = t.resultadoR;
        return { id: t.id, moneda, lado: t.lado, estado: t.estado, cuando: t.abiertaA, r, texto: r === null ? `Cerrada${kinds ? ` · ${kinds}` : ""}` : `${signed(r)} R${kinds ? ` · ${kinds}` : ""}`, tono: toneOf(r) };
      }
      const price = priceOf(t.symbol);
      const r = price !== null && price > 0 ? openR(t, price) : null;
      return { id: t.id, moneda, lado: t.lado, estado: t.estado, cuando: t.abiertaA, r, texto: `${r === null ? "Abierta" : `${signed(r)} R en curso`}${kinds ? ` · ${kinds}` : ""}`, tono: toneOf(r) };
    });
}

// ── Lo medido, con su muestra ──

export type Registro = {
  cerradas: number;
  ganadas: number;
  winRate: number | null;
  profitFactor: number | null;
  expectativaR: number | null;
  totalR: number;
  muestra: PaperStats["muestra"];
  /** Cuántas cerradas faltan para dejar de ser «muestra mínima». */
  faltan: number;
  nota: string;
};

/** El registro del papel hacia adelante: el único porcentaje que el tablero muestra, siempre con cuántas operaciones lo sostienen. */
export function record(trades: PaperTrade[]): Registro {
  const st = paperStats(trades);
  const faltan = Math.max(0, MIN_SAMPLE - st.cerradas);
  const nota =
    st.muestra === "SIN DATOS"
      ? "Todavía no hay operaciones de papel cerradas: no hay nada medido. El puntaje y el consenso no son una probabilidad."
      : st.muestra === "MUESTRA MÍNIMA"
        ? `Muestra mínima: ${st.cerradas} de ${MIN_SAMPLE} operaciones cerradas. Con tan pocas, el porcentaje todavía no dice nada.`
        : `Muestra de ${st.cerradas} operaciones cerradas de papel. Es lo ocurrido, no una promesa: no garantiza resultados futuros.`;
  return { cerradas: st.cerradas, ganadas: st.ganadas, winRate: st.winRate, profitFactor: st.profitFactor, expectativaR: st.expectativaR, totalR: st.totalR, muestra: st.muestra, faltan, nota };
}
