/**
 * Per-client Binance USDⓈ-M futures reading, using the same linked
 * credentials and the same signed-request machinery as spot
 * (lib/binance-account.ts) — this module adds no new signing code, only a
 * different base URL and the two endpoints Binance's own changelog names as
 * the canonical pair for this: GET /fapi/v2/account and
 * GET /fapi/v2/positionRisk.
 *
 * Unlike spot, there is no strictly read-only futures permission on
 * Binance's side: "Enable Futures" gates both reading and trading futures.
 * This module still only ever reads — it never places an order, never
 * changes leverage or margin type — but the KEY itself is not read-only the
 * way a spot key can be, and that is surfaced to the person linking it
 * (see friendlyBinanceError's "futures" context and the panel's own notice),
 * not hidden.
 */

import { signedRequest } from "./binance-account.ts";

const FAPI_BASE = "https://fapi.binance.com";

export type RawFuturesPosition = {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  isolatedMargin: string;
  notional: string;
};

/** All positions the account has data for, most of them flat (positionAmt
 *  "0"); callers that only want open ones filter that themselves so the raw
 *  shape stays a faithful pass-through of what Binance returned. */
export async function getFuturesPositions(apiKey: string, apiSecret: string) {
  return signedRequest<RawFuturesPosition[]>("/fapi/v2/positionRisk", {}, apiKey, apiSecret, FAPI_BASE);
}

export type RawFuturesAccount = {
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  availableBalance: string;
  totalInitialMargin: string;
  totalMaintMargin: string;
};

export async function getFuturesAccountSummary(apiKey: string, apiSecret: string) {
  return signedRequest<RawFuturesAccount>("/fapi/v2/account", {}, apiKey, apiSecret, FAPI_BASE);
}
