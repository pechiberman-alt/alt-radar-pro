/**
 * Estudio de la pizarra de cripto del servidor (lib/pizarra-servidor.ts) sobre el pasado: las mismas reglas, sin tocarlas,
 * vela de 4 h por vela de 4 h, con solo lo que se sabía en cada cierre (velas cerradas de 4 h y diarias de Binance; nada del
 * futuro). Los agentes de papel corren con sus reglas (lib/estrategias.ts, como lib/agentes-papel.ts: entrada a la apertura
 * siguiente, misma distancia en R) y su récord se va armando con sus cierres. Lo que NO está en el pasado: las señales del
 * núcleo de JARVIS (aprende de su propio historial) y las lentes de valor (cripto no tiene balances); el estudio lo dice.
 *
 * Mide, en tres períodos y con dos costos (0,07 % y 0,15 % por lado): todas las operaciones de los agentes (la base) y las
 * decisiones «hay plan» de la pizarra (todas, y una a la vez por moneda). Es pasado: no garantiza nada.
 *   node --experimental-strip-types scripts/investigacion/pizarra-estudio.ts   (ALT_RADAR_DATOS=carpeta con SIMBOLO-4h.json y SIMBOLO-1d.json)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { escaleraHacia, recorrer, type Escalera, type Lado } from "../../lib/escalera.ts";
import { ESTRATEGIAS, indicadores, operaEn } from "../../lib/estrategias.ts";
import { AGENTES_PAPEL, HORIZONTE_AGENTES, MARCO_AGENTES_MS } from "../../lib/agentes-papel.ts";
import { contar, estadistica } from "../../lib/registro.ts";
import { entradaPizarra, pizarraServidor, type AbiertaAgente } from "../../lib/pizarra-servidor.ts";
import type { EscritorioLite } from "../../lib/pizarra-activos.ts";
import type { SwingCandle } from "../../lib/swing-entries.ts";

const DATOS = process.env.ALT_RADAR_DATOS ?? "datos-investigacion";
const SALIDA = process.env.ALT_RADAR_SALIDA ?? "salida-investigacion";
const MONEDAS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT", "BCHUSDT", "ZECUSDT"];
const DIA = 86_400_000;
const PERIODOS = [
  { id: "2021–2022", desde: Date.UTC(2021, 0, 1), hasta: Date.UTC(2023, 0, 1) },
  { id: "2023–2024", desde: Date.UTC(2023, 0, 1), hasta: Date.UTC(2025, 0, 1) },
  { id: "2025–sep 2026", desde: Date.UTC(2025, 0, 1), hasta: Date.UTC(2026, 9, 1) },
];
const COSTOS = [0.07, 0.15];

const cargar = (sym: string, iv: string): SwingCandle[] =>
  (JSON.parse(readFileSync(`${DATOS}/${sym}-${iv}.json`, "utf8")) as number[][]).map(([t, o, h, l, c, v]) => ({ openTime: t, open: o, high: h, low: l, close: c, volume: v, quoteVolume: v * c }));

type OpAgente = { estrategia: string; agente: string; lado: Lado; vela: number; abre: number; cierra: number; entrada: number; esc: Escalera; r: Record<number, number | null> };
type OpPizarra = { sym: string; t: number; cierra: number; lado: Lado; r: Record<number, number | null> };

function resolver(lado: Lado, entrada: number, esc: Escalera, vela: number, v: SwingCandle[], desde: number, fee: number) {
  const tramo = v.slice(desde, desde + HORIZONTE_AGENTES + 2);
  const fin = (tramo.at(-1)?.openTime ?? vela) + MARCO_AGENTES_MS;
  return recorrer(lado, entrada, esc, vela, tramo, MARCO_AGENTES_MS, fin, { horizonte: HORIZONTE_AGENTES, feePct: fee });
}

function estudiarMoneda(sym: string) {
  const v = cargar(sym, "4h");
  const d = cargar(sym, "1d");
  const ind = indicadores(v);
  const estrategias = ESTRATEGIAS.filter((e) => AGENTES_PAPEL.includes(e.id) && operaEn(e, sym));
  const agentes: OpAgente[] = [];
  const porSenal = new Map<number, OpAgente[]>();
  for (let i = 0; i + 1 < v.length; i += 1) {
    for (const e of estrategias) {
      const s = e.senal(v, ind, i);
      if (!s) continue;
      const entrada = v[i + 1].open;
      const riesgo = Math.abs(v[i].close - s.stop);
      const rr = Math.abs(s.objetivo - v[i].close) / riesgo;
      if (!(entrada > 0) || !(riesgo > 0) || !Number.isFinite(rr)) continue;
      const signo = s.lado === "LONG" ? 1 : -1;
      const esc = escaleraHacia(s.lado, entrada, entrada - signo * riesgo, entrada + signo * rr * riesgo);
      if (!esc) continue;
      const r: Record<number, number | null> = {};
      let cierra = Infinity;
      for (const fee of COSTOS) {
        const rec = resolver(s.lado, entrada, esc, v[i].openTime, v, i + 1, fee);
        r[fee] = rec.desenlace === "ABIERTA" ? null : rec.r;
        if (rec.cerradaA !== null) cierra = rec.cerradaA;
      }
      const op: OpAgente = { estrategia: e.id, agente: e.agente, lado: s.lado, vela: v[i].openTime, abre: v[i + 1].openTime, cierra, entrada, esc, r };
      agentes.push(op);
      porSenal.set(i, [...(porSenal.get(i) ?? []), op]);
    }
  }
  // Por estrategia: sus operaciones en orden de apertura y, para su récord, los cierres en orden con sumas acumuladas.
  const VENTANA = (HORIZONTE_AGENTES + 2) * MARCO_AGENTES_MS;
  const porEstrategia = new Map<string, { ops: OpAgente[]; cierres: number[]; acum: { cerradas: number; ganadas: number; perdidas: number; empatadas: number; ganado: number; perdido: number; neto: number }[] }>();
  for (const e of estrategias) {
    const ops = agentes.filter((o) => o.estrategia === e.id);
    const cerr = ops.filter((o) => o.r[0.07] !== null && Number.isFinite(o.cierra)).sort((x, y) => x.cierra - y.cierra);
    const acum = [{ cerradas: 0, ganadas: 0, perdidas: 0, empatadas: 0, ganado: 0, perdido: 0, neto: 0 }];
    for (const o of cerr) {
      const q = { ...acum.at(-1)! };
      const r = o.r[0.07] as number;
      q.cerradas += 1;
      q.neto += r;
      if (r > 0) {
        q.ganadas += 1;
        q.ganado += r;
      } else if (r < 0) {
        q.perdidas += 1;
        q.perdido += -r;
      } else q.empatadas += 1;
      acum.push(q);
    }
    porEstrategia.set(e.id, { ops, cierres: cerr.map((o) => o.cierra), acum });
  }
  const hasta = (xs: number[], t: number) => {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (xs[m] <= t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const pizarra: OpPizarra[] = [];
  let di = 0;
  for (let i = 1; i + 1 < v.length; i += 1) {
    if (!porSenal.has(i) && !porSenal.has(i - 1)) continue; // sin señal fresca no hay plan posible
    const ahora = v[i].openTime + MARCO_AGENTES_MS;
    if (ahora < PERIODOS[0].desde) continue;
    while (di < d.length && d[di].openTime + DIA <= ahora) di += 1;
    const d1 = d.slice(Math.max(0, di - 320), di);
    const escritorios: EscritorioLite[] = [];
    const abiertas: AbiertaAgente[] = [];
    for (const e of estrategias) {
      const x = porEstrategia.get(e.id)!;
      const k = hasta(x.cierres, ahora);
      const c = x.acum[k];
      const abiertasDe: OpAgente[] = [];
      for (let j = x.ops.length - 1; j >= 0 && x.ops[j].abre > ahora - VENTANA; j -= 1) {
        const o = x.ops[j];
        if (o.abre <= ahora && o.cierra > ahora) abiertasDe.push(o);
      }
      escritorios.push({ id: e.id, agente: e.agente, abiertas: abiertasDe.map((o) => ({ symbol: sym, lado: o.lado, detectada: o.abre })), total: estadistica({ abiertas: abiertasDe.length, ...c }) });
      for (const o of abiertasDe) abiertas.push({ clave: `sv:${o.estrategia}:${sym}:4h:${o.lado}:${o.vela}`, lado: o.lado, vela: o.vela, entrada: o.entrada, sl: o.esc.stop, tp1: o.esc.tp1, tp2: o.esc.tp2, tp3: o.esc.tp3 });
    }
    const p = pizarraServidor({ symbol: sym, d1, escritorios, nucleo: [], agentes: abiertas, ahora });
    const { entrada } = entradaPizarra(sym, v.slice(Math.max(0, i - 2), i + 1), p.deliberacion, ahora);
    if (!entrada) continue;
    const r: Record<number, number | null> = {};
    let cierra = Infinity;
    for (const fee of COSTOS) {
      const rec = resolver(entrada.lado, entrada.entrada, entrada.escalera, entrada.vela, v, i + 1, fee);
      r[fee] = rec.desenlace === "ABIERTA" ? null : rec.r;
      if (rec.cerradaA !== null) cierra = rec.cerradaA;
    }
    pizarra.push({ sym, t: ahora, cierra, lado: entrada.lado, r });
  }
  return { agentes: agentes.map((o) => ({ t: o.abre, cierra: o.cierra, r: o.r })), pizarra };
}

type Fila = { t: number; cierra: number; r: Record<number, number | null>; sym?: string };

function medir(ops: Fila[], fee: number) {
  const rs = ops.map((o) => o.r[fee]).filter((r): r is number => r !== null && Number.isFinite(r));
  const e = estadistica(contar(rs.map((r) => ({ r, abierta: false }))));
  const n = rs.length;
  const m = n ? rs.reduce((s, r) => s + r, 0) / n : 0;
  const de = n > 1 ? Math.sqrt(rs.reduce((s, r) => s + (r - m) ** 2, 0) / (n - 1)) : 0;
  const t = n > 1 && de > 0 ? m / (de / Math.sqrt(n)) : null;
  return { n, acierto: e.winRate, expectancia: n ? m : null, pf: e.profitFactor, t };
}

/** Una a la vez por moneda: si hay una abierta en esa moneda, la siguiente no entra. */
function unaALaVez(ops: Fila[]): Fila[] {
  const out: Fila[] = [];
  const libre = new Map<string, number>();
  for (const o of [...ops].sort((a, b) => a.t - b.t)) {
    const k = o.sym ?? "";
    if ((libre.get(k) ?? 0) > o.t) continue;
    out.push(o);
    libre.set(k, o.cierra);
  }
  return out;
}

