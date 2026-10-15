/**
 * La lógica pura del editor por IA (scripts/ia-editor.mjs, .github/workflows/ia-editor.yml): lee el comentario del dueño
 * en un issue («/ia» más el pedido), decide qué archivos puede tocar, valida lo que devuelve un modelo gratis y aplica
 * los cambios como buscar y reemplazar exactos. Solo edita archivos que ya existen y que se le mostraron al modelo, nunca
 * workflows, dependencias, migraciones ni claves, y todo termina en un PR que revisa la persona: nada se mergea solo.
 * Pura: no lee la red, el disco ni la base.
 */

/** Lo que el modelo puede tocar: carpetas de la app. Todo lo demás queda afuera. */
export const CARPETAS_PERMITIDAS = ["app/", "lib/", "tests/", "docs/"];
/** Dentro de lo permitido, lo que no se toca: el mapa se regenera solo. */
export const RUTAS_PROHIBIDAS = ["docs/araña/", ".github/", "drizzle/", "node_modules/", "scripts/"];
export const MAX_ARCHIVOS = 4;
export const MAX_EDICIONES = 6;
export const MAX_CARACTERES_CONTEXTO = 30_000;
const MAX_BUSCAR = 4_000;
const MAX_REEMPLAZAR = 8_000;

export type Pedido = { archivos: string[]; pedido: string };
export type Edicion = { archivo: string; buscar: string; reemplazar: string };
export type Respuesta = { resumen: string; ediciones: Edicion[] };

/** Si la ruta es de una carpeta permitida, sin salirse con «..», sin rutas absolutas y sin las prohibidas. */
export function rutaPermitida(ruta: string): boolean {
  if (typeof ruta !== "string" || ruta.length === 0 || ruta.length > 200) return false;
  if (ruta.startsWith("/") || ruta.includes("\\") || ruta.includes("\0")) return false;
  const partes = ruta.split("/");
  if (partes.some((p) => p === ".." || p === "." || p === "")) return false;
  if (RUTAS_PROHIBIDAS.some((p) => ruta.startsWith(p))) return false;
  if (/(^|\/)(\.env|\.dev\.vars)/.test(ruta) || /\.(pem|key)$/.test(ruta)) return false;
  return CARPETAS_PERMITIDAS.some((c) => ruta.startsWith(c));
}

/**
 * El comentario del dueño: empieza con «/ia», puede traer una línea «archivos: a, b» y el resto es el pedido. Devuelve null si
 * no empieza con «/ia» o no trae pedido. Los archivos que no se pueden tocar se descartan.
 */
export function parsearComentario(cuerpo: string): Pedido | null {
  if (typeof cuerpo !== "string") return null;
  const t = cuerpo.trim();
  if (!/^\/ia(\s|$)/i.test(t)) return null;
  const resto = t.slice(3);
  const linea = resto.match(/^[ \t]*archivos?[ \t]*:[ \t]*(.+)$/im);
  const archivos = linea
    ? linea[1]
        .split(/[,\s]+/)
        .map((x) => x.trim())
        .filter((x) => rutaPermitida(x))
        .slice(0, MAX_ARCHIVOS)
    : [];
  const pedido = (linea ? resto.replace(linea[0], "") : resto).trim();
  if (!pedido) return null;
  return { archivos: [...new Set(archivos)], pedido };
}

