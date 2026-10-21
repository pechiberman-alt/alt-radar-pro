/**
 * El aprendizaje diario de la oficina (PLAN_APRENDIZAJE_1): cada día (de Argentina) se arma un diario con lo que cerraron los
 * agentes ese día y lo que dice el registro completo hasta ese día, comparando los resultados según el mapa de liquidaciones al
 * entrar (lib/mapa-contexto.ts: zona detrás del stop, zona en el camino, liquidez junto al stop) y según el consenso.
 *
 * Aprender acá es medir y contarlo, no cambiar reglas: ninguna comparación filtra entradas ni toca una regla (eso lo decide la
 * persona y va por un PR revisado). Cada número sale de contar/estadistica del registro (lib/registro.ts) y va con su muestra;
 * una comparación es firme solo con 15 cierres o más de cada lado, y aun firme es una comparación, no una causa.
 * El servidor guarda el diario de su plan una vez por día (lib/aprendizaje-diario-db.ts); el de tu cuenta se arma en el
 * navegador con tus filas. Pura.
 */
import { acuerdoDe, leccionesDe, resumenGrupo } from "./agentes-mente.ts";
import { forAi } from "./ai-numbers.ts";
import { fotoDeJson, type FotoMapa } from "./mapa-contexto.ts";
import { agenteDeClave, nombreActivo, plantel, type FilaOficina } from "./oficina.ts";
import { contar, estadistica, MUESTRA_MINIMA, type Estadistica } from "./registro.ts";

export const PLAN_APRENDIZAJE = "PLAN_APRENDIZAJE_1";
/** Argentina: UTC−3 todo el año. Los días del diario son días de acá. */
export const DESFASE_AR_MS = -3 * 3_600_000;
export const DIA_MS = 86_400_000;
export const DIAS_DIARIO = 7;

export type TemaDiario = "DETRAS" | "DELANTE" | "LIQUIDEZ" | "CONSENSO";
export type Grupo = { etiqueta: string; est: Estadistica };
export type Comparacion = { tema: TemaDiario; si: Grupo; no: Grupo; firme: boolean; separados: boolean; texto: string };
export type Movida = { agente: string; symbol: string; r: number };
export type Diario = {
  v: 1;
  plan: string;
  dia: string;
  delDia: { cierres: number; ganadoras: number; netoR: number; mejor: Movida | null; peor: Movida | null };
  /** Todo el registro leído hasta el final del día. */
  total: Estadistica;
  /** Cuántos de esos cierres tienen foto del mapa (las entradas anteriores a la foto no la tienen). */
  conFoto: number;
  comparaciones: Comparacion[];
  novedades: string[];
};

/** El día de Argentina de un instante, «AAAA-MM-DD». */
export const diaAr = (t: number) => new Date(t + DESFASE_AR_MS).toISOString().slice(0, 10);
/** Desde y hasta (sin incluir) de un día de Argentina, en milisegundos UTC. */
export function limitesDia(dia: string): { desde: number; hasta: number } {
  const desde = Date.parse(`${dia}T00:00:00Z`) - DESFASE_AR_MS;
  return { desde, hasta: desde + DIA_MS };
}
export const diaAnterior = (dia: string) => diaAr(limitesDia(dia).desde - 1);

