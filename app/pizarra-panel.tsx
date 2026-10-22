"use client";

/**
 * La PIZARRA a la vista (lib/pizarra.ts): para un activo, quién está a favor, quién en contra, quién espera y quién se
 * abstiene (y por qué), dónde discrepan las familias, qué habría que ver para que la decisión cambie, el debate y la huella de
 * la decisión. Y el RAZONAMIENTO de una mente (lib/mentes-metodo.ts): las preguntas de su método en orden, su plan, qué la
 * haría cambiar de idea y qué no puede saber. Sirve igual para BYMA y para cripto. No es asesoramiento financiero.
 */
import type { Deliberacion, Voz } from "@/lib/pizarra";
import type { Razonamiento } from "@/lib/mentes-metodo";

const num = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: Math.abs(x) >= 100 ? 2 : Math.abs(x) >= 1 ? 3 : 6 });
const CLASE_VEREDICTO: Record<string, string> = { "HAY PLAN": "ok", "NO OPERAR": "mal", ESPERAR: "alerta", "SIN DATOS SUFICIENTES": "" };
const CLASE_MENTE: Record<string, string> = { "COMPRARÍA": "ok", "ESPERARÍA": "alerta", "NO LO TOCARÍA": "mal", AFUERA: "mal", "FUERA DE MI MÉTODO": "", "SIN DATOS": "", INFORMA: "" };
const SIGNO: Record<string, string> = { PASA: "✓", FRENA: "✗", "NO SE": "?", INFO: "·" };
const CLASE_SIGNO: Record<string, string> = { PASA: "ar-up", FRENA: "ar-down", "NO SE": "ar-mute", INFO: "ar-mute" };

function Voces({ titulo, voces, vacio }: { titulo: string; voces: Voz[]; vacio?: string }) {
  if (!voces.length && !vacio) return null;
  return (
    <div className="pz-grupo">
      <h4>
        {titulo} · {voces.length}
      </h4>
      {voces.length ? (
        voces.map((v) => (
          <p key={v.id} className={`pz-voz${v.veto ? " pz-veto" : ""}`}>
            <b>{v.nombre}</b> <small className="ar-chip">{v.familia.replace("_", " ")}</small>
            <span>{v.motivo}</span>
            {v.falta && <em>Necesita: {v.falta}</em>}
          </p>
        ))
      ) : (
        <p className="ar-mute">{vacio}</p>
      )}
    </div>
  );
}

export function PizarraPanel({ d, abierta = true }: { d: Deliberacion; abierta?: boolean }) {
  return (
    <details className="ar-box pz" open={abierta}>
      <summary>
        <h3 style={{ display: "inline" }}>PIZARRA · {d.activo}</h3> <span className={`ar-chip ${CLASE_VEREDICTO[d.veredicto]}`}>{d.veredicto}</span>
      </summary>
      <p>{d.razon}</p>
      {d.plan && (
        <p className="pz-plan">
          <b>Plan ({d.plan.fuente})</b> · entrada {num(d.plan.entrada)} · SL {num(d.plan.stop)} · TP1 {num(d.plan.tp1)} · TP2 {num(d.plan.tp2)} · TP3 {num(d.plan.tp3)}
        </p>
      )}
      <div className="pz-cols">
        <Voces titulo="A FAVOR" voces={d.aFavor} vacio="Nadie." />
        <Voces titulo="EN CONTRA" voces={d.enContra} vacio="Nadie." />
        <Voces titulo="ESPERAN" voces={d.espera} />
        <Voces titulo="SE ABSTIENEN" voces={d.abstienen} />
      </div>
      {d.discrepancias.length > 0 && (
        <div className="pz-grupo">
          <h4>DONDE DISCREPAN LAS FAMILIAS</h4>
          {d.discrepancias.map((x, k) => (
            <p key={k}>
              <b>{x.favor.familia.toLowerCase()}</b> ({x.favor.nombre}) ve a favor ⟷ <b>{x.contra.familia.toLowerCase()}</b> ({x.contra.nombre}) ve en contra.
            </p>
          ))}
        </div>
      )}
      {d.destraba.length > 0 && (
        <div className="pz-grupo">
          <h4>QUÉ CAMBIARÍA LA DECISIÓN</h4>
          {d.destraba.map((t, k) => (
            <p key={k}>{t}</p>
          ))}
        </div>
      )}
      <details>
        <summary className="ar-mute">VER EL DEBATE</summary>
        {d.debate.map((l, k) => (
          <p key={k}>
            <b>{l.nombre}</b> · {l.texto}
          </p>
        ))}
      </details>
      <p className="ar-mute" style={{ fontSize: 10 }}>
        Decisión {d.huella}. Reglas fijas: el veto del gestor de riesgo gana; hacen falta 3 voces que opinen (una abstención no es un voto en contra); sin plan completo no hay operación; para «hay plan», 2 familias distintas a favor y más a favor que en contra. No es una probabilidad ni asesoramiento financiero.
      </p>
    </details>
  );
}

export function RazonamientoMente({ r }: { r: Razonamiento }) {
  return (
    <div className="pz-razon">
      <p>
        <span className={`ar-chip ${CLASE_MENTE[r.veredicto]}`}>{r.veredicto}</span> {r.clase ? <span className="ar-chip">CLASE · {r.clase}</span> : null} <span className="ar-chip">{r.familia}</span>
      </p>
      <p>{r.porQue}</p>
      {r.pasos.map((p, k) => (
        <div className="ar-crit" key={k} title={p.pregunta}>
          <i className={CLASE_SIGNO[p.resultado]}>{SIGNO[p.resultado]}</i>
          <span>{p.pregunta}</span>
          <span className="ar-mute">{p.hallazgo}</span>
        </div>
      ))}
      {r.plan && (
        <p className="pz-plan">
          <b>Su plan</b>
          {r.plan.entrada !== null ? ` · entrada ${num(r.plan.entrada)}` : ""}
          {r.plan.stop !== null ? ` · stop ${num(r.plan.stop)}` : ""}
          {r.plan.objetivo !== null ? ` · objetivo ${num(r.plan.objetivo)}` : ""}. {r.plan.salida}
          {r.plan.tamano ? ` Tamaño: ${r.plan.tamano}.` : ""}
        </p>
      )}
      <p>
        <b>Cambiaría de idea si:</b> {r.cambiaria.join(" ")}
      </p>
      <p className="ar-mute">
        <b>No puedo saber:</b> {r.noSabe.join("; ")}.
      </p>
    </div>
  );
}
