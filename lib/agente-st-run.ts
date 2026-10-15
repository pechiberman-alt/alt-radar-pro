/**
 * El agente de papel Supertrend MTF + Volumen para tu cuenta, desde el navegador (reglas en lib/agente-st.ts). Cada 4
 * horas, durante la primera media hora de la vela nueva, lee las velas de 4 h de las 10 monedas del estudio (datos
 * públicos de Binance, desde tu navegador), busca la entrada de la última vela cerrada —la suya y la de todos los agentes del estudio (lib/agentes-papel.ts), que leen
 * esas mismas velas— y la registra con su plan completo
 * (SL, TP1, TP2 y TP3) y su foto de condiciones. Las abiertas se miden con las velas que ya cerraron y se mandan a tu
 * cuenta. Solo corre con la pestaña visible y con sesión: si no estás ahí cuando abre la vela, esa entrada no se registra
 * (no se rellena después, porque ya no sería la entrada que se midió). Solo papel: no manda órdenes.
 */
import {
  COMISION_ST_PCT, HORIZONTE_ST, leerSenalSt, MARCO_ST, MARCO_ST_MS, MONEDAS_ST, VELAS_BTC_ST, VELAS_ST, VENTANA_ENTRADA_ST_MS,
} from "./agente-st.ts";
import { escaleraValida, recorrer, type Escalera } from "./escalera.ts";
import { leerSenalesPapel } from "./agentes-papel.ts";
import { BROWSER_BASES } from "./market-fetch.ts";
import { parseSwingKlines, type SwingCandle } from "./swing-entries.ts";

const PASO_MS = 5 * 60_000;
const EVALUACION_MS = 30 * 60_000;
const SIN_SESION_MS = 10 * 60_000;

/** Lo que el navegador le pide a la API para medir (las mismas columnas que la tabla). */
type FilaAbierta = { clave: string; symbol: string; lado: "LONG" | "SHORT"; vela: number; entrada: number; sl: number; tp1: number; tp2: number; tp3: number; detectada: number };

let sinSesionHasta = 0;
let ultimaEvaluacion = 0;
let escaneando = false;
const escaneadas = new Set<number>();

const visible = () => typeof document !== "undefined" && document.visibilityState === "visible";

async function pedir(symbol: string, extra: string): Promise<unknown[][]> {
  for (const base of BROWSER_BASES) {
    try {
      const r = await fetch(`${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${MARCO_ST}&${extra}`);
      if (!r.ok) continue;
      const rows: unknown = await r.json();
      if (Array.isArray(rows)) return rows as unknown[][];
    } catch {
      // Siguiente espejo.
    }
  }
  return [];
}

/** Las últimas `cuantas` velas de 4 h (la que acaba de abrir incluida), en páginas de 1.500, de la más vieja a la más nueva. */
async function ultimasVelas(symbol: string, cuantas: number): Promise<unknown[][]> {
  let filas = await pedir(symbol, `limit=${Math.min(1500, cuantas)}`);
  while (filas.length && filas.length < cuantas) {
    const antes = await pedir(symbol, `limit=${Math.min(1500, cuantas - filas.length)}&endTime=${Number(filas[0][0]) - 1}`);
    if (!antes.length) break;
    filas = [...antes, ...filas];
  }
  return filas;
}