/** Las rutas que el modelo eligió de una lista: solo las que están en la lista, son permitidas y no pasan de MAX_ARCHIVOS. */
export function rutasElegidas(textoModelo: string, lista: string[]): string[] {
  const conocidas = new Set(lista);
  const out: string[] = [];
  for (const cand of textoModelo.split(/[\s,"'`[\]]+/)) {
    if (conocidas.has(cand) && rutaPermitida(cand) && !out.includes(cand)) out.push(cand);
    if (out.length >= MAX_ARCHIVOS) break;
  }
  return out;
}

/** El JSON de la respuesta del modelo, con o sin cercos de código, validado y con límites. */
export function validarRespuesta(texto: string): { ok: true; respuesta: Respuesta } | { ok: false; error: string } {
  let t = (texto ?? "").trim();
  const cerco = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerco) t = cerco[1].trim();
  let raw: unknown;
  try {
    raw = JSON.parse(t);
  } catch {
    return { ok: false, error: "La respuesta del modelo no es un JSON válido." };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "La respuesta del modelo no tiene la forma pedida." };
  const o = raw as Record<string, unknown>;
  if (typeof o.resumen !== "string" || !Array.isArray(o.ediciones)) return { ok: false, error: "Faltan el resumen o las ediciones." };
  if (o.ediciones.length === 0) return { ok: false, error: "El modelo no propuso ningún cambio." };
  if (o.ediciones.length > MAX_EDICIONES) return { ok: false, error: `El modelo propuso más de ${MAX_EDICIONES} cambios: es demasiado para revisar.` };
  const ediciones: Edicion[] = [];
  for (const e of o.ediciones) {
    if (!e || typeof e !== "object") return { ok: false, error: "Una edición no tiene la forma pedida." };
    const x = e as Record<string, unknown>;
    if (typeof x.archivo !== "string" || typeof x.buscar !== "string" || typeof x.reemplazar !== "string") return { ok: false, error: "Una edición no trae archivo, buscar y reemplazar." };
    if (x.buscar.length === 0 || x.buscar.length > MAX_BUSCAR || x.reemplazar.length > MAX_REEMPLAZAR) return { ok: false, error: "Una edición tiene un tamaño fuera de los límites." };
    ediciones.push({ archivo: x.archivo, buscar: x.buscar, reemplazar: x.reemplazar });
  }
  return { ok: true, respuesta: { resumen: o.resumen.trim().slice(0, 1_000), ediciones } };
}

/**
 * Aplica las ediciones sobre los archivos que se le mostraron al modelo. Cada «buscar» tiene que aparecer exactamente una vez
 * en su archivo; si no, se rechaza todo (nada a medias). No crea archivos ni toca uno que no se le mostró.
 */
export function aplicarEdiciones(archivos: Record<string, string>, ediciones: Edicion[]): { ok: true; archivos: Record<string, string>; tocados: string[] } | { ok: false; error: string } {
  const out: Record<string, string> = { ...archivos };
  const tocados: string[] = [];
  for (const e of ediciones) {
    if (!rutaPermitida(e.archivo)) return { ok: false, error: `El archivo ${e.archivo} no se puede editar.` };
    if (!(e.archivo in out)) return { ok: false, error: `El archivo ${e.archivo} no se le mostró al modelo o no existe.` };
    const partes = out[e.archivo].split(e.buscar);
    if (partes.length === 1) return { ok: false, error: `En ${e.archivo} no se encontró el texto a reemplazar.` };
    if (partes.length > 2) return { ok: false, error: `En ${e.archivo} el texto a reemplazar aparece más de una vez: no es exacto.` };
    out[e.archivo] = partes.join(e.reemplazar);
    if (!tocados.includes(e.archivo)) tocados.push(e.archivo);
  }
  return { ok: true, archivos: out, tocados };
}

/** Lo que se le pide al modelo. Las reglas del proyecto van recortadas; los archivos, completos con su ruta. */
export function promptEdicion(reglas: string, archivos: Record<string, string>, pedido: string): { sistema: string; usuario: string } {
  const sistema =
    "Sos un asistente que edita un proyecto de código. Respondé SOLO con un JSON de esta forma, sin texto extra: " +
    '{"resumen":"qué cambia y por qué, en español rioplatense","ediciones":[{"archivo":"ruta","buscar":"texto exacto que existe UNA sola vez en el archivo","reemplazar":"texto nuevo"}]}. ' +
    "Reglas: usá solo los archivos que se te muestran; cada «buscar» debe copiarse tal cual del archivo y aparecer una sola vez; hacé el cambio mínimo; " +
    "no inventes funciones ni archivos; todo texto visible para el usuario va en español rioplatense; no toques claves, workflows ni dependencias.";
  const bloques = Object.entries(archivos)
    .map(([ruta, contenido]) => `=== ARCHIVO ${ruta} ===\n${contenido}\n=== FIN ${ruta} ===`)
    .join("\n\n");
  const usuario = `REGLAS DEL PROYECTO (recortadas):\n${reglas}\n\n${bloques}\n\nPEDIDO:\n${pedido}`;
  return { sistema, usuario };
}

/** El pedido para que el modelo elija archivos cuando la persona no los nombró. */
export function promptElegirArchivos(lista: string[], pedido: string): { sistema: string; usuario: string } {
  return {
    sistema: `Elegí hasta ${MAX_ARCHIVOS} archivos de la lista que hay que mirar para cumplir el pedido. Respondé solo con las rutas, una por línea, copiadas tal cual de la lista.`,
    usuario: `LISTA DE ARCHIVOS:\n${lista.join("\n")}\n\nPEDIDO:\n${pedido}`,
  };
}

/** Reemplaza cada secreto (de más de 3 caracteres) por *** en un texto que va a salir a un log o a un comentario público. */
export function ocultarSecretos(texto: string, secretos: (string | undefined)[]): string {
  let t = String(texto);
  for (const s of secretos) if (s && s.length > 3) t = t.split(s).join("***");
  return t;
}
