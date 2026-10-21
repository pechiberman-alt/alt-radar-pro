"use client";

/**
 * La puerta PRO de la terminal: quien no tiene sesión ve la presentación (qué es, qué incluye, cuánto cuesta y la cuenta
 * para probar 7 días gratis); quien tiene la prueba o el pago vencidos ve cómo pagar (transferencia al alias y aviso con el
 * número de operación, que el administrador aprueba a mano); el resto usa la terminal, con un aviso de los días que le
 * quedan. La puerta de verdad está en el servidor (worker/index.ts, lib/suscripcion.ts): esto es lo que se ve.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { notifySession, onSession } from "@/lib/account-events";
import { AGENTES_PAPEL } from "@/lib/agentes-papel";
import { AuthForms } from "./account-panel";

type Cobro = { alias: string; precio: number | null; moneda: string; dias: number; diasPrueba: number; precioTexto: string };
type PagoCliente = { id: number; monto: number; referencia: string; estado: string; creado: number; revisado: number | null };
type Sus =
  | { sesion: false; estado: "VISITANTE"; acceso: false; cobro: Cobro }
  | { sesion: true; email: string; estado: "ADMIN" | "PRUEBA" | "ACTIVA" | "VENCIDA"; acceso: boolean; hasta: number | null; diasRestantes: number | null; texto: string; cobro: Cobro; pagos: PagoCliente[] };
type Lectura = { tipo: "cargando" } | { tipo: "error" } | { tipo: "listo"; sus: Sus };

const AGENTES = AGENTES_PAPEL.length + 1;
const RELEER_MS = 30 * 60_000;
const fecha = (t: number) => new Date(t).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
const monto = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

/** El estado PRO de quien mira: al abrir, al entrar o salir, y al volver a la pestaña (para que la aprobación abra sola). */
function useSuscripcion() {
  const [lectura, setLectura] = useState<Lectura>({ tipo: "cargando" });
  const [vuelta, setVuelta] = useState(0);
  const releer = useCallback(() => setVuelta((v) => v + 1), []);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/suscripcion", { credentials: "same-origin", cache: "no-store" });
        const d = r.ok ? ((await r.json()) as Sus) : null;
        if (vivo) setLectura(d ? { tipo: "listo", sus: d } : { tipo: "error" });
      } catch {
        if (vivo) setLectura({ tipo: "error" });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [vuelta]);
  useEffect(() => onSession(releer), [releer]);
  useEffect(() => {
    let ultima = 0;
    const alVolver = () => {
      if (document.visibilityState !== "visible") return;
      const ahora = Date.now();
      if (ahora - ultima < 60_000) return;
      ultima = ahora;
      releer();
    };
    const id = window.setInterval(() => document.visibilityState === "visible" && releer(), RELEER_MS);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [releer]);
  return { lectura, releer };
}

export default function PuertaPro({ children }: { children: ReactNode }) {
  const { lectura, releer } = useSuscripcion();
  if (lectura.tipo === "cargando")
    return (
      <div className="loading" role="status">
        <div className="brain-loader">
          <i />
          <i />
          <i />
        </div>
        <h1>
          ALT RADAR <b>PRO</b>
        </h1>
        <p>ABRIENDO LA TERMINAL…</p>
        <p>Terminal de inteligencia de mercado cripto: altseason, order flow, mapa de liquidez y señales auditables, con su muestra. Probala 7 días gratis. No es asesoramiento financiero.</p>
      </div>
    );
  // Sin poder leer el acceso, la terminal abre igual: la puerta de verdad está en el servidor y no se pierde nada.
  if (lectura.tipo === "error") return <>{children}</>;
  const sus = lectura.sus;
  if (!sus.sesion) return <Presentacion cobro={sus.cobro} onEntrar={releer} />;
  if (!sus.acceso) return <Muro sus={sus} onCambio={releer} />;
  return (
    <>
      <BandaPro sus={sus} onCambio={releer} />
      {children}
    </>
  );
}

// ── Pagar: el alias, el aviso con el número de operación y en qué quedaron los avisos ──

