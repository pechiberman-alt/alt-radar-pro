"use client";

import { useState } from "react";
import { deskFor, typedNumber } from "../lib/jarvis-desk-run.ts";
import {
  INSTRUMENTOS_FONDEO,
  REGLAS_FONDEO_DEFECTO,
  agenteFondeo,
  estadoFondeo,
  normalizarReglasFondeo,
  simbolosFondeo,
  type CuentaFondeo,
  type DecisionFondeo,
  type PropuestaFondeo,
  type ReglasFondeo,
} from "../lib/fondeo.ts";

/**
 * Cuenta de fondeo y Agente Fondeo en el panel: la persona carga las reglas de su cuenta y su estado (saldo, resultado de hoy,
 * riesgo abierto) y, al tocar «Leer la mesa», el agente pide a JARVIS TRADING el plan de cada instrumento de fondeo (oro y
 * NASDAQ), los pasa por la compuerta de las reglas (lib/fondeo.ts) y muestra la elegida con su riesgo y su tamaño, o por qué se
 * frena. Los datos se guardan solo en este navegador. No manda órdenes; no es asesoramiento financiero.
 */

const CLAVE = "alt-radar-pro:fondeo:v1";
type Guardado = { reglas: Partial<ReglasFondeo>; saldo: string; hoy: string; abierto: string };

const cargar = (): Guardado | null => {
  try {
    const raw = window.localStorage.getItem(CLAVE);
    return raw ? (JSON.parse(raw) as Guardado) : null;
  } catch {
    return null;
  }
};
const guardar = (g: Guardado) => {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(g));
  } catch {
    // Modo privado: vive solo en esta visita.
  }
};

const coma = (v: number, d = 2) => v.toFixed(d).replace(".", ",");
const px = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v < 100 ? 3 : 1 });
const usd = (v: number) => `${v.toLocaleString("es-AR", { maximumFractionDigits: 2 })} USD`;

const CAMPOS_REGLAS: { k: keyof ReglasFondeo; txt: string; unidad: string }[] = [
  { k: "capitalInicial", txt: "Capital inicial", unidad: "USD" },
  { k: "perdidaDiariaPct", txt: "Pérdida diaria máx.", unidad: "%" },
  { k: "perdidaTotalPct", txt: "Pérdida total máx.", unidad: "%" },
  { k: "objetivoPct", txt: "Objetivo", unidad: "%" },
  { k: "riesgoPorOperacionPct", txt: "Riesgo por operación", unidad: "%" },
  { k: "colchonPct", txt: "Colchón de seguridad", unidad: "%" },
];

