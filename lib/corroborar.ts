/**
 * Corroborar lo que manda un navegador antes de guardarlo o mostrárselo a otros: el precio se compara con una fuente que el
 * Worker sí alcanza por su cuenta (Kraken o Coinbase, en dólares; Binance le responde 403). Lo usan los aportes de velas
 * (/api/klines), las fotos del libro de órdenes (/api/liquidity-history) y la memoria del cerebro (/api/brain): sin esto,
 * cualquiera podía mandar precios inventados que después veían todos. La referencia se pide una vez por minuto por par.
 * Si no hay referencia, se dice (null): cada ruta decide qué hacer, y lo dice.
 */
import { fetchKlinesServer } from "./klines-server.ts";
import { cached } from "./upstream-cache.ts";

/** Diferencia máxima entre el precio del navegador (Binance, USDT) y la referencia (USD) para darlo por bueno. */
export const TOLERANCIA_PRECIO = 0.02;
/** Para cierres de una misma vela, más estricta: es la misma vela en dos mercados. */
export const TOLERANCIA_CIERRE = 0.006;

/** Si dos precios coinciden dentro de la tolerancia (relativa a la referencia). */
export function coincide(precio: number, referencia: number, tolerancia = TOLERANCIA_PRECIO): boolean {
  return Number.isFinite(precio) && Number.isFinite(referencia) && precio > 0 && referencia > 0 && Math.abs(precio / referencia - 1) <= tolerancia;
}

const parValido = (s: string) => /^[A-Z0-9]{2,24}USDT$/.test(s);

/** Las velas de referencia de un par y temporalidad (Kraken o Coinbase), guardadas un minuto. Null si no hay. */
export async function velasDeReferencia(symbol: string, intervalo: string, limite = 200): Promise<{ openTime: number; close: number }[] | null> {
  if (!parValido(symbol)) return null;
  const { value } = await cached(
    `ref:${symbol}:${intervalo}:${limite}`,
    60_000,
    async () => {
      const r = await fetchKlinesServer(symbol, intervalo, { limit: limite, soloAfuera: true });
      return r.candles.map((c) => ({ openTime: c.openTime, close: c.close }));
    },
    5 * 60_000,
  );
  return value && value.length ? value : null;
}

/** El último precio de referencia de un par, o null si ninguna fuente de afuera lo tiene. */
export async function precioDeReferencia(symbol: string): Promise<number | null> {
  const velas = await velasDeReferencia(symbol, "1h", 2).catch(() => null);
  const ultimo = velas?.[velas.length - 1]?.close;
  return ultimo && ultimo > 0 ? ultimo : null;
}

/** true si coincide con la referencia, false si la contradice, null si no hay referencia. */
export async function corroborado(symbol: string, precio: number): Promise<boolean | null> {
  const ref = await precioDeReferencia(symbol);
  return ref === null ? null : coincide(precio, ref);
}