function Pagar({ sus, onCambio }: { sus: Extract<Sus, { sesion: true }>; onCambio: () => void }) {
  const c = sus.cobro;
  const [montoTxt, setMontoTxt] = useState(c.precio !== null ? monto(c.precio) : "");
  const [referencia, setReferencia] = useState("");
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const pendientes = sus.pagos.filter((p) => p.estado === "PENDIENTE").length;

  const avisar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setEnviando(true);
    setMensaje(null);
    try {
      const r = await fetch("/api/suscripcion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ monto: montoTxt, referencia, nota }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setMensaje({ ok: false, texto: d.error ?? "No se pudo enviar el aviso." });
        return;
      }
      setMensaje({ ok: true, texto: "Aviso enviado: queda en revisión. Cuando el administrador lo apruebe, se activa solo." });
      setReferencia("");
      setNota("");
      onCambio();
    } catch {
      setMensaje({ ok: false, texto: "Sin conexión con el servidor." });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="pp-pagar">
      <ol className="pp-pasos">
        <li>
          <b>Transferí</b> {c.precio !== null ? <strong>{c.precioTexto}</strong> : <span>(el precio lo confirma el administrador)</span>} al alias
          <span className="pp-alias">
            <code>{c.alias}</code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(c.alias)
                  .then(() => setCopiado(true))
                  .catch(() => setCopiado(false));
              }}
            >
              {copiado ? "COPIADO" : "COPIAR"}
            </button>
          </span>
          desde cualquier banco o billetera.
        </li>
        <li>
          <b>Copiá el número de operación</b> del comprobante.
        </li>
        <li>
          <b>Avisá acá</b>. El administrador lo revisa a mano y activa tu PRO por {c.dias} días. Si tenés Telegram vinculado, te llega
          el aviso.
        </li>
      </ol>
      <form className="pp-form" onSubmit={avisar}>
        <label>
          <span>MONTO TRANSFERIDO</span>
          <input inputMode="decimal" value={montoTxt} onChange={(e) => setMontoTxt(e.target.value)} placeholder="10.000" required maxLength={16} />
        </label>
        <label>
          <span>NÚMERO DE OPERACIÓN</span>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Como figura en el comprobante" required minLength={4} maxLength={40} autoComplete="off" />
        </label>
        <label className="pp-form-ancho">
          <span>NOTA (OPCIONAL)</span>
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Por ejemplo: pagué desde la cuenta de mi pareja" maxLength={200} />
        </label>
        <button type="submit" className="pp-boton" disabled={enviando || pendientes >= 3}>
          {enviando ? "ENVIANDO…" : "AVISAR QUE PAGUÉ"}
        </button>
        {mensaje && <p className={mensaje.ok ? "pp-ok" : "pp-error"}>{mensaje.texto}</p>}
      </form>
      {sus.pagos.length > 0 && (
        <ul className="pp-avisos" aria-label="Tus avisos de pago">
          {sus.pagos.map((p) => (
            <li key={p.id} className={`pp-aviso-${p.estado.toLowerCase()}`}>
              <span>{fecha(p.creado)}</span>
              <span>
                {c.moneda === "ARS" ? "$" : `${c.moneda} `}
                {monto(p.monto)}
              </span>
              <code>{p.referencia}</code>
              <b>{p.estado === "PENDIENTE" ? "EN REVISIÓN" : p.estado === "APROBADO" ? "APROBADO" : "NO CONFIRMADO"}</b>
            </li>
          ))}
        </ul>
      )}
      <p className="pp-letra">
        Nunca te vamos a pedir la clave del banco, de la billetera ni datos de tarjeta: solo el número de operación. Sin débito automático:
        cada pago suma {c.dias} días. Pagás el acceso a la terminal (herramientas, agentes en papel y registro), no una promesa de
        ganancia. No es asesoramiento financiero.
      </p>
    </div>
  );
}

// ── Dentro de la terminal: los días que quedan y el botón para activar ──