export default function LabFondeo() {
  const inicial = typeof window === "undefined" ? null : cargar();
  const [reglasTxt, setReglasTxt] = useState<Record<string, string>>(() =>
    Object.fromEntries(CAMPOS_REGLAS.map(({ k }) => [k, String(inicial?.reglas?.[k] ?? REGLAS_FONDEO_DEFECTO[k]).replace(".", ",")])),
  );
  const [saldo, setSaldo] = useState(inicial?.saldo ?? "");
  const [hoy, setHoy] = useState(inicial?.hoy ?? "0");
  const [abierto, setAbierto] = useState(inicial?.abierto ?? "0");
  const [decision, setDecision] = useState<DecisionFondeo | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);

  const reglas = normalizarReglasFondeo(Object.fromEntries(CAMPOS_REGLAS.map(({ k }) => [k, typedNumber(reglasTxt[k] ?? "") ?? undefined])));
  const saldoN = typedNumber(saldo) ?? reglas.capitalInicial;
  const cuenta: CuentaFondeo = { saldo: saldoN, resultadoHoy: typedNumber(hoy) ?? 0, riesgoAbiertoPct: typedNumber(abierto) ?? 0 };
  const est = estadoFondeo(cuenta, reglas);

  const persistir = (r: Record<string, string>, s: string, h: string, a: string) =>
    guardar({ reglas: Object.fromEntries(CAMPOS_REGLAS.map(({ k }) => [k, typedNumber(r[k] ?? "") ?? REGLAS_FONDEO_DEFECTO[k]])), saldo: s, hoy: h, abierto: a });

  async function leerMesa() {
    setLeyendo(true);
    setErrores([]);
    const propuestas: PropuestaFondeo[] = [];
    const fallas: string[] = [];
    await Promise.all(
      simbolosFondeo().map(async (symbol) => {
        try {
          const { decision: d } = await deskFor(symbol);
          const plan = d?.plan;
          if (!d || !plan || (d.direccion !== "LONG" && d.direccion !== "SHORT")) {
            fallas.push(`${symbol}: la mesa no ve operación ahora (${d?.direccion ?? "sin lectura"}).`);
            return;
          }
          propuestas.push({ symbol, lado: plan.lado, origen: "MESA", entrada: plan.entrada, stop: plan.stop, rr: d.riesgo?.rrPonderado ?? null });
        } catch {
          fallas.push(`${symbol}: no se pudo leer ahora.`);
        }
      }),
    );
    setErrores([...fallas, ...(INSTRUMENTOS_FONDEO.some((i) => i.symbol === null) ? ["NASDAQ: sin símbolo confirmado en Binance TradFi, todavía no se lee."] : [])]);
    setDecision(agenteFondeo(propuestas, cuenta, reglas));
    setLeyendo(false);
  }

  return (
    <section className="fondeo" aria-label="Cuenta de fondeo">
      <h3 className="lab-sub">Cuenta de fondeo · oro y NASDAQ · Agente Fondeo</h3>
      <p className="lab-nota">
        El Agente Fondeo no tiene estrategia propia: recibe el plan que arma la mesa de JARVIS (con sus agentes) para el oro y el NASDAQ, y lo pasa por las reglas de tu
        cuenta. Si no hay margen, frena; si el margen no alcanza al riesgo pedido, lo baja. Los límites de cada firma cambian: los de abajo son un ejemplo típico, poné los de la
        tuya. Los datos quedan solo en este navegador.
      </p>
      <div className="fondeo-grilla">
        {CAMPOS_REGLAS.map(({ k, txt, unidad }) => (
          <label key={k}>
            <span>{txt} ({unidad})</span>
            <input
              inputMode="decimal"
              value={reglasTxt[k]}
              onChange={(e) => {
                const r = { ...reglasTxt, [k]: e.target.value };
                setReglasTxt(r);
                persistir(r, saldo, hoy, abierto);
              }}
            />
          </label>
        ))}
        <label>
          <span>Saldo actual (USD)</span>
          <input inputMode="decimal" placeholder={String(reglas.capitalInicial)} value={saldo} onChange={(e) => { setSaldo(e.target.value); persistir(reglasTxt, e.target.value, hoy, abierto); }} />
        </label>
        <label>
          <span>Resultado de hoy (USD, con lo flotante)</span>
          <input inputMode="decimal" value={hoy} onChange={(e) => { setHoy(e.target.value); persistir(reglasTxt, saldo, e.target.value, abierto); }} />
        </label>
        <label>
          <span>Riesgo ya abierto (%)</span>
          <input inputMode="decimal" value={abierto} onChange={(e) => { setAbierto(e.target.value); persistir(reglasTxt, saldo, hoy, e.target.value); }} />
        </label>
      </div>
      <ul className="fondeo-estado">
        <li className={est.margenDiarioPct <= 0 ? "mal" : "ok"}>
          Hoy: perdiste {coma(est.perdidaHoyPct)} % de {coma(reglas.perdidaDiariaPct)} % · margen {coma(Math.max(0, est.margenDiarioPct))} % (sin el colchón)
        </li>
        <li className={est.margenTotalPct <= 0 ? "mal" : "ok"}>
          Total: caída de {coma(est.caidaTotalPct)} % de {coma(reglas.perdidaTotalPct)} % · margen {coma(Math.max(0, est.margenTotalPct))} %
        </li>
        <li className={est.objetivoCumplido ? "ok" : ""}>
          Objetivo: {coma(est.gananciaPct)} % de {coma(reglas.objetivoPct)} % ({Math.round(est.progresoObjetivo * 100)} %)
        </li>
      </ul>
      <ul className="fondeo-instrumentos">
        {INSTRUMENTOS_FONDEO.map((i) => (
          <li key={i.clave} className={i.symbol ? "ok" : "mal"}>
            Prioridad {i.prioridad} · {i.nombre}: {i.symbol ?? "sin símbolo confirmado (Binance TradFi)"}
          </li>
        ))}
      </ul>
      <button type="button" className="fondeo-leer" onClick={() => void leerMesa()} disabled={leyendo}>
        {leyendo ? "Leyendo la mesa…" : "Leer la mesa ahora"}
      </button>
      {errores.map((e) => (
        <p key={e} className="lab-nota">{e}</p>
      ))}
      {decision && (
        <div className="fondeo-decision">
          {decision.elegida ? (
            <article className="fondeo-elegida">
              <b>
                {decision.elegida.propuesta.symbol.replace("USDT", "")} · {decision.elegida.propuesta.lado === "LONG" ? "LARGO" : "CORTO"} · pasa la compuerta
              </b>
              <p>
                Entrada {px(decision.elegida.propuesta.entrada)} · stop {px(decision.elegida.propuesta.stop)} · R:R {coma(decision.elegida.propuesta.rr ?? 0)}
              </p>
              <p>
                Riesgo {coma(decision.elegida.veredicto.riesgoPct)} % = {usd(decision.elegida.veredicto.riesgoUsd)}
                {decision.elegida.veredicto.ajustado ? " (bajado: el margen no alcanzaba al pedido)" : ""}
                {decision.elegida.veredicto.unidades !== null ? ` · ${coma(decision.elegida.veredicto.unidades, 3)} unidades (convertí a lotes según el contrato de tu broker)` : ""}
              </p>
            </article>
          ) : (
            <p className="lab-error">El Agente Fondeo no elige ninguna operación ahora.</p>
          )}
          {decision.revisadas.filter((x) => x !== decision.elegida).map((x) => (
            <p key={x.propuesta.symbol + x.propuesta.origen} className="lab-nota">
              {x.propuesta.symbol.replace("USDT", "")} frenada: {x.veredicto.motivos.join(" ")}
            </p>
          ))}
          <p className="lab-nota">
            El plan es el de la mesa de JARVIS y no está medido para el oro ni el NASDAQ (el estudio de agentes todavía no tiene esos datos): sin muestra, no hay un acierto que
            mostrar. El perpetuo de Binance puede diferir unos dólares del precio de tu broker. No es una orden ni asesoramiento financiero.
          </p>
        </div>
      )}
    </section>
  );
}
