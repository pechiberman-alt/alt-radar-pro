/**
 * Los balances de las empresas de afuera que hay detrás de los CEDEARs, de SEC EDGAR (XBRL, gratis y oficial): ingresos,
 * ganancia neta, BPA diluido, patrimonio, pasivo y activo/pasivo corriente de los últimos ejercicios anuales (10-K).
 * Es lo que necesitan las mentes de valor (lib/mentes-inversoras.ts: Buffett, Graham, Lynch, crecimiento).
 * También las empresas argentinas y de la región que presentan 20-F ante la SEC en NIIF (YPF, Galicia, Macro, BBVA, Supervielle,
 * Pampa, Central Puerto, Edenor, Loma Negra, IRSA, Cresud, Vista): las cifras vienen en su moneda (pesos ajustados por inflación
 * a la fecha del balance, o dólares) y se dice cuál; un precio de hoy en pesos no se compara con ellas (lib/mentes-inversoras.ts).
 *
 * Solo empresas de la lista fija con su CIK; cada respuesta se controla contra el nombre esperado (si el CIK no
 * corresponde, no se usa). Quedan afuera los ETF (no tienen balance propio), Alibaba (presenta en yuanes) y Vista
 * (presenta en NIIF): se dice, no se estima. Un dato que la empresa no reporta queda en null («desconocido no es cero»).
 */
import { guardarAjuste, leerAjuste } from "./app-settings.ts";

/** CEDEAR → empresa en SEC (CIK) y un pedazo de su nombre oficial para controlar la respuesta. */
export const EMPRESAS_SEC: Record<string, { cik: number; nombre: string }> = {
  AAPL: { cik: 320193, nombre: "apple" },
  MSFT: { cik: 789019, nombre: "microsoft" },
  GOOGL: { cik: 1652044, nombre: "alphabet" },
  AMZN: { cik: 1018724, nombre: "amazon" },
  NVDA: { cik: 1045810, nombre: "nvidia" },
  META: { cik: 1326801, nombre: "meta" },
  TSLA: { cik: 1318605, nombre: "tesla" },
  MELI: { cik: 1099590, nombre: "mercadolibre" },
  KO: { cik: 21344, nombre: "cocacola" },
  BRKB: { cik: 1067983, nombre: "berkshire" },
  JPM: { cik: 19617, nombre: "jpmorgan" },
  V: { cik: 1403161, nombre: "visa" },
  WMT: { cik: 104169, nombre: "walmart" },
  DIS: { cik: 1744489, nombre: "disney" },
  XOM: { cik: 34088, nombre: "exxon" },
  PFE: { cik: 78003, nombre: "pfizer" },
  NFLX: { cik: 1065280, nombre: "netflix" },
  AMD: { cik: 2488, nombre: "advancedmicro" },
  MCD: { cik: 63908, nombre: "mcdonald" },
  PEP: { cik: 77476, nombre: "pepsico" },
  JNJ: { cik: 200406, nombre: "johnsonjohnson" },
};

/**
 * Empresas que presentan 20-F en NIIF (taxonomía ifrs-full): su CIK y pedazos de su nombre oficial (basta que el nombre que
 * devuelve SEC contenga uno) para controlar la respuesta. Los CIK salen de los archivos que cada una presentó en sec.gov.
 */
export const EMPRESAS_NIIF: Record<string, { cik: number; nombres: string[] }> = {
  YPFD: { cik: 904851, nombres: ["ypf"] },
  GGAL: { cik: 1114700, nombres: ["galicia"] },
  BMA: { cik: 1347426, nombres: ["macro"] },
  BBAR: { cik: 913059, nombres: ["bbva"] },
  SUPV: { cik: 1517399, nombres: ["supervielle"] },
  PAMP: { cik: 1469395, nombres: ["pampa"] },
  CEPU: { cik: 1717161, nombres: ["centralpuerto"] },
  EDN: { cik: 1395213, nombres: ["edenor", "comercializadoranorte"] },
  LOMA: { cik: 1711375, nombres: ["lomanegra"] },
  IRSA: { cik: 933267, nombres: ["irsa"] },
  CRES: { cik: 1034957, nombres: ["cresud"] },
  VIST: { cik: 1762506, nombres: ["vista"] },
};

export type EmpresaSec = { cik: number; nombres: string[]; niif: boolean };