/** Revisa las 10 monedas en la primera media hora de cada vela de 4 h y registra las entradas. Devuelve cuántas registró. */
export async function escanearAgenteSt(ahora = Date.now()): Promise<number> {
  if (!visible() || ahora < sinSesionHasta || escaneando) return 0;
  const vela = Math.floor(ahora / MARCO_ST_MS) * MARCO_ST_MS;
  if (ahora - vela > VENTANA_ENTRADA_ST_MS || escaneadas.has(vela)) return 0;
  escaneando = true;
  try {
    const btcFilas = await ultimasVelas("BTCUSDT", VELAS_BTC_ST);
    const btc = parseSwingKlines(btcFilas);
    if (btc.length < 1500 || btc[btc.length - 1].openTime !== vela) return 0; // Binance todavía no sirve la vela nueva: se reintenta
    let registradas = 0;
    let completo = true;
    for (const symbol of MONEDAS_ST) {
      const filas = symbol === "BTCUSDT" ? btcFilas : await ultimasVelas(symbol, VELAS_ST);
      const velas: SwingCandle[] = parseSwingKlines(filas);
      if (velas.length < 300 || velas[velas.length - 1].openTime !== vela) {
        completo = false;
        continue;
      }
      const f = filas[filas.length - 2];
      const compras = f && Number(f[5]) > 0 && Number.isFinite(Number(f[9])) ? Number(f[9]) / Number(f[5]) : null;
      // Los demás agentes del estudio leen ESTAS MISMAS velas de 4 h: sumarlos no cuesta ninguna descarga más.
      for (const p of leerSenalesPapel(symbol, velas, ahora)) {
        const r = await fetch("/api/registro/agente-st", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accion: "senal-agente",
            senal: { estrategia: p.estrategia, symbol, lado: p.lado, vela: p.vela, detectada: ahora, entrada: p.entrada, stop: p.stop, objetivo: p.objetivo },
          }),
        });
        if (r.status === 401) {
          sinSesionHasta = Date.now() + SIN_SESION_MS;
          return registradas;
        }
        if (r.ok && ((await r.json()) as { registrada?: boolean }).registrada) registradas += 1;
        else if (!r.ok) completo = false;
      }
      const plan = leerSenalSt(symbol, velas, btc, ahora, compras);
      if (!plan) continue;
      const res = await fetch("/api/registro/agente-st", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accion: "senal",
          senal: { symbol, lado: plan.lado, vela: plan.vela, detectada: ahora, entrada: plan.entrada, stop: plan.stop, objetivo: plan.objetivo, foto: plan.foto },
        }),
      });
      if (res.status === 401) {
        sinSesionHasta = Date.now() + SIN_SESION_MS;
        return registradas;
      }
      if (res.ok && ((await res.json()) as { registrada?: boolean }).registrada) registradas += 1;
      else if (!res.ok) completo = false;
    }
    if (completo) escaneadas.add(vela);
    return registradas;
  } catch {
    return 0;
  } finally {
    escaneando = false;
  }
}

/** Mide las abiertas con las velas que ya cerraron y las manda a la cuenta. */
export async function evaluarAgenteSt(): Promise<number> {
  if (!visible() || Date.now() < sinSesionHasta) return 0;
  const res = await fetch("/api/registro/agente-st", { credentials: "same-origin", cache: "no-store" });
  if (res.status === 401) {
    sinSesionHasta = Date.now() + SIN_SESION_MS;
    return 0;
  }
  if (!res.ok) return 0;
  const { abiertas } = (await res.json()) as { abiertas: FilaAbierta[] };
  if (!abiertas.length) return 0;
  const recorridos: { clave: string; recorrido: unknown }[] = [];
  const porSimbolo = new Map<string, FilaAbierta[]>();
  for (const f of abiertas) porSimbolo.set(f.symbol, [...(porSimbolo.get(f.symbol) ?? []), f]);
  for (const [symbol, filas] of porSimbolo) {
    const velas = parseSwingKlines(await pedir(symbol, `startTime=${Math.min(...filas.map((f) => f.vela))}&limit=500`));
    if (!velas.length) continue;
    for (const f of filas) {
      const e: Escalera = { stop: f.sl, tp1: f.tp1, tp2: f.tp2, tp3: f.tp3 };
      if (!escaleraValida(f.lado, f.entrada, e)) continue;
      recorridos.push({ clave: f.clave, recorrido: recorrer(f.lado, f.entrada, e, f.vela, velas, MARCO_ST_MS, Date.now(), { horizonte: HORIZONTE_ST, feePct: COMISION_ST_PCT }) });
    }
  }
  if (!recorridos.length) return 0;
  const post = await fetch("/api/registro/agente-st", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accion: "evaluar", recorridos }),
  });
  if (!post.ok) return 0;
  return ((await post.json()) as { resultados: { ok: boolean }[] }).resultados.filter((r) => r.ok).length;
}

/** Arranca el escaneo y la medición con la pestaña visible; devuelve cómo pararlos al desmontar. */
export function iniciarAgenteSt(): () => void {
  const correr = () => {
    void (async () => {
      await escanearAgenteSt();
      if (Date.now() - ultimaEvaluacion >= EVALUACION_MS) {
        ultimaEvaluacion = Date.now();
        await evaluarAgenteSt();
      }
    })().catch(() => null);
  };
  correr();
  const cada = setInterval(correr, PASO_MS);
  document.addEventListener("visibilitychange", correr);
  return () => {
    clearInterval(cada);
    document.removeEventListener("visibilitychange", correr);
  };
}