const resultados: Record<string, unknown> = {};
const todasAg: Fila[] = [];
const todasPz: Fila[] = [];
for (const sym of MONEDAS) {
  const a = Date.now();
  const r = estudiarMoneda(sym);
  todasAg.push(...r.agentes.map((x) => ({ ...x, sym })));
  todasPz.push(...r.pizarra);
  console.error(`${sym}: ${r.agentes.length} operaciones de agentes, ${r.pizarra.length} decisiones de la pizarra (${Math.round((Date.now() - a) / 1000)} s)`);
}
const lineas: string[] = [];
const f = (x: number | null, d = 2) => (x === null ? "—" : x.toFixed(d).replace(".", ","));
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);
for (const fee of COSTOS) {
  lineas.push(`\n### Costo ${String(fee).replace(".", ",")} % por lado\n`);
  lineas.push("| Período | Grupo | n | Acierto | Expectancia (R) | PF | t |");
  lineas.push("|---|---|---|---|---|---|---|");
  for (const p of PERIODOS) {
    const en = (ops: Fila[]) => ops.filter((o) => o.t >= p.desde && o.t < p.hasta);
    const grupos: [string, Fila[]][] = [
      ["Agentes (todas)", en(todasAg)],
      ["Pizarra (todas)", en(todasPz)],
      ["Pizarra (una a la vez por moneda)", unaALaVez(en(todasPz))],
    ];
    for (const [nombre, ops] of grupos) {
      const m = medir(ops, fee);
      resultados[`${fee}|${p.id}|${nombre}`] = m;
      lineas.push(`| ${p.id} | ${nombre} | ${m.n} | ${pct(m.acierto)} | ${f(m.expectancia)} | ${f(m.pf)} | ${f(m.t)} |`);
    }
  }
}
console.log(lineas.join("\n"));
try {
  writeFileSync(`${SALIDA}/pizarra-estudio.json`, JSON.stringify(resultados, null, 1));
} catch {
  // Sin carpeta de salida: alcanza con la tabla.
}