function BandaPro({ sus, onCambio }: { sus: Extract<Sus, { sesion: true }>; onCambio: () => void }) {
  const [abierta, setAbierta] = useState(false);
  const [cerrada, setCerrada] = useState(() => {
    try {
      return typeof window !== "undefined" && window.sessionStorage.getItem("alt-radar-pro:banda-pro") === String(sus.diasRestantes);
    } catch {
      return false;
    }
  });
  const mostrar = sus.estado === "PRUEBA" || (sus.estado === "ACTIVA" && (sus.diasRestantes ?? 99) <= 5);
  // Escape cierra la ventana de pago.
  useEffect(() => {
    if (!abierta) return;
    const alTeclear = (e: KeyboardEvent) => e.key === "Escape" && setAbierta(false);
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierta]);
  if (!mostrar && !abierta) return null;
  return (
    <>
      {mostrar && !cerrada && (
        <div className={`pp-banda ${sus.estado === "PRUEBA" ? "prueba" : "renovar"}`} role="status">
          <span className="pp-banda-marca">{sus.estado === "PRUEBA" ? "PRUEBA PRO" : "PRO"}</span>
          <span className="pp-banda-texto">{sus.texto}</span>
          <button type="button" className="pp-banda-boton" onClick={() => setAbierta(true)}>
            {sus.estado === "PRUEBA" ? "ACTIVAR PRO" : "RENOVAR"}
          </button>
          <button
            type="button"
            className="pp-banda-cerrar"
            aria-label="Ocultar el aviso"
            onClick={() => {
              setCerrada(true);
              try {
                window.sessionStorage.setItem("alt-radar-pro:banda-pro", String(sus.diasRestantes));
              } catch {
                // Sin almacenamiento: se oculta solo ahora.
              }
            }}
          >
            ×
          </button>
        </div>
      )}
      {abierta && (
        <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Activar PRO">
          <div className="pp-modal-caja">
            <button type="button" className="pp-modal-cerrar" aria-label="Cerrar" onClick={() => setAbierta(false)}>
              ×
            </button>
            <p className="pp-ojo">ACTIVAR ALT RADAR PRO</p>
            <h2 className="pp-h2">{sus.estado === "PRUEBA" ? "Seguí con todo cuando termine la prueba" : "Renová tu PRO"}</h2>
            <Pagar sus={sus} onCambio={onCambio} />
          </div>
        </div>
      )}
    </>
  );
}

// ── Prueba o pago vencidos ──

