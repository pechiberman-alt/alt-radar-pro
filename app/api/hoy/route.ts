/**
 * La pantalla HOY (lib/hoy.ts): una sola lectura al abrirla, igual para todos y guardada 5 minutos en el servidor
 * (lib/hoy-db.ts). Solo lectura. PRO, como el registro.
 */
import { env } from "cloudflare:workers";
import { leerHoy } from "@/lib/hoy-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const hoy = await leerHoy(env.DB, Date.now());
  return Response.json(hoy, { headers: { "Cache-Control": "private, max-age=60" } });
}