const cerradaValida = (f: FilaOficina) => f.desenlace !== "ABIERTA" && typeof f.r === "number" && Number.isFinite(f.r) && typeof f.cerrada === "number";
const est = (fs: FilaOficina[]) => estadistica(contar(fs.map((f) => ({ r: f.r, abierta: false }))));
const r2 = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100) / 100).toFixed(2).replace(".", ",")} R`;

const TEMAS: { tema: TemaDiario; si: string; no: string; de: (f: FilaOficina, foto: FotoMapa | null) => boolean | null }[] = [
  { tema: "DETRAS", si: "Con una zona de confluencia detrás del stop", no: "sin zona detrás", de: (_f, m) => (m ? m.detras > 0 : null) },
  { tema: "DELANTE", si: "Con una zona en el camino al objetivo", no: "con el camino libre", de: (_f, m) => (m ? m.delante !== null : null) },
  { tema: "LIQUIDEZ", si: "Con el stop junto a liquidez sin barrer", no: "con el stop lejos de la liquidez", de: (_f, m) => (m ? m.liquidezStop : null) },
  {
    tema: "CONSENSO",
    si: "Entrando acompañado por otro agente",
    no: "entrando solo",
    de: (f) => {
      const a = acuerdoDe(f.foto);
      return a === null ? null : a >= 1;
    },
  },
];

function comparar(cerradas: FilaOficina[]): Comparacion[] {
  const fotos = new Map(cerradas.map((f) => [f, fotoDeJson(f.foto)] as const));
  return TEMAS.map((t) => {
    const si: FilaOficina[] = [];
    const no: FilaOficina[] = [];
    for (const f of cerradas) {
      const v = t.de(f, fotos.get(f) ?? null);
      if (v === true) si.push(f);
      else if (v === false) no.push(f);
    }
    const a = est(si);
    const b = est(no);
    const firme = a.cerradas >= MUESTRA_MINIMA && b.cerradas >= MUESTRA_MINIMA;
    // Separados: los intervalos del acierto (90 %) no se pisan. Aun así es una comparación, no una causa.
    const separados = firme && a.intervalo !== null && b.intervalo !== null && (a.intervalo.low > b.intervalo.high || b.intervalo.low > a.intervalo.high);
    const juicio = !firme
      ? `Todavía no es firme: hacen falta ${MUESTRA_MINIMA} cierres de cada lado.`
      : separados
        ? "La diferencia en el acierto se sostiene con 90 % de confianza (es una comparación, no una causa)."
        : "Con esta muestra la diferencia todavía puede ser ruido: los intervalos se pisan.";
    return {
      tema: t.tema,
      si: { etiqueta: t.si, est: a },
      no: { etiqueta: t.no, est: b },
      firme,
      separados,
      texto: a.cerradas + b.cerradas === 0 ? `${t.si}: todavía no hay cierres para comparar.` : `${t.si}: ${resumenGrupo(a)}. ${t.no[0].toUpperCase()}${t.no.slice(1)}: ${resumenGrupo(b)}. ${juicio}`,
    };
  });
}

/** El diario de un día: lo que cerró ese día y lo que dice todo el registro hasta el final de ese día. */
export function armarDiario(filas: FilaOficina[], dia: string, plan: string): Diario {
  const { desde, hasta } = limitesDia(dia);
  const nombres = new Map(plantel(true).map((p) => [p.id, p.agente.replace(/^Agente\s+/, "")] as const));
  const nombreDe = (f: FilaOficina) => nombres.get(agenteDeClave(f.clave) ?? "") ?? "agente";
  const hastaHoy = filas.filter((f) => cerradaValida(f) && (f.cerrada as number) < hasta && agenteDeClave(f.clave) !== null);
  const hoy = hastaHoy.filter((f) => (f.cerrada as number) >= desde);
  const orden = [...hoy].sort((a, b) => (b.r as number) - (a.r as number));
  const movida = (f: FilaOficina | undefined): Movida | null => (f ? { agente: nombreDe(f), symbol: f.symbol, r: f.r as number } : null);
  const comparaciones = comparar(hastaHoy);
  const ayer = comparar(hastaHoy.filter((f) => (f.cerrada as number) < desde));

  const novedades: string[] = [];
  for (const c of comparaciones) {
    const antes = ayer.find((x) => x.tema === c.tema);
    if (c.firme && !antes?.firme) novedades.push(`Se hizo firme: ${c.texto}`);
  }
  // Las lecciones de cada agente que se hicieron firmes hoy, y los que cerraron por primera vez.
  const porAgente = new Map<string, FilaOficina[]>();
  for (const f of hastaHoy) {
    const id = agenteDeClave(f.clave) as string;
    porAgente.set(id, [...(porAgente.get(id) ?? []), f]);
  }
  for (const [id, fs] of porAgente) {
    const nombre = nombres.get(id) ?? id;
    const previas = fs.filter((f) => (f.cerrada as number) < desde);
    if (!previas.length && fs.length) novedades.push(`${nombre} cerró su primera operación.`);
    const firmesAntes = new Set(leccionesDe(previas).filter((l) => l.firme).map((l) => l.tema));
    for (const l of leccionesDe(fs).filter((x) => x.firme && !firmesAntes.has(x.tema))) novedades.push(`${nombre} tiene una lección firme nueva: ${l.texto}`);
  }
  if (!hoy.length) novedades.unshift("Este día no cerró ninguna operación: no hay nada nuevo que aprender, solo esperar.");

  return {
    v: 1,
    plan,
    dia,
    delDia: {
      cierres: hoy.length,
      ganadoras: hoy.filter((f) => (f.r as number) > 0).length,
      netoR: Math.round(hoy.reduce((s, f) => s + (f.r as number), 0) * 100) / 100,
      mejor: orden.length ? movida(orden[0]) : null,
      peor: orden.length > 1 ? movida(orden[orden.length - 1]) : null,
    },
    total: est(hastaHoy),
    conFoto: hastaHoy.filter((f) => fotoDeJson(f.foto) !== null).length,
    comparaciones,
    novedades: novedades.slice(0, 8),
  };
}

/** Los diarios de los últimos `n` días hasta `hoy` (incluido), del más nuevo al más viejo. */
export function ultimosDiarios(filas: FilaOficina[], hoy: string, plan: string, n = DIAS_DIARIO): Diario[] {
  const out: Diario[] = [];
  let dia = hoy;
  for (let k = 0; k < n; k += 1) {
    out.push(armarDiario(filas, dia, plan));
    dia = diaAnterior(dia);
  }
  return out;
}

/** Un diario guardado, revisado: si no tiene la forma esperada, null (y se vuelve a armar con las filas). */
export function leerDiario(raw: unknown): Diario | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<Diario>;
  if (d.v !== 1 || typeof d.dia !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.dia) || typeof d.plan !== "string") return null;
  if (!d.delDia || !d.total || !Array.isArray(d.comparaciones) || !Array.isArray(d.novedades)) return null;
  return d as Diario;
}

const fechaCorta = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** El diario en una línea de resumen del día. */
export function resumenDia(d: Diario): string {
  const x = d.delDia;
  if (!x.cierres) return "Sin cierres.";
  const mejor = x.mejor ? ` Mejor: ${x.mejor.agente} en ${nombreActivo(x.mejor.symbol)} ${r2(x.mejor.r)}.` : "";
  const peor = x.peor ? ` Peor: ${x.peor.agente} en ${nombreActivo(x.peor.symbol)} ${r2(x.peor.r)}.` : "";
  return `${x.cierres} ${x.cierres === 1 ? "cierre" : "cierres"}, ${x.ganadoras} ${x.ganadoras === 1 ? "ganadora" : "ganadoras"}, ${r2(x.netoR)} en total.${mejor}${peor}`;
}

/** El diario para Telegram (HTML del bot). */
export function textoDiarioTelegram(d: Diario | null, plan = "servidor 24/7"): string {
  if (!d) return "📓 Todavía no hay diario: se arma cada noche a las 00:15 (Argentina) con lo que cerraron los agentes.";
  const partes = [
    `📓 <b>Diario de la oficina · ${fechaCorta(d.dia)}</b>\n<i>${esc(plan)}, papel. Cada agente con su regla fija.</i>`,
    `<b>El día</b>\n${esc(resumenDia(d))}`,
    `<b>Lo que aprendieron</b> (todo el registro, ${d.total.cerradas} cierres; ${d.conFoto} con foto del mapa)\n${d.comparaciones.map((c) => `• ${esc(c.texto)}`).join("\n")}`,
  ];
  if (d.novedades.length) partes.push(`<b>Novedades</b>\n${d.novedades.map((n) => `• ${esc(n)}`).join("\n")}`);
  partes.push("<i>Aprender es medir: ninguna regla cambia sola. No es asesoramiento financiero.</i>");
  return partes.join("\n\n");
}

/** El diario para la IA (JARVIS y los agentes), con los números en formato argentino. */
export function diarioParaIa(d: Diario | null): unknown {
  if (!d) return null;
  return forAi({
    dia: d.dia,
    elDia: resumenDia(d),
    cierresTotales: d.total.cerradas,
    conFotoDelMapa: d.conFoto,
    comparaciones: d.comparaciones.map((c) => ({ tema: c.tema, texto: c.texto, firme: c.firme })),
    novedades: d.novedades,
    nota: "Es papel. Aprender es medir: ninguna regla cambia sola.",
  });
}