function Muro({ sus, onCambio }: { sus: Extract<Sus, { sesion: true }>; onCambio: () => void }) {
  const [saliendo, setSaliendo] = useState(false);
  const pagoAlguna = sus.pagos.some((p) => p.estado === "APROBADO");
  const salir = async () => {
    setSaliendo(true);
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    notifySession();
  };
  return (
    <div className="pp pp-muro">
      <div className="pp-muro-caja">
        <Marca />
        <p className="pp-ojo">{pagoAlguna ? "TU PRO VENCIÓ" : "TERMINÓ TU PRUEBA"}</p>
        <h1 className="pp-h1 pp-h1-chico">{pagoAlguna ? "Renová para volver a la terminal" : "Activá PRO para seguir usando la terminal"}</h1>
        <p className="pp-sub">
          Tus datos quedan guardados: registro, diario, alertas y agentes siguen donde los dejaste. Cuando el pago se apruebe, esta pantalla
          se abre sola.
        </p>
        <Pagar sus={sus} onCambio={onCambio} />
        <div className="pp-muro-pie">
          <span>{sus.email}</span>
          <button type="button" onClick={() => void salir()} disabled={saliendo}>
            {saliendo ? "SALIENDO…" : "SALIR"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── La presentación, para quien todavía no tiene cuenta ──

function Marca() {
  return (
    <div className="pp-marca">
      <div className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div>
        <b>
          ALT RADAR <span>PRO</span>
        </b>
        <small>by url.fx</small>
      </div>
    </div>
  );
}

const MODULOS: { titulo: string; texto: string; icono: ReactNode }[] = [
  {
    titulo: "Mapa de liquidaciones",
    texto: "Dónde se juntan las liquidaciones estimadas y la liquidez: imanes, zonas de compra y de venta con estrellas, footprint y delta por vela.",
    icono: (
      <svg viewBox="0 0 24 24">
        <path d="M3 18h18M3 13h18M3 8h18" />
        <path d="M7 5v16M12 3v18M17 6v13" opacity=".5" />
      </svg>
    ),
  },
  {
    titulo: `${AGENTES} agentes 24/7`,
    texto: "Tendencia, reversión, estructura, flujo y metales: cada uno con su regla fija, operando en papel las 24 horas con SL, TP1, TP2 y TP3.",
    icono: (
      <svg viewBox="0 0 24 24">
        <circle cx="8" cy="8" r="3" />
        <circle cx="16" cy="8" r="3" />
        <path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M11 20c0-3 2.5-5 5-5s5 2 5 5" />
      </svg>
    ),
  },
  {
    titulo: "Mesa de flujo de órdenes",
    texto: "Absorción, esfuerzo sin resultado, barridas de stops, divergencia de delta y delta absorbido, leídos en el gráfico que estás mirando.",
    icono: (
      <svg viewBox="0 0 24 24">
        <path d="M4 20V10M9 20V4M14 20v-7M19 20V8" />
      </svg>
    ),
  },
  {
    titulo: "JARVIS, la IA de la terminal",
    texto: "Lee todos los motores y responde con los números del radar: análisis por activo, escenarios con gatillo e invalidación y memoria propia.",
    icono: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="9" opacity=".5" />
      </svg>
    ),
  },
  {
    titulo: "La oficina del fondo",
    texto: "Mirá a los agentes trabajar, discutir y aprender: diario de aprendizaje cada noche, reunión semanal y fondo simulado.",
    icono: (
      <svg viewBox="0 0 24 24">
        <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />
      </svg>
    ),
  },
  {
    titulo: "Alertas por Telegram",
    texto: "Señales, imanes de liquidación, alertas de precio y el diario de los agentes en tu Telegram, con la app cerrada.",
    icono: (
      <svg viewBox="0 0 24 24">
        <path d="M21 4 3 11l6 2 2 6 3-4 5 4z" />
      </svg>
    ),
  },
  {
    titulo: "Registro unificado",
    texto: "Acierto, profit factor y expectancia salen de un solo registro, con su muestra e intervalo. Con menos de 15 cierres dice «muestra mínima».",
    icono: (
      <svg viewBox="0 0 24 24">
        <path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5" />
      </svg>
    ),
  },
  {
    titulo: "Seguridad primero",
    texto: "Tus claves de Binance son de solo lectura, sin retiros, y se guardan cifradas. Las órdenes firmadas salen solo de tu navegador.",
    icono: (
      <svg viewBox="0 0 24 24">
        <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
];

const PREGUNTAS: { p: string; r: (c: Cobro) => string }[] = [
  { p: "¿Necesito tarjeta para probar?", r: (c) => `No. Creás la cuenta con email y contraseña y tenés ${c.diasPrueba} días con todo.` },
  {
    p: "¿Cómo pago?",
    r: (c) => `Por transferencia al alias ${c.alias}, desde cualquier banco o billetera. Avisás desde la terminal con el número de operación y el administrador activa tu PRO a mano por ${c.dias} días.`,
  },
  { p: "¿Qué pasa cuando termina la prueba?", r: () => "La terminal queda cerrada hasta que actives PRO. Tus datos no se borran: registro, diario, alertas y agentes quedan como estaban." },
  { p: "¿Opera con mi plata?", r: () => "No. Los agentes operan en papel. Si vinculás Binance, es en modo lectura, sin permiso de retiro, y nada se ejecuta sin que vos lo pidas." },
  { p: "¿Me garantiza ganancias?", r: () => "No, y desconfiá de quien lo haga. La terminal te muestra lecturas medidas, con su muestra y sus límites. No es asesoramiento financiero." },
];

function Ilustracion() {
  // Una ilustración de la terminal (no son datos): velas, bandas de liquidez y marcas de la mesa de flujo.
  const velas = Array.from({ length: 34 }, (_, k) => {
    const base = 60 + 18 * Math.sin(k / 5) + 7 * Math.sin(k / 1.7);
    const sig = 60 + 18 * Math.sin((k + 1) / 5) + 7 * Math.sin((k + 1) / 1.7);
    return { x: 18 + k * 11, abre: base, cierra: sig, alto: Math.min(base, sig) - 4 - (k % 3) * 2, bajo: Math.max(base, sig) + 4 + (k % 4) * 2 };
  });
  const bandas = [
    { y: 22, h: 6, o: 0.85, c: "#ff5964" },
    { y: 31, h: 4, o: 0.45, c: "#f4b84a" },
    { y: 104, h: 5, o: 0.55, c: "#f4b84a" },
    { y: 112, h: 7, o: 0.9, c: "#55d6be" },
  ];
  return (
    <div className="pp-ilus" aria-hidden="true">
      <div className="pp-ilus-barra">
        <i />
        <i />
        <i />
        <span>BTC · 4H · MAPA DE LIQUIDACIONES</span>
      </div>
      <svg viewBox="0 0 400 150" preserveAspectRatio="none">
        <defs>
          <linearGradient id="pp-calor" x1="0" x2="1">
            <stop offset="0" stopColor="#55d6be" stopOpacity="0" />
            <stop offset=".6" stopColor="#55d6be" stopOpacity=".25" />
            <stop offset="1" stopColor="#55d6be" stopOpacity=".05" />
          </linearGradient>
        </defs>
        {Array.from({ length: 14 }, (_, k) => (
          <rect key={k} x="0" y={8 + k * 10} width="400" height="9" fill="url(#pp-calor)" opacity={0.15 + ((k * 37) % 10) / 30} />
        ))}
        {bandas.map((b) => (
          <rect key={b.y} x="0" y={b.y} width="400" height={b.h} fill={b.c} opacity={b.o * 0.55} />
        ))}
        <rect x="250" y="16" width="150" height="20" fill="#ff5964" opacity=".1" stroke="#ff5964" strokeOpacity=".5" strokeDasharray="3 3" />
        <rect x="250" y="100" width="150" height="22" fill="#39f29a" opacity=".1" stroke="#39f29a" strokeOpacity=".5" strokeDasharray="3 3" />
        {velas.map((v) => (
          <g key={v.x} className={v.cierra < v.abre ? "sube" : "baja"}>
            <line x1={v.x} x2={v.x} y1={v.alto} y2={v.bajo} />
            <rect x={v.x - 3} y={Math.min(v.abre, v.cierra)} width="6" height={Math.max(1.5, Math.abs(v.abre - v.cierra))} />
          </g>
        ))}
        <path d="M128 118 l5 -8 l5 8 z" className="pp-ilus-flujo" />
        <path d="M282 112 l5 -8 l5 8 z" className="pp-ilus-flujo" />
      </svg>
      <div className="pp-ilus-chips">
        <span className="rojo">ZONA DE VENTA ★★★</span>
        <span className="verde">ZONA DE COMPRA ★★</span>
        <span>ΔABS ▲ delta absorbido</span>
        <span>BARV ▲ barrida con volumen</span>
      </div>
    </div>
  );
}

function Presentacion({ cobro, onEntrar }: { cobro: Cobro; onEntrar: () => void }) {
  const [modo, setModo] = useState<"register" | "login">("register");
  const ir = (m: "register" | "login") => {
    setModo(m);
    document.getElementById("empezar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="pp">
      <div className="pp-barra">
        <Marca />
        <div className="pp-barra-acciones">
          <button type="button" className="pp-boton-fantasma" onClick={() => ir("login")}>
            INGRESAR
          </button>
          <button type="button" className="pp-boton" onClick={() => ir("register")}>
            PROBAR {cobro.diasPrueba} DÍAS GRATIS
          </button>
        </div>
      </div>

      <section className="pp-hero">
        <div className="pp-hero-texto">
          <p className="pp-ojo">TERMINAL DE INTELIGENCIA CRIPTO</p>
          <h1 className="pp-h1">
            Leé el mercado como una <em>mesa profesional</em>.
          </h1>
          <p className="pp-sub">
            Mapa de liquidaciones, flujo de órdenes, {AGENTES} agentes que operan en papel las 24 horas y JARVIS, la IA que lee todos los
            motores. Todo medido, todo con su muestra, sin promesas.
          </p>
          <div className="pp-cta">
            <button type="button" className="pp-boton pp-boton-grande" onClick={() => ir("register")}>
              PROBAR {cobro.diasPrueba} DÍAS GRATIS
            </button>
            <a className="pp-boton-fantasma pp-boton-grande" href="#incluye">
              VER QUÉ INCLUYE
            </a>
          </div>
          <p className="pp-confianza">Sin tarjeta · Activación manual · No es asesoramiento financiero</p>
        </div>
        <Ilustracion />
      </section>

      <div className="pp-cifras">
        <div>
          <b>{AGENTES}</b>
          <span>agentes en papel</span>
        </div>
        <div>
          <b>5</b>
          <span>lecturas de orderflow</span>
        </div>
        <div>
          <b>24/7</b>
          <span>en el servidor</span>
        </div>
        <div>
          <b>{cobro.diasPrueba} días</b>
          <span>de prueba con todo</span>
        </div>
      </div>

      <section className="pp-seccion" id="incluye">
        <p className="pp-ojo">QUÉ INCLUYE</p>
        <h2 className="pp-h2">Todo lo de la terminal, sin módulos sueltos</h2>
        <div className="pp-modulos">
          {MODULOS.map((m) => (
            <article key={m.titulo} className="pp-modulo">
              <span className="pp-icono">{m.icono}</span>
              <h3>{m.titulo}</h3>
              <p>{m.texto}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="pp-seccion">
        <p className="pp-ojo">CÓMO TRABAJA</p>
        <h2 className="pp-h2">Leer, operar en papel, medir y aprender</h2>
        <ol className="pp-ciclo">
          <li>
            <b>El mapa marca la liquidez</b>
            <span>Zonas de compra y de venta, imanes de liquidación y lo que ve la mesa de flujo en cada vela.</span>
          </li>
          <li>
            <b>Los agentes leen y operan en papel</b>
            <span>Cada uno con su regla fija y su escalera de salida. Guardan una foto del mapa al entrar.</span>
          </li>
          <li>
            <b>Todo se mide en el registro</b>
            <span>Cada cierre suma a la estadística de su agente, con muestra e intervalo. Cada noche, el diario cuenta qué aprendieron.</span>
          </li>
        </ol>
      </section>

      <section className="pp-seccion pp-honesto">
        <div>
          <p className="pp-ojo">HONESTIDAD url.fx</p>
          <h2 className="pp-h2">Lo que no vas a ver acá</h2>
          <ul>
            <li>Promesas de ganancia.</li>
            <li>Porcentajes de acierto sin su tamaño de muestra.</li>
            <li>Backtests elegidos a dedo.</li>
            <li>Órdenes con tu plata sin que lo pidas.</li>
          </ul>
        </div>
        <blockquote>
          <p>
            Medimos la mesa de flujo con velas de diez monedas desde 2020, con costos: sin ventaja en 1 h y 15 min, sin conclusión en 4 h.
            Lo publicamos igual, y los agentes se siguen midiendo hacia adelante.
          </p>
          <cite>Así trabajamos todo lo demás.</cite>
        </blockquote>
      </section>

      <section className="pp-seccion pp-precio-seccion">
        <div className="pp-precio">
          <p className="pp-ojo">ALT RADAR PRO</p>
          <div className="pp-precio-grande">
            <b>{cobro.diasPrueba} días gratis</b>
            <span>después, {cobro.precio !== null ? cobro.precioTexto : "el precio lo confirma el administrador"}</span>
          </div>
          <ul>
            <li>Todos los módulos de la terminal</li>
            <li>{AGENTES} agentes y la oficina 24/7</li>
            <li>JARVIS y la IA del analista</li>
            <li>Alertas por Telegram</li>
          </ul>
          <p className="pp-letra">
            Pagás por transferencia al alias <b>{cobro.alias}</b>. Avisás con el número de operación y se activa a mano. Sin débito
            automático.
          </p>
          <button type="button" className="pp-boton pp-boton-grande" onClick={() => ir("register")}>
            EMPEZAR LA PRUEBA
          </button>
        </div>
        <div className="pp-preguntas">
          {PREGUNTAS.map((q) => (
            <details key={q.p}>
              <summary>{q.p}</summary>
              <p>{q.r(cobro)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="pp-seccion pp-empezar" id="empezar">
        <div className="pp-empezar-texto">
          <p className="pp-ojo">EMPEZÁ AHORA</p>
          <h2 className="pp-h2">Tu cuenta, en un minuto</h2>
          <p className="pp-sub">Solo email y contraseña. La prueba arranca cuando entrás por primera vez.</p>
        </div>
        <div className="pp-cuenta">
          <AuthForms
            key={modo}
            initialMode={modo}
            expired={false}
            diasPrueba={cobro.diasPrueba}
            onSignedIn={() => {
              notifySession();
              onEntrar();
            }}
          />
        </div>
      </section>

      <div className="pp-pie">
        <Marca />
        <p>
          ALT RADAR PRO es una herramienta de análisis. Los agentes operan en papel. Operar cripto tiene riesgo de pérdida total. No es
          asesoramiento financiero.
        </p>
      </div>
    </div>
  );
}