/** La empresa de SEC detrás de un papel (10-K de EE. UU. o 20-F en NIIF); null si no presenta balances ante la SEC. */
export function empresaSec(simbolo: string): EmpresaSec | null {
  const a = EMPRESAS_SEC[simbolo];
  if (a) return { cik: a.cik, nombres: [a.nombre], niif: false };
  const b = EMPRESAS_NIIF[simbolo];
  return b ? { cik: b.cik, nombres: b.nombres, niif: true } : null;
}

/** Por qué un papel no tiene balances de SEC. */
export function motivoSinBalance(simbolo: string): string {
  return SIN_BALANCE[simbolo] ?? "la empresa no presenta balances ante la SEC (en Argentina la CNV los publica en PDF, sin datos abiertos)";
}

/** Por qué un CEDEAR no tiene balances de SEC. */
export const SIN_BALANCE: Record<string, string> = {
  SPY: "es un ETF: no tiene balance propio",
  QQQ: "es un ETF: no tiene balance propio",
  BABA: "presenta sus balances en yuanes: sin una conversión confiable no se compara con el precio en dólares",
};

/** Berkshire publica el BPA por acción clase A (1.500 clase B): no se compara con el precio de la B. */
export const BPA_NO_COMPARABLE = new Set(["BRKB"]);

export type Concepto = "ingresos" | "gananciaNeta" | "bpa" | "patrimonio" | "pasivo" | "deuda" | "activoCorriente" | "pasivoCorriente";

/** Los nombres XBRL de cada concepto, en orden: los ingresos se reportan con distintos nombres según la empresa. */
export const CONCEPTOS: Record<Concepto, { nombres: string[]; unidad: string; flujo: boolean }> = {
  ingresos: { nombres: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], unidad: "USD", flujo: true },
  gananciaNeta: { nombres: ["NetIncomeLoss"], unidad: "USD", flujo: true },
  bpa: { nombres: ["EarningsPerShareDiluted"], unidad: "USD/shares", flujo: true },
  patrimonio: { nombres: ["StockholdersEquity"], unidad: "USD", flujo: false },
  pasivo: { nombres: ["Liabilities"], unidad: "USD", flujo: false },
  /** Deuda financiera de largo plazo (lo que miran Buffett y virattt/ai-hedge-fund: deuda sobre patrimonio), no todo el pasivo. */
  deuda: { nombres: ["LongTermDebt", "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"], unidad: "USD", flujo: false },
  activoCorriente: { nombres: ["AssetsCurrent"], unidad: "USD", flujo: false },
  pasivoCorriente: { nombres: ["LiabilitiesCurrent"], unidad: "USD", flujo: false },
};

/** Los nombres ifrs-full de cada concepto (taxonomía NIIF de los 20-F); `porAccion`: la unidad es moneda por acción. */
export const CONCEPTOS_NIIF: Record<Concepto, { nombres: string[]; flujo: boolean; porAccion?: boolean }> = {
  ingresos: { nombres: ["Revenue", "RevenueFromContractsWithCustomers"], flujo: true },
  gananciaNeta: { nombres: ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"], flujo: true },
  bpa: { nombres: ["DilutedEarningsLossPerShare", "BasicAndDilutedEarningsLossPerShare", "BasicEarningsLossPerShare"], flujo: true, porAccion: true },
  patrimonio: { nombres: ["EquityAttributableToOwnersOfParent", "Equity"], flujo: false },
  pasivo: { nombres: ["Liabilities"], flujo: false },
  deuda: { nombres: ["LongtermBorrowings"], flujo: false },
  activoCorriente: { nombres: ["CurrentAssets"], flujo: false },
  pasivoCorriente: { nombres: ["CurrentLiabilities"], flujo: false },
};

/** Las monedas en que se prueba un 20-F, en orden: la primera con datos fija la moneda de todos los conceptos. */
export const MONEDAS_NIIF = ["ARS", "USD"];

/** La clave de unidad de una respuesta para una moneda: «ARS», o «ARS/shares» (o similar) para lo que es por acción. */
export function claveUnidad(json: unknown, moneda: string, porAccion: boolean): string | null {
  const claves = Object.keys((json as { units?: Record<string, unknown> } | null)?.units ?? {});
  if (!porAccion) return claves.includes(moneda) ? moneda : null;
  return claves.find((k) => k.toUpperCase().startsWith(moneda) && k.toUpperCase() !== moneda && /\/|PER|SHARE/i.test(k)) ?? null;
}

export type Ejercicio = { fin: string } & Record<Concepto, number | null>;

export type Fundamentales = {
  simbolo: string;
  entidad: string;
  /** Ejercicios anuales, del más viejo al más nuevo (hasta 6). */
  ejercicios: Ejercicio[];
  fuente: string;
  leido: number;
  /** Conceptos que la empresa no reporta con esos nombres. */
  faltantes: Concepto[];
  /** La moneda de las cifras: «USD» si no se dice (lo guardado antes). Las NIIF en pesos están ajustadas por inflación a la fecha del balance. */
  moneda?: string;
};

type FilaXbrl = { start?: string; end?: string; val?: number; form?: string; fp?: string; filed?: string };

const normal = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const DIA = 86_400_000;

/**
 * Los valores anuales de una respuesta de companyconcept: solo 10-K (o 20-F) del ejercicio completo (FY). Los de flujo
 * (ingresos, ganancia, BPA) tienen que cubrir un año (330 a 400 días); los de saldo se toman al cierre. Si un mismo cierre
 * aparece en varias presentaciones, gana la última presentada (puede haber corregido).
 */
export function anualesDe(json: unknown, unidad: string, flujo: boolean): Map<string, number> {
  const filas = ((json as { units?: Record<string, FilaXbrl[]> } | null)?.units?.[unidad] ?? []) as FilaXbrl[];
  const porFin = new Map<string, { val: number; filed: string }>();
  for (const f of filas) {
    if (typeof f.val !== "number" || !Number.isFinite(f.val) || typeof f.end !== "string") continue;
    if (!(f.form === "10-K" || f.form === "10-K/A" || f.form === "20-F") || f.fp !== "FY") continue;
    if (flujo) {
      if (typeof f.start !== "string") continue;
      const dias = (Date.parse(f.end) - Date.parse(f.start)) / DIA;
      if (!(dias >= 330 && dias <= 400)) continue;
    }
    const previo = porFin.get(f.end);
    const filed = f.filed ?? "";
    if (!previo || filed >= previo.filed) porFin.set(f.end, { val: f.val, filed });
  }
  return new Map([...porFin].map(([fin, x]) => [fin, x.val]));
}

/** Arma los ejercicios a partir de los valores de cada concepto, alineados por fecha de cierre del ejercicio. */
export function armarEjercicios(valores: Partial<Record<Concepto, Map<string, number>>>, maximo = 6): Ejercicio[] {
  // Los cierres los fijan los conceptos de flujo (un ejercicio es un año de resultados).
  const fines = new Set<string>();
  for (const c of ["ingresos", "gananciaNeta", "bpa"] as Concepto[]) for (const f of valores[c]?.keys() ?? []) fines.add(f);
  const lista = [...fines].sort().slice(-maximo);
  return lista.map((fin) => {
    const e = { fin } as Ejercicio;
    for (const c of Object.keys(CONCEPTOS) as Concepto[]) e[c] = valores[c]?.get(fin) ?? null;
    return e;
  });
}

export type ResultadoFund = { fund: Fundamentales | null; error: string | null };

/** User-Agent que pide SEC: quién consulta y, si está cargado, un contacto. */
export const agenteSec = (contacto: string | null) => `ALT RADAR PRO url.fx${contacto ? ` ${contacto}` : ""}`;

/** Baja los conceptos de una empresa de SEC (10-K en us-gaap, o 20-F en ifrs-full). `fetchImpl` y el reloj se inyectan en las pruebas. */
export async function bajarFundamentales(
  simbolo: string,
  opts: { fetchImpl?: typeof fetch; ahora?: number; contacto?: string | null; timeoutMs?: number } = {},
): Promise<ResultadoFund> {
  const emp = empresaSec(simbolo);
  if (!emp) return { fund: null, error: motivoSinBalance(simbolo) };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cik = `CIK${String(emp.cik).padStart(10, "0")}`;
  const taxonomia = emp.niif ? "ifrs-full" : "us-gaap";
  let entidad = "";
  let ultimoError: string | null = null;
  const pedir = async (nombre: string): Promise<unknown | null> => {
    try {
      const r = await fetchImpl(`https://data.sec.gov/api/xbrl/companyconcept/${cik}/${taxonomia}/${nombre}.json`, {
        headers: { "User-Agent": agenteSec(opts.contacto ?? null), Accept: "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      });
      if (r.status === 404) return null; // la empresa no reporta ese concepto
      if (!r.ok) {
        ultimoError = `HTTP ${r.status}`;
        return null;
      }
      const j = (await r.json()) as { entityName?: unknown };
      if (typeof j.entityName === "string") {
        const oficial = normal(j.entityName);
        if (!emp.nombres.some((n) => oficial.includes(n))) {
          ultimoError = `el CIK devolvió «${j.entityName}», no la empresa esperada`;
          return null;
        }
        entidad = j.entityName;
      }
      return j;
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
      return null;
    }
  };
  const valores: Partial<Record<Concepto, Map<string, number>>> = {};
  const faltantes: Concepto[] = [];
  // En NIIF, la moneda la fija el primer concepto con datos y los demás tienen que venir en esa misma: no se mezclan monedas.
  let moneda: string | null = emp.niif ? null : "USD";
  // De a un pedido por vez: SEC pide no pasar de 10 por segundo y bloquea a quien se pasa.
  const ultimo = (x: Map<string, number> | null) => (x && x.size ? [...x.keys()].sort().at(-1)! : "");
  for (const c of Object.keys(CONCEPTOS) as Concepto[]) {
    const def = emp.niif ? CONCEPTOS_NIIF[c] : { ...CONCEPTOS[c], porAccion: false };
    let mejor: Map<string, number> | null = null;
    let monedaDeMejor: string | null = null;
    for (const nombre of def.nombres) {
      const j = await pedir(nombre);
      if (!j) continue;
      for (const m of moneda ? [moneda] : MONEDAS_NIIF) {
        const unidad = emp.niif ? claveUnidad(j, m, !!def.porAccion) : (CONCEPTOS[c].unidad);
        if (!unidad) continue;
        const mapa = anualesDe(j, unidad, def.flujo);
        if (mapa.size && ultimo(mapa) > ultimo(mejor)) {
          mejor = mapa;
          monedaDeMejor = m;
        }
      }
    }
    if (mejor) {
      valores[c] = mejor;
      if (!moneda) moneda = monedaDeMejor;
    } else faltantes.push(c);
    if ((ultimoError as string | null)?.startsWith("el CIK")) break; // no es la empresa: no seguir pidiendo
  }
  const ejercicios = armarEjercicios(valores);
  if (!ejercicios.length || !entidad || !moneda) return { fund: null, error: (ultimoError as string | null) ?? "SEC no devolvió ejercicios anuales" };
  return {
    fund: {
      simbolo,
      entidad,
      ejercicios,
      fuente: emp.niif ? "SEC EDGAR (XBRL, NIIF, 20-F)" : "SEC EDGAR (XBRL, 10-K)",
      leido: opts.ahora ?? Date.now(),
      faltantes: faltantes.sort(),
      moneda,
    },
    error: null,
  };
}

/** Los balances cambian una vez por trimestre: se guardan 7 días en una fila de D1 por empresa. */
export const VIDA_FUND_MS = 7 * DIA;
/** v2: suma la deuda financiera (lo guardado antes no la tiene y se vuelve a bajar). */
export const claveFund = (simbolo: string) => `fund_sec2:${simbolo}`;

export function leerFundGuardado(raw: string | null): Fundamentales | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Fundamentales;
    return v && typeof v.simbolo === "string" && Array.isArray(v.ejercicios) && typeof v.leido === "number" ? v : null;
  } catch {
    return null;
  }
}

/** Lo guardado si tiene menos de 7 días; si no, lo baja de SEC y lo guarda. Si SEC falla, sirve lo viejo diciéndolo. */
export async function fundamentalesDe(
  db: D1Database,
  simbolo: string,
  opts: { fetchImpl?: typeof fetch; ahora?: number } = {},
): Promise<ResultadoFund & { viejo: boolean }> {
  const ahora = opts.ahora ?? Date.now();
  const guardado = leerFundGuardado(await leerAjuste(db, claveFund(simbolo)).catch(() => null));
  if (guardado && ahora - guardado.leido < VIDA_FUND_MS) return { fund: guardado, error: null, viejo: false };
  const contacto = await leerAjuste(db, "sec_contacto").catch(() => null);
  const r = await bajarFundamentales(simbolo, { fetchImpl: opts.fetchImpl, ahora, contacto });
  if (r.fund) {
    await guardarAjuste(db, claveFund(simbolo), JSON.stringify(r.fund)).catch(() => undefined);
    return { ...r, viejo: false };
  }
  if (guardado) return { fund: guardado, error: r.error, viejo: true };
  return { ...r, viejo: false };
}
